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
/* Front end: log-frequency (CQT-style) spectrogram                     */
/* ------------------------------------------------------------------ */

const FRAME = 8192;
const HOP = 2048;
/** semitone grid: MIDI 24 (C1) .. MIDI 107 (B7) */
const MIDI_LO = 24;
const N_NOTES = 84;
/** bins per semitone in the log-frequency spectrogram (for tuning estimation) */
const BPS = 3;
const N_LOG = N_NOTES * BPS;

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

interface Spectro {
  /** [frame][N_LOG] log-frequency magnitudes */
  logSpec: Float32Array[];
  /** raw spectral flux novelty per frame */
  onset: Float32Array;
  frameTime: number;
}

/**
 * Constant-Q-like front end: each FFT frame is mapped onto a log-frequency
 * grid of `BPS` bins per semitone using triangular interpolation, which is
 * what makes tuning correction and harmonic deconvolution possible.
 */
function computeSpectrogram(signal: Float32Array, sampleRate: number): Spectro {
  const fft = new FFT(FRAME);
  const win = hann(FRAME);
  const nFrames = Math.max(1, Math.floor((signal.length - FRAME) / HOP) + 1);
  const bins = FRAME / 2;
  const logSpec: Float32Array[] = [];
  const onset = new Float32Array(nFrames);

  // Map each FFT bin onto the log-frequency grid.
  const binIdx = new Int32Array(bins).fill(-1);
  const binFrac = new Float32Array(bins);
  for (let b = 1; b < bins; b++) {
    const freq = (b * sampleRate) / FRAME;
    if (freq < 30 || freq > 4200) continue;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const pos = (midi - MIDI_LO) * BPS;
    if (pos < 0 || pos >= N_LOG - 1) continue;
    binIdx[b] = Math.floor(pos);
    binFrac[b] = pos - Math.floor(pos);
  }

  let prev: Float32Array | null = null;
  const frame = new Float32Array(FRAME);

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) frame[i] = (signal[off + i] ?? 0) * win[i]!;
    const raw = fft.magnitude(frame);
    const mag = whiten(raw, 48);

    const ls = new Float32Array(N_LOG);
    let flux = 0;
    for (let b = 1; b < bins; b++) {
      const idx = binIdx[b]!;
      if (idx >= 0) {
        const m = mag[b]!;
        const fr = binFrac[b]!;
        ls[idx] = ls[idx]! + m * (1 - fr);
        ls[idx + 1] = ls[idx + 1]! + m * fr;
      }
      if (prev) {
        const d = raw[b]! - prev[b]!;
        if (d > 0) flux += d;
      }
    }
    onset[f] = flux;
    prev = raw;
    logSpec.push(ls);
  }

  return { logSpec, onset, frameTime: HOP / sampleRate };
}

/* ------------------------------------------------------------------ */
/* Harmonic / percussive source separation (median filtering, HPSS)     */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/**
 * Fitzgerald-style HPSS on the log-frequency spectrogram. Harmonic content is
 * smooth along time, percussive content is smooth along frequency; a soft mask
 * built from the two medians pulls the pitched layer out of the drums.
 */
function hpss(
  spec: Float32Array[],
  tWin = 17,
  fWin = 17,
): { harmonic: Float32Array[]; percussive: Float32Array[] } {
  const n = spec.length;
  const harmonic: Float32Array[] = [];
  const percussive: Float32Array[] = [];
  const half = tWin >> 1;
  const fHalf = fWin >> 1;

  const hMed: Float32Array[] = [];
  for (let t = 0; t < n; t++) {
    const row = new Float32Array(N_LOG);
    const lo = Math.max(0, t - half);
    const hi = Math.min(n - 1, t + half);
    const buf: number[] = [];
    for (let k = 0; k < N_LOG; k++) {
      buf.length = 0;
      for (let u = lo; u <= hi; u++) buf.push(spec[u]![k]!);
      row[k] = median(buf);
    }
    hMed.push(row);
  }

  for (let t = 0; t < n; t++) {
    const src = spec[t]!;
    const pRow = new Float32Array(N_LOG);
    const buf: number[] = [];
    for (let k = 0; k < N_LOG; k++) {
      buf.length = 0;
      const lo = Math.max(0, k - fHalf);
      const hi = Math.min(N_LOG - 1, k + fHalf);
      for (let u = lo; u <= hi; u++) buf.push(src[u]!);
      pRow[k] = median(buf);
    }
    const h = new Float32Array(N_LOG);
    const p = new Float32Array(N_LOG);
    for (let k = 0; k < N_LOG; k++) {
      const hv = hMed[t]![k]!;
      const pv = pRow[k]!;
      const denom = hv * hv + pv * pv + 1e-9;
      const mask = (hv * hv) / denom;
      h[k] = src[k]! * mask;
      p[k] = src[k]! * (1 - mask);
    }
    harmonic.push(h);
    percussive.push(p);
  }
  return { harmonic, percussive };
}

