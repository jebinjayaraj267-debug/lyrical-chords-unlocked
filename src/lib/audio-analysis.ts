/**
 * In-browser music analysis: chromagram -> chord recognition, key estimation,
 * onset/tempo tracking and beat-grid alignment.
 *
 * Everything here runs client-side on a decoded AudioBuffer, so no audio ever
 * leaves the device.
 */

import { pcToNote } from "./chords";

export interface ChordEvent {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** e.g. "Am7", or "N" for no-chord */
  label: string;
  confidence: number;
}

export interface AnalysisResult {
  duration: number;
  bpm: number;
  beats: number[];
  key: string;
  keyPc: number;
  mode: "major" | "minor";
  timeSignature: number;
  chords: ChordEvent[];
  /** per-beat chord labels, aligned with `beats` */
  beatChords: string[];
}

/* ------------------------------------------------------------------ */
/* FFT (iterative radix-2)                                             */
/* ------------------------------------------------------------------ */

class FFT {
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;

  constructor(private n: number) {
    const levels = Math.log2(n);
    if (!Number.isInteger(levels)) throw new Error("FFT size must be a power of 2");
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let j = 0; j < levels; j++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
  }

  /** In-place transform; returns magnitude spectrum of length n/2. */
  magnitude(input: Float32Array): Float32Array {
    const n = this.n;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = input[this.rev[i]!] ?? 0;

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l]! * this.cos[k]! + im[l]! * this.sin[k]!;
          const tim = -re[l]! * this.sin[k]! + im[l]! * this.cos[k]!;
          re[l] = re[j]! - tre;
          im[l] = im[j]! - tim;
          re[j] = re[j]! + tre;
          im[j] = im[j]! + tim;
        }
      }
    }

    const mag = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
    return mag;
  }
}

/* ------------------------------------------------------------------ */
/* Chord templates                                                     */
/* ------------------------------------------------------------------ */

const QUALITIES: { suffix: string; intervals: number[]; weight: number }[] = [
  // Triads are what real chord sheets use; extensions must clearly out-score them.
  { suffix: "", intervals: [0, 4, 7], weight: 1.0 },
  { suffix: "m", intervals: [0, 3, 7], weight: 1.0 },
  { suffix: "7", intervals: [0, 4, 7, 10], weight: 0.9 },
  { suffix: "m7", intervals: [0, 3, 7, 10], weight: 0.89 },
  { suffix: "maj7", intervals: [0, 4, 7, 11], weight: 0.86 },
  { suffix: "sus4", intervals: [0, 5, 7], weight: 0.85 },
  { suffix: "sus2", intervals: [0, 2, 7], weight: 0.83 },
  { suffix: "dim", intervals: [0, 3, 6], weight: 0.8 },
  { suffix: "aug", intervals: [0, 4, 8], weight: 0.74 },
  { suffix: "6", intervals: [0, 4, 7, 9], weight: 0.78 },
  { suffix: "m6", intervals: [0, 3, 7, 9], weight: 0.76 },
];


interface Template {
  label: string;
  vec: Float32Array;
  weight: number;
  rootPc: number;
  intervals: number[];
}

function buildTemplates(): Template[] {
  const out: Template[] = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      const vec = new Float32Array(12);
      q.intervals.forEach((iv, idx) => {
        vec[(root + iv) % 12] = idx === 0 ? 1.15 : 1;
      });
      let norm = 0;
      for (const v of vec) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 12; i++) vec[i] = vec[i]! / norm;
      out.push({
        label: pcToNote(root) + q.suffix,
        vec,
        weight: q.weight,
        rootPc: root,
        intervals: q.intervals,
      });
    }
  }
  return out;
}

const TEMPLATES = buildTemplates();

/* Krumhansl-Schmuckler key profiles */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/* ------------------------------------------------------------------ */
/* Core analysis                                                       */
/* ------------------------------------------------------------------ */

const FRAME = 4096;
const HOP = 1024;

function downmix(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] = out[i]! + data[i]!;
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < len; i++) out[i] = out[i]! * inv;
  return out;
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

interface Frames {
  chroma: Float32Array[];
  /** low-register chroma (bass notes) used to bias chord roots */
  bass: Float32Array[];
  onset: Float32Array;
  frameTime: number;
}

