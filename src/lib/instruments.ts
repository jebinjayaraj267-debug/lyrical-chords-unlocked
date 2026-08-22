import { noteToPc, parseChord, pcToNote } from "./chords";

export type InstrumentId =
  | "guitar"
  | "guitar-dropd"
  | "bass"
  | "ukulele"
  | "banjo"
  | "mandolin"
  | "piano";

export interface Instrument {
  id: InstrumentId;
  name: string;
  short: string;
  kind: "fretted" | "keys";
  /** MIDI notes, lowest drawn string first (left to right on the diagram) */
  tuning: number[];
  /** labels drawn under each string */
  labels: string[];
  frets: number;
  /** strings that may be left ringing open but are not fingered (banjo 5th) */
  drone?: number[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: "guitar",
    name: "Guitar (standard)",
    short: "Guitar",
    kind: "fretted",
    tuning: [40, 45, 50, 55, 59, 64],
    labels: ["E", "A", "D", "G", "B", "E"],
    frets: 5,
  },
  {
    id: "guitar-dropd",
    name: "Guitar (drop D)",
    short: "Drop D",
    kind: "fretted",
    tuning: [38, 45, 50, 55, 59, 64],
    labels: ["D", "A", "D", "G", "B", "E"],
    frets: 5,
  },
  {
    id: "bass",
    name: "Bass guitar",
    short: "Bass",
    kind: "fretted",
    tuning: [28, 33, 38, 43],
    labels: ["E", "A", "D", "G"],
    frets: 5,
  },
  {
    id: "ukulele",
    name: "Ukulele (GCEA)",
    short: "Ukulele",
    kind: "fretted",
    tuning: [67, 60, 64, 69],
    labels: ["G", "C", "E", "A"],
    frets: 5,
  },
  {
    id: "banjo",
    name: "Banjo (open G)",
    short: "Banjo",
    kind: "fretted",
    tuning: [67, 50, 55, 59, 62],
    labels: ["g", "D", "G", "B", "D"],
    frets: 5,
    drone: [0],
  },
  {
    id: "mandolin",
    name: "Mandolin (GDAE)",
    short: "Mandolin",
    kind: "fretted",
    tuning: [55, 62, 69, 76],
    labels: ["G", "D", "A", "E"],
    frets: 5,
  },
  {
    id: "piano",
    name: "Piano / keys",
    short: "Piano",
    kind: "keys",
    tuning: [],
    labels: [],
    frets: 0,
  },
];

export function getInstrument(id: string): Instrument {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0]!;
}

/* ------------------------------------------------------------------ */
/* Chord tones                                                         */
/* ------------------------------------------------------------------ */