/* ------------------------------------------------------------------ */
/* Tuning estimation                                                    */
/* ------------------------------------------------------------------ */

/** Returns the global tuning offset in bins (-1..1 of a semitone * BPS). */
function estimateTuning(spec: Float32Array[]): number {
  // Circular histogram over the sub-semitone position of spectral peaks.
  const acc = new Float64Array(BPS);
  for (const row of spec) {
    for (let k = 1; k < N_LOG - 1; k++) {
      const v = row[k]!;
      if (v > row[k - 1]! && v >= row[k + 1]!) acc[k % BPS] = acc[k % BPS]! + v;
    }
  }
  // Weighted circular mean over the BPS phase.
  let re = 0;
  let im = 0;
  for (let i = 0; i < BPS; i++) {
    const ang = (2 * Math.PI * i) / BPS;
    re += acc[i]! * Math.cos(ang);
    im += acc[i]! * Math.sin(ang);
  }
  const phase = Math.atan2(im, re) / (2 * Math.PI); // -0.5..0.5 of a semitone
  return phase * BPS;
}

/* ------------------------------------------------------------------ */
/* NNLS-style harmonic deconvolution -> note salience -> chroma         */
/* ------------------------------------------------------------------ */

const HARMONIC_OFFSETS = [0, 12, 19, 24, 28, 31, 34, 36].map((s) => s); // semitones for h=1..8
const HARMONIC_DECAY = [1, 0.62, 0.45, 0.34, 0.26, 0.2, 0.16, 0.13];

/**
 * Approximate NNLS chroma (Mauch & Dixon): resolve the semitone spectrum into
 * note activations by greedily explaining each partial with the lowest note
 * that could have produced it, so a single guitar note stops lighting up the
 * pitch classes of its own overtones.
 */
function noteSalience(logRow: Float32Array, tuningBins: number): Float32Array {
  // Resample the log-frequency row onto exact semitones with tuning applied.
  const semis = new Float32Array(N_NOTES);
  for (let n = 0; n < N_NOTES; n++) {
    const pos = n * BPS + tuningBins + (BPS >> 1) - (BPS >> 1);
    const i = Math.floor(pos);
    const fr = pos - i;
    const a = i >= 0 && i < N_LOG ? logRow[i]! : 0;
    const b = i + 1 >= 0 && i + 1 < N_LOG ? logRow[i + 1]! : 0;
    // sum the whole semitone band, centred on the tuned position
    let band = a * (1 - fr) + b * fr;
    for (let d = 1; d < BPS; d++) {
      const j = i + d;
      if (j >= 0 && j < N_LOG) band += logRow[j]! * 0.5;
    }
    semis[n] = band;
  }

  const residual = Float32Array.from(semis);
  const notes = new Float32Array(N_NOTES);
  for (let n = 0; n < N_NOTES; n++) {
    const a = residual[n]!;
    if (a <= 0) continue;
    notes[n] = a;
    for (let h = 1; h < HARMONIC_OFFSETS.length; h++) {
      const idx = n + HARMONIC_OFFSETS[h]!;
      if (idx >= N_NOTES) break;
      residual[idx] = Math.max(0, residual[idx]! - a * HARMONIC_DECAY[h]!);
    }
  }
  return notes;
}