/** Spectral whitening: divide each bin by a local average so timbre matters less. */
function whiten(mag: Float32Array, w: number): Float32Array {
  const n = mag.length;
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < Math.min(w, n); i++) sum += mag[i]!;
  let lo = 0;
  let hi = Math.min(w, n) - 1;
  for (let i = 0; i < n; i++) {
    const nlo = Math.max(0, i - w);
    const nhi = Math.min(n - 1, i + w);
    while (hi < nhi) sum += mag[++hi]!;
    while (lo < nlo) sum -= mag[lo++]!;
    const mean = sum / (nhi - nlo + 1);
    out[i] = mag[i]! / (mean + 1e-6);
  }
  return out;
}

function computeFrames(signal: Float32Array, sampleRate: number): Frames {
  const fft = new FFT(FRAME);
  const win = hann(FRAME);
  const nFrames = Math.max(1, Math.floor((signal.length - FRAME) / HOP) + 1);
  const chroma: Float32Array[] = [];
  const bass: Float32Array[] = [];
  const onset = new Float32Array(nFrames);
  const bins = FRAME / 2;

  // Precompute pitch class per FFT bin (only within musical range).
  const binPc = new Int16Array(bins).fill(-1);
  const binW = new Float32Array(bins);
  const binBass = new Uint8Array(bins);
  for (let b = 1; b < bins; b++) {
    const freq = (b * sampleRate) / FRAME;
    if (freq < 40 || freq > 2100) continue;
    const midi = 69 + 12 * Math.log2(freq / 440);
    binPc[b] = ((Math.round(midi) % 12) + 12) % 12;
    if (freq < 250) binBass[b] = 1;
    // de-emphasise very high partials, and the sub range for the main chroma
    binW[b] = freq < 65 ? 0.25 : freq < 1000 ? 1 : 0.5;
  }

  let prev: Float32Array | null = null;
  const frame = new Float32Array(FRAME);

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) frame[i] = (signal[off + i] ?? 0) * win[i]!;
    const raw = fft.magnitude(frame);
    const mag = whiten(raw, 24);

    const c = new Float32Array(12);
    const bc = new Float32Array(12);
    let flux = 0;
    for (let b = 1; b < bins; b++) {
      const m = mag[b]!;
      const pc = binPc[b]!;
      if (pc >= 0) {
        c[pc] = c[pc]! + m * m * binW[b]!;
        if (binBass[b]) bc[pc] = bc[pc]! + m * m;
      }
      if (prev) {
        const d = raw[b]! - prev[b]!;
        if (d > 0) flux += d;
      }
    }
    onset[f] = flux;
    prev = raw;

    // Harmonic suppression: remove energy explainable by a fifth/major-third below.
    const h = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      h[i] = Math.max(0, c[i]! - 0.32 * c[(i + 5) % 12]! - 0.12 * c[(i + 8) % 12]!);
    }

    // log compression + normalise
    let max = 0;
    for (let i = 0; i < 12; i++) {
      c[i] = Math.log1p(h[i]! * 40);
      if (c[i]! > max) max = c[i]!;
    }
    if (max > 0) for (let i = 0; i < 12; i++) c[i] = c[i]! / max;

    let bmax = 0;
    for (let i = 0; i < 12; i++) {
      bc[i] = Math.log1p(bc[i]! * 40);
      if (bc[i]! > bmax) bmax = bc[i]!;
    }
    if (bmax > 0) for (let i = 0; i < 12; i++) bc[i] = bc[i]! / bmax;

    chroma.push(c);
    bass.push(bc);
  }

  return { chroma, bass, onset, frameTime: HOP / sampleRate };
}

function movingAverage(x: Float32Array, w: number): Float32Array {
  const out = new Float32Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i]!;
    if (i >= w) sum -= x[i - w]!;
    out[i] = sum / Math.min(i + 1, w);
  }
  return out;
}

function estimateTempo(onset: Float32Array, frameTime: number): number {
  const mean = movingAverage(onset, 32);
  const nov = new Float32Array(onset.length);
  for (let i = 0; i < onset.length; i++) nov[i] = Math.max(0, onset[i]! - mean[i]!);

  const minBpm = 60;
  const maxBpm = 190;
  let bestBpm = 120;
  let bestScore = -Infinity;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lagF = 60 / bpm / frameTime;
    const lag = Math.round(lagF);
    if (lag < 2 || lag >= nov.length) continue;
    let s = 0;
    for (let i = 0; i + lag < nov.length; i++) s += nov[i]! * nov[i + lag]!;
    s /= nov.length - lag;
    // prefer 90-150 bpm range slightly
    const prior = Math.exp(-Math.pow(Math.log2(bpm / 120), 2) / 0.6);
    const score = s * prior;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm * 10) / 10;
}

