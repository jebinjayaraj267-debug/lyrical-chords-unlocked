import type { AnalysisResult, ChordEvent } from "./audio-analysis";
import { transposeChord } from "./chords";

export interface SheetChord {
  /** character column in the lyric line */
  pos: number;
  label: string;
  time: number;
}

export interface SheetLine {
  chords: SheetChord[];
  lyric: string;
  roman?: string;
}

export interface SheetSection {
  name: string;
  lines: SheetLine[];
}

export interface Sheet {
  sections: SheetSection[];
}

const SECTION_WORDS =
  "intro|verse|pre[- ]?chorus|chorus|hook|bridge|refrain|interlude|solo|outro|coda|charanam|pallavi|anupallavi|mukhda|antara";

/** Bracketed marker, e.g. [Chorus 2] or (Bridge). */
const BRACKET_SECTION_RE = /^\s*[[(]\s*([^\]\n)]{1,40})\s*[\])]\s*:?\s*$/;
/** Bare marker on its own line, e.g. "Chorus:" or "Verse 2". */
const BARE_SECTION_RE = new RegExp(`^\\s*(${SECTION_WORDS})\\s*\\d{0,2}\\s*:?\\s*$`, "i");

function sectionNameOf(line: string): string | null {
  const bracket = BRACKET_SECTION_RE.exec(line);
  if (bracket) return titleCase(bracket[1]!.trim());
  const bare = BARE_SECTION_RE.exec(line);
  if (bare) return titleCase(line.replace(/[:]/g, "").trim());
  return null;
}

function isSectionLine(line: string): boolean {
  return sectionNameOf(line) !== null;
}

/** Collapse repeated chords and drop no-chord regions. */
export function condenseChords(events: ChordEvent[]): ChordEvent[] {
  const out: ChordEvent[] = [];
  for (const e of events) {
    if (e.label === "N") continue;
    const last = out[out.length - 1];
    if (last && last.label === e.label) last.end = e.end;
    else out.push({ ...e });
  }
  return out;
}

function splitBlocks(lyrics: string): { name: string; lines: string[] }[] {
  const blocks: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  let n = 0;

  for (const raw of lyrics.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const sectionName = sectionNameOf(line);
    if (sectionName) {
      current = { name: sectionName, lines: [] };
      blocks.push(current);
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    if (!current) {
      n += 1;
      current = { name: `Part ${n}`, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  return blocks.filter((b) => b.lines.length > 0);
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/** Snap a column to the nearest word start so chords sit above syllables. */
function snapToWord(line: string, col: number): number {
  if (col <= 0) return 0;
  if (col >= line.length) return line.length;
  const starts: number[] = [];
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const ws = /\s/.test(line[i]!);
    if (!ws && !inWord) starts.push(i);
    inWord = !ws;
  }
  if (starts.length === 0) return col;
  return starts.reduce((a, b) => (Math.abs(b - col) < Math.abs(a - col) ? b : a), starts[0]!);
}

export function buildSheet(
  analysis: AnalysisResult,
  lyrics: string,
  romanized = "",
): Sheet {
  const chords = condenseChords(analysis.chords);
  const romanLines = romanized
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim() && !isSectionLine(l));

  if (!lyrics.trim()) return instrumentalSheet(analysis, chords);

  const blocks = splitBlocks(lyrics);
  const totalLines = blocks.reduce((a, b) => a + b.lines.length, 0) || 1;

  let chordIdx = 0;
  let lineCounter = 0;
  let romanIdx = 0;

  const sections: SheetSection[] = blocks.map((block) => ({
    name: block.name,
    lines: block.lines.map((lyric) => {
      lineCounter += 1;
      const target = Math.round((lineCounter / totalLines) * chords.length);
      const slice = chords.slice(chordIdx, Math.max(chordIdx + 1, target));
      chordIdx = Math.max(chordIdx + 1, target);

      const spread = Math.max(lyric.length, 8);
      const placed: SheetChord[] = [];
      slice.forEach((c, i) => {
        const raw = slice.length === 1 ? 0 : Math.round((i / slice.length) * spread);
        let pos = snapToWord(lyric, raw);
        const prev = placed[placed.length - 1];
        if (prev && pos <= prev.pos + prev.label.length) pos = prev.pos + prev.label.length + 1;
        placed.push({ pos, label: c.label, time: c.start });
      });

      const roman = romanLines[romanIdx++];
      const showRoman = roman && roman.trim() !== lyric.trim();
      return { chords: placed, lyric, ...(showRoman ? { roman } : {}) };
    }),
  }));

  const leftovers = chords.slice(chordIdx);
  if (leftovers.length) {
    sections.push({
      name: "Outro",
      lines: chunk(leftovers, 4).map((group) => ({
        chords: group.map((c, i) => ({ pos: i * 8, label: c.label, time: c.start })),
        lyric: "",
      })),
    });
  }

  return { sections };
}

function instrumentalSheet(analysis: AnalysisResult, chords: ChordEvent[]): Sheet {
  const beat = 60 / (analysis.bpm || 120);
  const barLen = beat * analysis.timeSignature;
  const bars: ChordEvent[][] = [];
  for (const c of chords) {
    const barIdx = Math.floor(c.start / barLen);
    bars[barIdx] = bars[barIdx] ?? [];
    bars[barIdx]!.push(c);
  }
  const filled = bars.filter(Boolean);
  const lines: SheetLine[] = chunk(filled, 4).map((group) => {
    const flat = group.flat();
    let col = 0;
    const placed: SheetChord[] = [];
    for (const c of flat) {
      placed.push({ pos: col, label: c.label, time: c.start });
      col += Math.max(c.label.length + 1, 6);
    }
    return { chords: placed, lyric: "" };
  });
  return { sections: [{ name: "Progression", lines }] };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function chordLineToText(chords: SheetChord[], semitones: number, useFlats: boolean) {
  let out = "";
  for (const c of chords) {
    if (c.pos > out.length) out += " ".repeat(c.pos - out.length);
    out += transposeChord(c.label, semitones, useFlats) + " ";
  }
  return out.trimEnd();
}

export interface SheetTextOptions {
  title: string;
  artist: string;
  key: string;
  bpm: number;
  capo: number;
  transpose: number;
  useFlats: boolean;
  showRoman: boolean;
}

export function sheetToText(sheet: Sheet, o: SheetTextOptions): string {
  const head = [
    o.title || "Untitled",
    o.artist ? `by ${o.artist}` : "",
    `Key: ${o.key}   Tempo: ${Math.round(o.bpm)} BPM   Capo: ${o.capo ? `${o.capo}th fret` : "none"}`,
    "",
  ].filter((l) => l !== null);

  const body: string[] = [];
  for (const section of sheet.sections) {
    body.push(`[${section.name}]`);
    for (const line of section.lines) {
      const cl = chordLineToText(line.chords, o.transpose, o.useFlats);
      if (cl) body.push(cl);
      if (line.lyric) body.push(line.lyric);
      if (o.showRoman && line.roman) body.push(line.roman);
    }
    body.push("");
  }
  return [...head, ...body].join("\n");
}

export function uniqueChords(sheet: Sheet, semitones: number, useFlats: boolean): string[] {
  const set = new Set<string>();
  for (const s of sheet.sections)
    for (const l of s.lines)
      for (const c of l.chords) set.add(transposeChord(c.label, semitones, useFlats));
  return [...set];
}