function chromaFromNotes(notes: Float32Array, loMidi: number, hiMidi: number): Float32Array {
  const out = new Float32Array(12);
  for (let n = 0; n < N_NOTES; n++) {
    const midi = MIDI_LO + n;
    if (midi < loMidi || midi > hiMidi) continue;
    out[midi % 12] = out[midi % 12]! + notes[n]!;
  }
  // Normalise, then log-compress (Mueller) and strip the noise floor so
  // spectral leakage cannot masquerade as extra chord tones.
  let max = 0;
  for (let i = 0; i < 12; i++) if (out[i]! > max) max = out[i]!;
  if (max <= 0) return out;
  const gamma = 10;
  const denom = Math.log1p(gamma);
  const vals: number[] = [];
  for (let i = 0; i < 12; i++) {
    out[i] = Math.log1p((out[i]! / max) * gamma) / denom;
    vals.push(out[i]!);
  }
  const floor = median(vals);
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    out[i] = Math.max(0, out[i]! - floor * 0.9);
    if (out[i]! > peak) peak = out[i]!;
  }
  if (peak > 0) for (let i = 0; i < 12; i++) out[i] = out[i]! / peak;
  return out;
}

/* ------------------------------------------------------------------ */
/* Tempo + dynamic-programming beat tracking (Ellis)                    */
/* ------------------------------------------------------------------ */

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

function noveltyCurve(onset: Float32Array): Float32Array {
  const mean = movingAverage(onset, 32);
  const nov = new Float32Array(onset.length);
  let max = 0;
  for (let i = 0; i < onset.length; i++) {
    nov[i] = Math.max(0, onset[i]! - mean[i]!);
    if (nov[i]! > max) max = nov[i]!;
  }
  if (max > 0) for (let i = 0; i < nov.length; i++) nov[i] = nov[i]! / max;
  return nov;
}

function estimateTempo(nov: Float32Array, frameTime: number): number {
  let bestBpm = 120;
  let bestScore = -Infinity;
  for (let bpm = 55; bpm <= 200; bpm += 0.25) {
    const lag = Math.round(60 / bpm / frameTime);
    if (lag < 2 || lag >= nov.length) continue;
    let s = 0;
    for (let i = 0; i + lag < nov.length; i++) s += nov[i]! * nov[i + lag]!;
    // reinforce with the half/double-time lags so octave errors are less likely
    const lag2 = lag * 2;
    if (lag2 < nov.length) {
      let s2 = 0;
      for (let i = 0; i + lag2 < nov.length; i++) s2 += nov[i]! * nov[i + lag2]!;
      s += 0.5 * (s2 / (nov.length - lag2));
    }
    s /= nov.length - lag;
    const prior = Math.exp(-Math.pow(Math.log2(bpm / 118), 2) / 0.7);
    const score = s * prior;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return Math.round(bestBpm * 10) / 10;
}

/**
 * Ellis' dynamic-programming beat tracker: maximise onset strength along the
 * beat sequence while penalising deviation from the estimated period, which
 * tracks small tempo drift instead of assuming a rigid grid.
 */
function trackBeats(nov: Float32Array, frameTime: number, bpm: number): number[] {
  const n = nov.length;
  const period = 60 / bpm / frameTime;
  if (n < 4 || !Number.isFinite(period) || period < 2) return [];
  const tightness = 100;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const searchLo = Math.max(1, Math.round(period * 0.5));
  const searchHi = Math.max(searchLo + 1, Math.round(period * 2));

  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let bestIdx = -1;
    for (let d = searchLo; d <= searchHi; d++) {
      const prevIdx = t - d;
      if (prevIdx < 0) break;
      const penalty = -tightness * Math.pow(Math.log(d / period), 2);
      const v = score[prevIdx]! + penalty;
      if (v > best) {
        best = v;
        bestIdx = prevIdx;
      }
    }
    if (bestIdx < 0) {
      score[t] = nov[t]!;
      back[t] = -1;
    } else {
      score[t] = nov[t]! + best;
      back[t] = bestIdx;
    }
  }

  // Start backtrace from a strong late peak.
  let last = n - 1;
  let bestEnd = -Infinity;
  for (let t = Math.floor(n * 0.5); t < n; t++) {
    if (score[t]! > bestEnd) {
      bestEnd = score[t]!;
      last = t;
    }
  }
  const idx: number[] = [];
  for (let t = last; t >= 0; t = back[t]!) {
    idx.push(t);
    if (back[t]! < 0) break;
  }
  idx.reverse();
  const beats = idx.map((i) => Math.round(i * frameTime * 1000) / 1000);
  return beats.filter((t, i) => i === 0 || t - beats[i - 1]! > 0.12);
}