function findBeatPhase(onset: Float32Array, frameTime: number, bpm: number): number {
  const period = 60 / bpm / frameTime;
  let best = 0;
  let bestScore = -Infinity;
  const steps = Math.max(1, Math.round(period));
  for (let phase = 0; phase < steps; phase++) {
    let s = 0;
    for (let t = phase; t < onset.length; t += period) s += onset[Math.round(t)] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = phase;
    }
  }
  return best * frameTime;
}

function estimateKey(chroma: Float32Array[]): { pc: number; mode: "major" | "minor" } {
  const avg = new Float32Array(12);
  for (const c of chroma) for (let i = 0; i < 12; i++) avg[i] = avg[i]! + c[i]!;
  const n = chroma.length || 1;
  for (let i = 0; i < 12; i++) avg[i] = avg[i]! / n;

  const corr = (profile: number[], shift: number) => {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < 12; i++) {
      sx += avg[(i + shift) % 12]!;
      sy += profile[i]!;
    }
    const mx = sx / 12;
    const my = sy / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      const a = avg[(i + shift) % 12]! - mx;
      const b = profile[i]! - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    return num / (Math.sqrt(dx * dy) || 1);
  };

  let best = { pc: 0, mode: "major" as "major" | "minor", score: -Infinity };
  for (let shift = 0; shift < 12; shift++) {
    const maj = corr(MAJOR_PROFILE, shift);
    const min = corr(MINOR_PROFILE, shift);
    if (maj > best.score) best = { pc: shift, mode: "major", score: maj };
    if (min > best.score) best = { pc: shift, mode: "minor", score: min };
  }
  return { pc: best.pc, mode: best.mode };
}

function averageChroma(chroma: Float32Array[], from: number, to: number): Float32Array {
  const out = new Float32Array(12);
  const a = Math.max(0, from);
  const b = Math.min(chroma.length, Math.max(a + 1, to));
  for (let f = a; f < b; f++) for (let i = 0; i < 12; i++) out[i] = out[i]! + chroma[f]![i]!;
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 12; i++) out[i] = out[i]! / norm;
  return out;
}

function matchChord(vec: Float32Array): { label: string; score: number } {
  const scores = templateScores(vec, null, null);
  let best = { label: "N", score: -Infinity };
  for (let i = 0; i < TEMPLATES.length; i++) {
    if (scores[i]! > best.score) best = { label: TEMPLATES[i]!.label, score: scores[i]! };
  }
  let energy = 0;
  for (const v of vec) energy += v;
  if (energy < 0.35) return { label: "N", score: 0 };
  return best;
}

/** Diatonic pitch classes for a key, used as a mild prior. */
function scaleOf(pc: number, mode: "major" | "minor"): Set<number> {
  const steps = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return new Set(steps.map((s) => (pc + s) % 12));
}

/** Emission score per template, with bass-root bias and key prior. */
function templateScores(
  vec: Float32Array,
  bassVec: Float32Array | null,
  scale: Set<number> | null,
): Float32Array {
  const out = new Float32Array(TEMPLATES.length);
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i]!;
    let dot = 0;
    for (let j = 0; j < 12; j++) dot += vec[j]! * t.vec[j]!;
    let s = dot * t.weight;
    if (bassVec) s += 0.16 * bassVec[t.rootPc]!;
    if (scale) {
      let outside = 0;
      for (const iv of t.intervals) {
        if (!scale.has((t.rootPc + iv) % 12)) outside++;
      }
      s -= 0.02 * outside;
      if (!scale.has(t.rootPc)) s -= 0.03;
    }
    out[i] = s;
  }
  return out;
}

/**
 * Viterbi decoding over beats: emission from chroma matching, transition cost
 * that discourages chord changes (heavily so mid-bar) so we get one stable
 * chord per bar rather than a new chord on every beat.
 */
