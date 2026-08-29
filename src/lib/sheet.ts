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

export interface SyncedLyricLine {
  time: number;
  text: string;
}

function normalizeForMatch(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Map each lyric line to the timestamped line it corresponds to, in order.
 * Returns null when too few lines match to trust the timings.
 */
function windowsFromSynced(
  allLines: string[],
  synced: SyncedLyricLine[],
  songEnd: number,
): { from: number; to: number }[] | null {
  if (synced.length < 2) return null;
  const times: (number | null)[] = allLines.map(() => null);
  let si = 0;
  let matched = 0;

  for (let i = 0; i < allLines.length; i++) {
    const target = normalizeForMatch(allLines[i]!);
    if (!target) continue;
    for (let probe = si; probe < Math.min(synced.length, si + 8); probe++) {
      const candidate = normalizeForMatch(synced[probe]!.text);
      if (!candidate) continue;
      if (candidate === target || candidate.startsWith(target) || target.startsWith(candidate)) {
        times[i] = synced[probe]!.time;
        si = probe + 1;
        matched += 1;
        break;
      }
    }
  }

  if (matched < Math.max(2, Math.ceil(allLines.length * 0.5))) return null;

  // Fill unmatched lines by interpolating between known anchors.
  const first = times.findIndex((t) => t !== null);
  const last = times.length - 1 - [...times].reverse().findIndex((t) => t !== null);
  for (let i = 0; i < first; i++) times[i] = synced[0]!.time;
  for (let i = last + 1; i < times.length; i++) times[i] = times[last]!;
  for (let i = first; i <= last; i++) {
    if (times[i] !== null) continue;
    let j = i;
    while (j <= last && times[j] === null) j += 1;
    const before = times[i - 1]!;
    const after = times[j] ?? before;
    const steps = j - i + 1;
    for (let k = i; k < j; k++) times[k] = before + ((after - before) * (k - i + 1)) / steps;
    i = j - 1;
  }

  const end = Math.max(songEnd, times[last]! + 4);
  return times.map((t, i) => ({
    from: t!,
    to: i + 1 < times.length ? Math.max(t! + 0.2, times[i + 1]!) : end,
  }));
}

export function buildSheet(
  analysis: AnalysisResult,
  lyrics: string,
  romanized = "",
  synced: SyncedLyricLine[] = [],
): Sheet {
  const chords = condenseChords(analysis.chords);
  const romanLines = romanized
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim() && !isSectionLine(l));

  if (!lyrics.trim()) return instrumentalSheet(analysis, chords);

  const blocks = splitBlocks(lyrics);
  const allLines = blocks.flatMap((b) => b.lines);
  if (allLines.length === 0 || chords.length === 0) return instrumentalSheet(analysis, chords);

  const songStart = chords[0]!.start;
  const songEnd = chords[chords.length - 1]!.end;
  const span = Math.max(0.001, songEnd - songStart);

  // Prefer real timestamps when we have them; otherwise fall back to slicing
  // the timeline by how much text each line holds.
  let windows = windowsFromSynced(allLines, synced, songEnd);
  if (!windows) {
    const weights = allLines.map((l) => Math.max(4, l.trim().length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    windows = [];
    let acc = 0;
    for (const w of weights) {
      const from = songStart + (acc / totalWeight) * span;
      acc += w;
      windows.push({ from, to: songStart + (acc / totalWeight) * span });
    }
  }

  const perLine: SheetChord[][] = allLines.map(() => []);
  let li = 0;
  for (const c of chords) {
    while (li < windows.length - 1 && c.start >= windows[li]!.to) li += 1;
    const win = windows[li]!;
    const lyric = allLines[li]!;
    const frac = Math.min(1, Math.max(0, (c.start - win.from) / Math.max(0.001, win.to - win.from)));
    const target = Math.round(frac * Math.max(lyric.length - 1, 1));
    perLine[li]!.push({ pos: target, label: c.label, time: c.start });
  }

  // A line with no chord change still has a chord sounding over it — carry the
  // last one forward so no lyric line is left bare (matches real chord sheets).
  let carry: SheetChord | null = null;
  for (let i = 0; i < perLine.length; i++) {
    const list = perLine[i]!;
    if (list.length === 0) {
      if (carry) list.push({ ...carry, pos: 0 });
    } else {
      carry = list[list.length - 1]!;
    }
  }

  // Snap to word starts, drop duplicates that land on the same word, keep spacing legible.
  const laidOut = perLine.map((list, i) => {
    const lyric = allLines[i]!;
    const placed: SheetChord[] = [];
    for (const c of list) {
      let pos = lyric.trim() ? snapToWord(lyric, c.pos) : c.pos;
      const prev = placed[placed.length - 1];
      if (prev) {
        if (prev.label === c.label && pos <= prev.pos + prev.label.length + 1) continue;
        if (pos <= prev.pos + prev.label.length) pos = prev.pos + prev.label.length + 1;
      }
      if (pos > lyric.length && placed.length > 0) continue;
      placed.push({ ...c, pos });
    }
    return placed;
  });


  let idx = 0;
  let romanIdx = 0;
  const sections: SheetSection[] = blocks.map((block) => ({
    name: block.name,
    lines: block.lines.map((lyric) => {
      const placed = laidOut[idx++] ?? [];
      const roman = romanLines[romanIdx++];
      const showRoman = roman && roman.trim() !== lyric.trim();
      return { chords: placed, lyric, ...(showRoman ? { roman } : {}) };
    }),
  }));

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