/* ------------------------------------------------------------------ */
/* Key estimation                                                       */
/* ------------------------------------------------------------------ */

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

/** Key from the decoded chord track — far more reliable than raw chroma. */
function keyFromChords(labels: string[], weights: number[]): { pc: number; mode: "major" | "minor" } {
  const hist = new Float32Array(12);
  const modeVote = new Float32Array(12);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label === "N") continue;
    const t = TEMPLATES.find((x) => x.label === label);
    if (!t) continue;
    const w = weights[i] ?? 1;
    for (const iv of t.intervals) hist[(t.rootPc + iv) % 12] = hist[(t.rootPc + iv) % 12]! + w;
    hist[t.rootPc] = hist[t.rootPc]! + w * 0.8;
    if (/^m(?!aj)/.test(label.replace(/^[A-G][#b]?/, ""))) modeVote[t.rootPc] = modeVote[t.rootPc]! + w;
  }
  let total = 0;
  for (const v of hist) total += v;
  const norm = Array.from(hist, (v) => v / (total || 1));

  let best = { pc: 0, mode: "major" as "major" | "minor", score: -Infinity };
  for (let shift = 0; shift < 12; shift++) {
    let maj = 0;
    let min = 0;
    for (let i = 0; i < 12; i++) {
      maj += norm[(i + shift) % 12]! * MAJOR_PROFILE[i]!;
      min += norm[(i + shift) % 12]! * MINOR_PROFILE[i]!;
    }
    // a minor tonic is only credible if minor chords actually occur on it
    min += modeVote[shift]! * 0.02;
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

/** Per-bin median over a frame range — robust to transients and passing notes. */
function medianChroma(chroma: Float32Array[], from: number, to: number): Float32Array {
  const a = Math.max(0, from);
  const b = Math.min(chroma.length, Math.max(a + 1, to));
  const out = new Float32Array(12);
  if (b <= a) return out;
  const scratch: number[] = [];
  for (let i = 0; i < 12; i++) {
    scratch.length = 0;
    for (let f = a; f < b; f++) scratch.push(chroma[f]![i]!);
    out[i] = median(scratch);
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 12; i++) out[i] = out[i]! / norm;
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/**
 * Recurrence-plot smoothing (Cho & Bello): songs repeat, so average each beat's
 * chroma with the most similar beats found elsewhere in the track. This is one
 * of the largest published accuracy gains for template/HMM chord recognition.
 */
function recurrenceSmooth(vecs: Float32Array[], k = 6, exclude = 4): Float32Array[] {
  const n = vecs.length;
  if (n < 32) return vecs.map((v) => Float32Array.from(v));
  const out: Float32Array[] = [];
  const cands: { j: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    cands.length = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(j - i) <= exclude) continue;
      cands.push({ j, s: cosine(vecs[i]!, vecs[j]!) });
    }
    cands.sort((x, y) => y.s - x.s);
    const acc = Float32Array.from(vecs[i]!);
    let wsum = 1;
    for (let m = 0; m < Math.min(k, cands.length); m++) {
      const c = cands[m]!;
      if (c.s < 0.85) break;
      const w = c.s * 0.5;
      const v = vecs[c.j]!;
      for (let d = 0; d < 12; d++) acc[d] = acc[d]! + v[d]! * w;
      wsum += w;
    }
    let norm = 0;
    for (let d = 0; d < 12; d++) {
      acc[d] = acc[d]! / wsum;
      norm += acc[d]! * acc[d]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < 12; d++) acc[d] = acc[d]! / norm;
    out.push(acc);
  }
  return out;
}

/** Mild temporal blur across neighbouring beats (harmony is locally stable). */
function temporalSmooth(vecs: Float32Array[], w = 0.35): Float32Array[] {
  return vecs.map((v, i) => {
    const acc = Float32Array.from(v);
    const prev = vecs[i - 1];
    const next = vecs[i + 1];
    for (let d = 0; d < 12; d++) {
      acc[d] = acc[d]! + (prev ? prev[d]! * w : 0) + (next ? next[d]! * w : 0);
    }
    let norm = 0;
    for (const x of acc) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < 12; d++) acc[d] = acc[d]! / norm;
    return acc;
  });
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
  let peak = 0;
  for (let j = 0; j < 12; j++) peak = Math.max(peak, vec[j]!);
  peak = peak || 1;

  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i]!;
    let dot = 0;
    for (let j = 0; j < 12; j++) dot += vec[j]! * t.vec[j]!;
    let s = dot * t.weight;

    // Complexity prior: only accept a 4-note chord when its colour tone is
    // actually strong in the chroma, otherwise a plain triad wins.
    if (t.intervals.length > 3) {
      const colour = t.intervals[3]!;
      const strength = vec[(t.rootPc + colour) % 12]! / peak;
      s -= 0.09 * (1 - Math.min(1, strength / 0.65));
    }
    // Penalise notes the chord claims but the audio does not support.
    let missing = 0;
    for (const iv of t.intervals) {
      if (vec[(t.rootPc + iv) % 12]! / peak < 0.28) missing++;
    }
    s -= 0.06 * missing;

    if (bassVec) {
      let bPeak = 0;
      for (let j = 0; j < 12; j++) bPeak = Math.max(bPeak, bassVec[j]!);
      s += 0.26 * (bassVec[t.rootPc]! / (bPeak || 1));
    }
    if (scale) {
      let outside = 0;
      for (const iv of t.intervals) {
        if (!scale.has((t.rootPc + iv) % 12)) outside++;
      }
      s -= 0.05 * outside;
      if (!scale.has(t.rootPc)) s -= 0.06;
    }
    out[i] = s;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Chord HMM with musically informed transitions                        */
/* ------------------------------------------------------------------ */

/** Distance around the circle of fifths (0..6). */
function fifthsDistance(a: number, b: number): number {
  const posA = (a * 7) % 12;
  const posB = (b * 7) % 12;
  const d = Math.abs(posA - posB);
  return Math.min(d, 12 - d);
}

/** Precomputed transition penalty between every pair of chord states. */
function buildTransitionMatrix(changeCost: number): Float32Array[] {
  const n = TEMPLATES.length;
  const rows: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const from = TEMPLATES[i]!;
    const row = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row[j] = 0;
        continue;
      }
      const to = TEMPLATES[j]!;
      // Nearby roots on the circle of fifths are the common progressions.
      const harmonic = 0.035 * fifthsDistance(from.rootPc, to.rootPc);
      // Changing quality on the same root (C -> Cm) is rarer than moving root.
      const sameRoot = from.rootPc === to.rootPc ? 0.05 : 0;
      row[j] = -(changeCost + harmonic + sameRoot);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Full Viterbi decoding over beat-synchronous emissions. Chord changes are
 * cheap on downbeats, dearer on the half bar and dearest off the bar grid,
 * which reproduces the one-to-four-chords-per-bar feel of real chord sheets.
 */
function viterbiDecode(
  emissions: Float32Array[],
  beatsPerBar: number,
  downbeatOffset: number,
  changeCost: number,
): number[] {
  const n = emissions.length;
  const states = TEMPLATES.length;
  if (n === 0) return [];
  const trans = buildTransitionMatrix(changeCost);

  let prev = Float32Array.from(emissions[0]!);
  const back: Int16Array[] = [];

  for (let t = 1; t < n; t++) {
    const inBar = (t - downbeatOffset + beatsPerBar * 8) % beatsPerBar;
    const positional =
      inBar === 0 ? 0 : inBar === Math.floor(beatsPerBar / 2) ? changeCost * 0.45 : changeCost * 0.9;

    const cur = new Float32Array(states);
    const bp = new Int16Array(states);
    const em = emissions[t]!;
    for (let s = 0; s < states; s++) {
      let best = -Infinity;
      let bestIdx = 0;
      for (let p = 0; p < states; p++) {
        const cost = p === s ? 0 : trans[p]![s]! - positional;
        const v = prev[p]! + cost;
        if (v > best) {
          best = v;
          bestIdx = p;
        }
      }
      cur[s] = best + em[s]!;
      bp[s] = bestIdx;
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

/**
 * Downbeat / metre: pick the bar length and phase that best explains where
 * harmony changes and where the onsets are strongest.
 */
function estimateMetre(
  emissions: Float32Array[],
  beatStrength: number[],
): { beatsPerBar: number; offset: number } {
  const best = { beatsPerBar: 4, offset: 0, score: -Infinity };
  const changeScore = emissions.map((em, i) => {
    if (i === 0) return 0;
    const prevEm = emissions[i - 1]!;
    let bestPrev = 0;
    let bestCur = 0;
    for (let s = 1; s < em.length; s++) {
      if (prevEm[s]! > prevEm[bestPrev]!) bestPrev = s;
      if (em[s]! > em[bestCur]!) bestCur = s;
    }
    return bestPrev === bestCur ? 0 : 1;
  });

  for (const bpb of [4, 3, 6]) {
    for (let off = 0; off < bpb; off++) {
      let s = 0;
      for (let i = 0; i < changeScore.length; i++) {
        const isDown = (i - off + bpb * 8) % bpb === 0;
        if (isDown) s += changeScore[i]! + 0.6 * (beatStrength[i] ?? 0);
        else s -= 0.25 * changeScore[i]!;
      }
      // slight prior for common time
      const prior = bpb === 4 ? 1.08 : bpb === 3 ? 1.0 : 0.92;
      const score = s * prior;
      if (score > best.score) {
        best.score = score;
        best.beatsPerBar = bpb;
        best.offset = off;
      }
    }
  }
  return { beatsPerBar: best.beatsPerBar, offset: best.offset };
}

export interface AnalyzeOptions {
  onProgress?: (pct: number, stage: string) => void;
}

export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const report = (p: number, s: string) => opts.onProgress?.(p, s);
  report(4, "Preparing audio");

  const signal = downmix(buffer);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  report(14, "Building constant-Q spectrogram");
  await tick();
  const { logSpec, onset, frameTime } = computeSpectrogram(signal, sampleRate);

  report(34, "Separating harmonic and percussive layers");
  await tick();
  const { harmonic, percussive } = hpss(logSpec);

  report(46, "Correcting tuning");
  await tick();
  const tuning = estimateTuning(harmonic);

  report(52, "Deconvolving harmonics");
  await tick();
  const chroma: Float32Array[] = [];
  const bassChroma: Float32Array[] = [];
  for (let t = 0; t < harmonic.length; t++) {
    const notes = noteSalience(harmonic[t]!, tuning);
    chroma.push(chromaFromNotes(notes, 40, 96));
    bassChroma.push(chromaFromNotes(notes, MIDI_LO, 52));
    if (t % 400 === 0) await tick();
  }

  report(66, "Tracking beats");
  await tick();
  // Percussive novelty gives a much cleaner beat than raw flux.
  const percNov = new Float32Array(percussive.length);
  for (let t = 1; t < percussive.length; t++) {
    let flux = 0;
    for (let k = 0; k < N_LOG; k++) {
      const d = percussive[t]![k]! - percussive[t - 1]![k]!;
      if (d > 0) flux += d;
    }
    percNov[t] = flux;
  }
  let nov = noveltyCurve(percNov);
  let novEnergy = 0;
  for (const v of nov) novEnergy += v;
  if (novEnergy < 1) nov = noveltyCurve(onset);

  const bpmEstimate = estimateTempo(nov, frameTime);
  let beats = trackBeats(nov, frameTime, bpmEstimate);
  if (beats.length < 8) {
    beats = [];
    for (let t = 0; t < duration; t += 60 / bpmEstimate) beats.push(Math.round(t * 1000) / 1000);
  }
  // Refine BPM from the tracked inter-beat intervals.
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const medIbi = median(ibis);
  const beatLen = medIbi > 0.15 && medIbi < 2 ? medIbi : 60 / bpmEstimate;
  const bpm = Math.round(60 / beatLen);

  // The DP backtrace only spans the region it locked onto; continue the pulse
  // at the measured period so the whole song has a beat grid.
  beats = beats.filter((t) => t >= 0 && t <= duration);
  if (beats.length === 0) beats.push(0);
  const filled: number[] = [];
  for (let t = beats[0]! - beatLen; t > 0.02; t -= beatLen) filled.push(t);
  filled.reverse();
  for (let i = 0; i < beats.length; i++) {
    filled.push(beats[i]!);
    const next = beats[i + 1];
    if (next !== undefined) {
      for (let t = beats[i]! + beatLen; next - t > beatLen * 0.6; t += beatLen) filled.push(t);
    }
  }
  for (let t = filled[filled.length - 1]! + beatLen; t < duration; t += beatLen) filled.push(t);
  beats = filled.map((t) => Math.round(t * 1000) / 1000).sort((a, b) => a - b);

  report(76, "Recognising chords");
  await tick();
  // Beat-synchronous chroma with a small pre/post window so sustained harmony
  // dominates the attack transient.
  const rawBeatChroma: Float32Array[] = [];
  const rawBeatBass: Float32Array[] = [];
  const beatEnergy: number[] = [];
  const beatStrength: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const start = beats[i]!;
    const end = i + 1 < beats.length ? beats[i + 1]! : duration;
    const span = Math.max(0.05, end - start);
    const f0 = Math.floor((start + span * 0.1) / frameTime);
    const f1 = Math.ceil((end + span * 0.1) / frameTime);
    // Median over the beat is far more robust than the mean to attacks,
    // melody notes and percussion leakage.
    const vec = medianChroma(chroma, f0, f1);
    rawBeatChroma.push(vec);
    rawBeatBass.push(medianChroma(bassChroma, f0, f1));
    let energy = 0;
    for (const v of averageChroma(chroma, f0, f1)) energy += v;
    beatEnergy.push(energy);
    beatStrength.push(nov[Math.min(nov.length - 1, Math.round(start / frameTime))] ?? 0);
  }

  report(80, "Matching repeated sections");
  await tick();
  // Structure-aware (recurrence-plot) smoothing, then a mild local blur.
  const beatChroma = rawBeatChroma;
  const beatBass = rawBeatBass;

  report(84, "Recognising chords");
  await tick();
  // Pass 1: no key prior.
  const rawEmissions = beatChroma.map((vec, i) => templateScores(vec, beatBass[i]!, null));
  const metre = estimateMetre(rawEmissions, beatStrength);
  const firstPass = viterbiDecode(rawEmissions, metre.beatsPerBar, metre.offset, 0.3);

  // Pass 2: condition on the key implied by pass 1.
  const firstLabels = firstPass.map((idx) => TEMPLATES[idx]!.label);
  const chordKey = keyFromChords(firstLabels, beatEnergy);
  const chromaKey = estimateKey(beatChroma);
  // Trust the decoded chord track, but fall back to the chroma key when the
  // first pass produced almost no harmonic information.
  const decodedChords = firstLabels.filter((l) => l !== "N").length;
  const key = decodedChords >= 8 ? chordKey : chromaKey;
  const scale = scaleOf(key.pc, key.mode);

  const emissions = beatChroma.map((vec, i) => templateScores(vec, beatBass[i]!, scale));
  const path = viterbiDecode(emissions, metre.beatsPerBar, metre.offset, 0.32);


  report(90, "Cleaning up");
  await tick();
  const smoothed: string[] = [];
  const beatScores: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const idx = path[i]!;
    const silent = beatEnergy[i]! < 0.35;
    smoothed.push(silent ? "N" : TEMPLATES[idx]!.label);
    beatScores.push(emissions[i]![idx]!);
  }

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
  chords = absorbShort(chords, beatLen * 0.9);

  report(100, "Done");
  return {
    duration,
    bpm,
    beats,
    key: pcToNote(key.pc) + (key.mode === "minor" ? "m" : ""),
    keyPc: key.pc,
    mode: key.mode,
    timeSignature: metre.beatsPerBar,
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
