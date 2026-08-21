export const SHARP_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const FLAT_NOTES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

export function noteToPc(note: string): number | null {
  const n = note.charAt(0).toUpperCase() + note.slice(1);
  return n in NOTE_INDEX ? NOTE_INDEX[n]! : null;
}

export function pcToNote(pc: number, useFlats = false): string {
  const i = ((pc % 12) + 12) % 12;
  return useFlats ? FLAT_NOTES[i]! : SHARP_NOTES[i]!;
}

/** Matches a chord token like C#m7/G# or Bbsus4 */
export const CHORD_RE = /^([A-G](?:#|b)?)((?:maj|min|m|dim|aug|sus|add|M)?[0-9a-zA-Z+#°Δ()-]*)(?:\/([A-G](?:#|b)?))?$/;

export interface ParsedChord {
  root: string;
  quality: string;
  bass?: string;
}

export function parseChord(token: string): ParsedChord | null {
  const m = CHORD_RE.exec(token.trim());
  if (!m) return null;
  const [, root, quality, bass] = m;
  if (!root) return null;
  return { root, quality: quality ?? "", ...(bass ? { bass } : {}) };
}

export function transposeChord(token: string, semitones: number, useFlats = false): string {
  const parsed = parseChord(token);
  if (!parsed) return token;
  const rootPc = noteToPc(parsed.root);
  if (rootPc === null) return token;
  let out = pcToNote(rootPc + semitones, useFlats) + parsed.quality;
  if (parsed.bass) {
    const bassPc = noteToPc(parsed.bass);
    if (bassPc !== null) out += "/" + pcToNote(bassPc + semitones, useFlats);
  }
  return out;
}

export function isChordToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return CHORD_RE.test(t);
}

/** A text line counts as a chord line when most of its tokens are chords. */
export function looksLikeChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const chords = tokens.filter(isChordToken).length;
  return chords / tokens.length >= 0.6;
}

export const KEY_NAMES = (useFlats = false) =>
  Array.from({ length: 12 }, (_, i) => pcToNote(i, useFlats));

/** Nashville-style roman numerals for a chord within a key. */
const MAJOR_DEGREES = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];

export function romanNumeral(chord: string, keyPc: number): string {
  const p = parseChord(chord);
  if (!p) return "";
  const pc = noteToPc(p.root);
  if (pc === null) return "";
  const deg = MAJOR_DEGREES[(((pc - keyPc) % 12) + 12) % 12]!;
  const minor = /^(m|min)(?!aj)/.test(p.quality);
  return minor ? deg.toLowerCase() : deg;
}

/** Guitar voicings: string order low E -> high E. -1 = muted, 0 = open. */
export const GUITAR_SHAPES: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0],
  Cm: [-1, 3, 5, 5, 4, 3],
  C7: [-1, 3, 2, 3, 1, 0],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  "C#": [-1, 4, 3, 1, 2, 1],
  "C#m": [-1, 4, 6, 6, 5, 4],
  D: [-1, -1, 0, 2, 3, 2],
  Dm: [-1, -1, 0, 2, 3, 1],
  D7: [-1, -1, 0, 2, 1, 2],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Dm7: [-1, -1, 0, 2, 1, 1],
  "D#": [-1, -1, 1, 3, 4, 3],
  "D#m": [-1, -1, 1, 3, 4, 2],
  E: [0, 2, 2, 1, 0, 0],
  Em: [0, 2, 2, 0, 0, 0],
  E7: [0, 2, 0, 1, 0, 0],
  Em7: [0, 2, 2, 0, 3, 0],
  Emaj7: [0, 2, 1, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1],
  Fm: [1, 3, 3, 1, 1, 1],
  F7: [1, 3, 1, 2, 1, 1],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  "F#": [2, 4, 4, 3, 2, 2],
  "F#m": [2, 4, 4, 2, 2, 2],
  "F#m7": [2, 4, 2, 2, 2, 2],
  G: [3, 2, 0, 0, 0, 3],
  Gm: [3, 5, 5, 3, 3, 3],
  G7: [3, 2, 0, 0, 0, 1],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  "G#": [4, 6, 6, 5, 4, 4],
  "G#m": [4, 6, 6, 4, 4, 4],
  A: [-1, 0, 2, 2, 2, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  "A#": [-1, 1, 3, 3, 3, 1],
  "A#m": [-1, 1, 3, 3, 2, 1],
  B: [-1, 2, 4, 4, 4, 2],
  Bm: [-1, 2, 4, 4, 3, 2],
  B7: [-1, 2, 1, 2, 0, 2],
  Bm7: [-1, 2, 4, 2, 3, 2],
};

export function shapeFor(chord: string): number[] | null {
  if (GUITAR_SHAPES[chord]) return GUITAR_SHAPES[chord]!;
  const p = parseChord(chord);
  if (!p) return null;
  const pc = noteToPc(p.root);
  if (pc === null) return null;
  const sharpRoot = pcToNote(pc);
  const q = p.quality.replace(/^min(?!aj)/, "m");
  return GUITAR_SHAPES[sharpRoot + q] ?? GUITAR_SHAPES[sharpRoot + (q.startsWith("m") ? "m" : "")] ?? null;
}