const QUALITY_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  "5": [0, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  "-": [0, 3, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "69": [0, 4, 7, 9, 2],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  Δ: [0, 4, 7, 11],
  Δ7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  "9": [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  "11": [0, 7, 10, 2, 5],
  m11: [0, 3, 7, 10, 5],
  "13": [0, 4, 7, 10, 9],
  add9: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
  sus: [0, 5, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  dim: [0, 3, 6],
  "°": [0, 3, 6],
  dim7: [0, 3, 6, 9],
  "°7": [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  ø: [0, 3, 6, 10],
  aug: [0, 4, 8],
  "+": [0, 4, 8],
  "7#5": [0, 4, 8, 10],
  "7b9": [0, 4, 7, 10, 1],
};

function normalizeQuality(q: string) {
  return q.replace(/^min(?!aj)/, "m").replace(/^M(?=aj)/, "maj");
}

export interface ChordTones {
  rootPc: number;
  bassPc: number;
  pcs: number[];
  /** intervals above the root, used to name each note */
  intervals: number[];
}

export function chordTones(label: string): ChordTones | null {
  const p = parseChord(label);
  if (!p) return null;
  const rootPc = noteToPc(p.root);
  if (rootPc === null) return null;
  const q = normalizeQuality(p.quality);
  const intervals = QUALITY_INTERVALS[q] ?? QUALITY_INTERVALS[q.replace(/[()]/g, "")] ?? null;
  const iv = intervals ?? (/^m/.test(q) ? [0, 3, 7] : [0, 4, 7]);
  const bassPc = p.bass ? (noteToPc(p.bass) ?? rootPc) : rootPc;
  return {
    rootPc,
    bassPc,
    pcs: iv.map((i) => (rootPc + i) % 12),
    intervals: iv,
  };
}

/** Note names of a chord, ordered low to high for a keyboard diagram. */
export function pianoNotes(label: string, useFlats = false): { pcs: number[]; names: string[] } | null {
  const t = chordTones(label);
  if (!t) return null;
  const pcs: number[] = [];
  if (t.bassPc !== t.rootPc) pcs.push(t.bassPc);
  let last = t.bassPc;
  for (const pc of t.pcs) {
    let v = pc;
    while (v < last) v += 12;
    pcs.push(v);
    last = v;
  }
  return { pcs, names: pcs.map((p) => pcToNote(p % 12, useFlats)) };
}

/* ------------------------------------------------------------------ */
/* Fretted voicing search                                              */
/* ------------------------------------------------------------------ */

const cache = new Map<string, (number[] | null)[]>();

/**
 * Find playable voicings for a chord on a fretted instrument.
 * Returns fret numbers per string, -1 = muted, 0 = open.
 */
export function voicingsFor(label: string, instrument: Instrument, max = 3): number[][] {
  const key = `${instrument.id}|${label}|${max}`;
  const hit = cache.get(key);
  if (hit) return hit.filter(Boolean) as number[][];

  const tones = chordTones(label);
  if (!tones) {
    cache.set(key, []);
    return [];
  }

  const n = instrument.tuning.length;
  const span = 4;
  const required = new Set(tones.pcs.slice(0, 4));
  const candidates: { frets: number[]; score: number }[] = [];

  for (let base = 0; base <= 9; base++) {
    const options: number[][] = instrument.tuning.map((open, i) => {
      const list: number[] = [-1];
      if (instrument.drone?.includes(i)) return [0, -1];
      if (base > 0) list.push(0);
      const lo = base === 0 ? 0 : base;
      for (let f = lo; f < lo + span; f++) list.push(f);
      void open;
      return Array.from(new Set(list));
    });

    const frets: number[] = new Array(n).fill(-1);
    const walk = (i: number) => {
      if (candidates.length > 4000) return;
      if (i === n) {
        const score = scoreVoicing(frets, instrument, tones, required);
        if (score !== null) candidates.push({ frets: [...frets], score });
        return;
      }
      for (const f of options[i]!) {
        frets[i] = f;
        walk(i + 1);
      }
      frets[i] = -1;
    };
    walk(0);
  }

  candidates.sort((a, b) => a.score - b.score);
  const out: number[][] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const k = c.frets.join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c.frets);
    if (out.length >= max) break;
  }
  cache.set(key, out);
  return out;
}

export function voicingFor(label: string, instrument: Instrument): number[] | null {
  return voicingsFor(label, instrument, 1)[0] ?? null;
}

function scoreVoicing(
  frets: number[],
  instrument: Instrument,
  tones: ChordTones,
  required: Set<number>,
): number | null {
  const n = frets.length;
  const sounding: { pc: number; midi: number; string: number }[] = [];
  for (let i = 0; i < n; i++) {
    const f = frets[i]!;
    if (f < 0) continue;
    const midi = instrument.tuning[i]! + f;
    sounding.push({ pc: ((midi % 12) + 12) % 12, midi, string: i });
  }
  const minVoices = Math.min(required.size, instrument.tuning.length >= 5 ? 4 : 3);
  if (sounding.length < minVoices) return null;

  // every sounding note must belong to the chord
  const pcSet = new Set(tones.pcs);
  for (const s of sounding) if (!pcSet.has(s.pc)) return null;

  // coverage: root + third/fourth + fifth at minimum
  const have = new Set(sounding.map((s) => s.pc));
  let missing = 0;
  for (const pc of required) if (!have.has(pc)) missing++;
  if (missing > (required.size > 3 ? 1 : 0)) return null;

  // no muted string sandwiched between sounding strings
  const first = frets.findIndex((f) => f >= 0);
  const last = n - 1 - [...frets].reverse().findIndex((f) => f >= 0);
  for (let i = first; i <= last; i++) if (frets[i]! < 0 && !instrument.drone?.includes(i)) return null;

  const fingered = frets.filter((f) => f > 0);
  const lowFret = fingered.length ? Math.min(...fingered) : 0;
  const highFret = fingered.length ? Math.max(...fingered) : 0;
  if (highFret - lowFret > 3) return null;

  // count fingers, allowing a barre on the lowest fingered fret
  const atLow = fingered.filter((f) => f === lowFret).length;
  const fingers = fingered.length - (atLow > 1 ? atLow - 1 : 0);
  if (fingers > 4) return null;

  const bass = sounding.reduce((a, b) => (a.midi <= b.midi ? a : b));
  let score = 0;
  score += missing * 6;
  score += bass.pc === tones.bassPc ? 0 : bass.pc === tones.rootPc ? 2 : 8;
  score += (n - sounding.length) * 3;
  score += lowFret * 1.2;
  score += fingers * 1.5;
  score += (highFret - lowFret) * 1.5;
  return score;
}

/** Simplify a chord label down to plain major or minor. */
export function simplifyChord(label: string): string {
  const p = parseChord(label);
  if (!p) return label;
  const q = normalizeQuality(p.quality);
  const minor = /^(m|dim|°|ø)/.test(q) && !/^maj/.test(q);
  return p.root + (minor ? "m" : "");
}

/* Common chord roots + qualities used by the chord library page */
export const LIBRARY_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const LIBRARY_QUALITIES = [
  { id: "", name: "Major" },
  { id: "m", name: "Minor" },
  { id: "7", name: "Dominant 7th" },
  { id: "maj7", name: "Major 7th" },
  { id: "m7", name: "Minor 7th" },
  { id: "sus2", name: "Sus2" },
  { id: "sus4", name: "Sus4" },
  { id: "6", name: "6th" },
  { id: "9", name: "9th" },
  { id: "dim", name: "Diminished" },
  { id: "aug", name: "Augmented" },
  { id: "add9", name: "Add9" },
];