function viterbiDecode(
  emissions: Float32Array[],
  beatsPerBar: number,
  changeCost: number,
): number[] {
  const n = emissions.length;
  const states = TEMPLATES.length;
  if (n === 0) return [];
  let prev = Float32Array.from(emissions[0]!);
  const back: Int16Array[] = [];

  for (let t = 1; t < n; t++) {
    // Extra cost when the change is not on a downbeat / half-bar.
    const inBar = t % beatsPerBar;
    const positional =
      inBar === 0 ? 0 : inBar === Math.floor(beatsPerBar / 2) ? changeCost * 0.5 : changeCost;
    const cost = changeCost + positional;

    let bestPrev = -Infinity;
    let bestPrevIdx = 0;
    for (let s = 0; s < states; s++) {
      if (prev[s]! > bestPrev) {
        bestPrev = prev[s]!;
        bestPrevIdx = s;
      }
    }
    const cur = new Float32Array(states);
    const bp = new Int16Array(states);
    const em = emissions[t]!;
    for (let s = 0; s < states; s++) {
      const stay = prev[s]!;
      const move = bestPrev - cost;
      if (stay >= move) {
        cur[s] = stay + em[s]!;
        bp[s] = s;
      } else {
        cur[s] = move + em[s]!;
        bp[s] = bestPrevIdx;
      }
    }
    back.push(bp);
    prev = cur;
  }

  let last = 0;
  for (let s = 1; s < states; s++) if (prev[s]! > prev[last]!) last = s;
  const path = new Array<number>(n);
  path[n - 1] = last;
  for (let t = n - 2; t >= 0; t--) path[t] = back[t]![path[t + 1]!]!;
  return path;
}

export interface AnalyzeOptions {
  onProgress?: (pct: number, stage: string) => void;
}

export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const report = (p: number, s: string) => opts.onProgress?.(p, s);
  report(5, "Preparing audio");

  const signal = downmix(buffer);
  const sampleRate = buffer.sampleRate;

  report(20, "Building chromagram");
  await tick();
  const { chroma, bass, onset, frameTime } = computeFrames(signal, sampleRate);

  report(55, "Detecting tempo");
  await tick();
  const bpm = estimateTempo(onset, frameTime);
  const phase = findBeatPhase(onset, frameTime, bpm);
  const duration = buffer.duration;
  const beatLen = 60 / bpm;
  const beats: number[] = [];
  for (let t = phase; t < duration; t += beatLen) beats.push(Math.round(t * 1000) / 1000);

  report(70, "Estimating key");
  await tick();
  const key = estimateKey(chroma);
  const scale = scaleOf(key.pc, key.mode);

  report(80, "Recognising chords");
  await tick();
  const timeSignature = 4;
  const emissions: Float32Array[] = [];
  const beatEnergy: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const start = beats[i]!;
    const end = i + 1 < beats.length ? beats[i + 1]! : duration;
    // widen the window slightly so sustained harmony dominates transients
    const f0 = Math.floor((start - beatLen * 0.15) / frameTime);
    const f1 = Math.ceil((end + beatLen * 0.15) / frameTime);
    const vec = averageChroma(chroma, f0, f1);
    const bassVec = averageChroma(bass, f0, f1);
    let energy = 0;
    for (const v of vec) energy += v;
    beatEnergy.push(energy);
    emissions.push(templateScores(vec, bassVec, scale));
  }

  const path = viterbiDecode(emissions, timeSignature, 0.55);
  const smoothed: string[] = [];
  const beatScores: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const idx = path[i]!;
    const silent = beatEnergy[i]! < 0.35;
    smoothed.push(silent ? "N" : TEMPLATES[idx]!.label);
    beatScores.push(emissions[i]![idx]!);
  }

  // Merge runs, then absorb any chord shorter than half a bar into its neighbour.
  let chords: ChordEvent[] = [];
  for (let i = 0; i < smoothed.length; i++) {
    const label = smoothed[i]!;
    const start = beats[i]!;
    const end = i + 1 < beats.length ? beats[i + 1]! : duration;
    const last = chords[chords.length - 1];
    if (last && last.label === label) {
      last.end = end;
      last.confidence = Math.max(last.confidence, beatScores[i]!);
    } else {
      chords.push({ start, end, label, confidence: beatScores[i]! });
    }
  }
  chords = absorbShort(chords, beatLen * (timeSignature / 2));

  report(100, "Done");
  return {
    duration,
    bpm,
    beats,
    key: pcToNote(key.pc) + (key.mode === "minor" ? "m" : ""),
    keyPc: key.pc,
    mode: key.mode,
    timeSignature,
    chords: chords.filter((c) => c.end - c.start > 0.08),
    beatChords: smoothed,
  };
}

/** Remove chord blips: anything shorter than `minLen` merges into its stronger neighbour. */
function absorbShort(events: ChordEvent[], minLen: number): ChordEvent[] {
  if (events.length < 2) return events;
  let out = events.map((e) => ({ ...e }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const e = out[i]!;
      if (e.end - e.start >= minLen || out.length === 1) continue;
      const prev = out[i - 1];
      const next = out[i + 1];
      const target =
        !prev ? next : !next ? prev : next.end - next.start >= prev.end - prev.start ? next : prev;
      if (!target) continue;
      target.start = Math.min(target.start, e.start);
      target.end = Math.max(target.end, e.end);
      out.splice(i, 1);
      changed = true;
      break;
    }
    // re-merge identical neighbours created by absorption
    const merged: ChordEvent[] = [];
    for (const e of out) {
      const last = merged[merged.length - 1];
      if (last && last.label === e.label) last.end = Math.max(last.end, e.end);
      else merged.push(e);
    }
    if (merged.length !== out.length) changed = true;
    out = merged;
  }
  return out;
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------------ */
/* Realtime (microphone) chord detection                               */
/* ------------------------------------------------------------------ */

export class LiveChordDetector {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private history: string[] = [];

  async start(onChord: (label: string, chroma: Float32Array) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    this.analyser = analyser;

    const bins = analyser.frequencyBinCount;
    const data = new Float32Array(bins);
    const binPc = new Int16Array(bins).fill(-1);
    for (let b = 1; b < bins; b++) {
      const freq = (b * ctx.sampleRate) / analyser.fftSize;
      if (freq < 60 || freq > 2000) continue;
      binPc[b] = ((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12;
    }

    const loop = () => {
      analyser.getFloatFrequencyData(data);
      const c = new Float32Array(12);
      for (let b = 1; b < bins; b++) {
        const pc = binPc[b]!;
        if (pc < 0) continue;
        const lin = Math.pow(10, data[b]! / 20);
        c[pc] = c[pc]! + lin * lin;
      }
      let max = 0;
      for (let i = 0; i < 12; i++) {
        c[i] = Math.log1p(c[i]! * 5e5);
        if (c[i]! > max) max = c[i]!;
      }
      if (max > 0) for (let i = 0; i < 12; i++) c[i] = c[i]! / max;
      let norm = 0;
      for (const v of c) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      const nv = new Float32Array(12);
      for (let i = 0; i < 12; i++) nv[i] = c[i]! / norm;

      const m = matchChord(nv);
      this.history.push(m.label);
      if (this.history.length > 6) this.history.shift();
      const counts = new Map<string, number>();
      for (const l of this.history) counts.set(l, (counts.get(l) ?? 0) + 1);
      let winner = m.label;
      let bestCount = 0;
      counts.forEach((v, k) => {
        if (v > bestCount) {
          bestCount = v;
          winner = k;
        }
      });
      onChord(winner, c);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.history = [];
  }
}

/** Simple autocorrelation pitch detector for the built-in tuner. */
export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i]! * buf[i]!;
  rms = Math.sqrt(rms / size);
  if (rms < 0.008) return null;

  let r1 = 0;
  let r2 = size - 1;
  const thres = 0.2;
  for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]!) < thres) r1 = i;
  for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]!) < thres) r2 = size - i;
  const b = buf.slice(r1, r2);
  const n = b.length;
  if (n < 512) return null;

  const c = new Float32Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) c[i] = c[i]! + b[j]! * b[j + i]!;

  let d = 0;
  while (d < n - 1 && c[d]! > c[d + 1]!) d++;
  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < n; i++) {
    if (c[i]! > maxval) {
      maxval = c[i]!;
      maxpos = i;
    }
  }
  if (maxpos <= 0) return null;
  const x1 = c[maxpos - 1] ?? 0;
  const x2 = c[maxpos]!;
  const x3 = c[maxpos + 1] ?? 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const bb = (x3 - x1) / 2;
  const t = a ? maxpos - bb / (2 * a) : maxpos;
  return sampleRate / t;
}
