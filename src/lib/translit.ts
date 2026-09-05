import LEXICON from "./tanglish-lexicon.json";

/**
 * Tamil -> Tanglish spellings learned from the open Worship Songs songbook
 * (mcruncher/worshipsongs), where each Tamil line is followed by the Roman
 * spelling a native singer actually uses. Only word pairs seen at least twice
 * across ~19.5k aligned lines are kept.
 */
const LEX = LEXICON as Record<string, string>;

const TAMIL_RE = /[\u0B80-\u0BFF]/;

export function hasTamil(text: string): boolean {
  return TAMIL_RE.test(text);
}

const PUNCT = /^[^\u0B80-\u0BFF]+|[^\u0B80-\u0BFF]+$/g;

/** Known Roman spelling for a Tamil word, ignoring surrounding punctuation. */
export function lookupTanglish(word: string): string | null {
  const core = word.replace(PUNCT, "");
  if (!core) return null;
  return LEX[core] ?? null;
}

/** Character fallback for words the songbook never covered. */
const VOWELS: Record<string, string> = {
  "\u0B85": "a", "\u0B86": "aa", "\u0B87": "i", "\u0B88": "ee", "\u0B89": "u",
  "\u0B8A": "oo", "\u0B8E": "e", "\u0B8F": "ae", "\u0B90": "ai", "\u0B92": "o",
  "\u0B93": "oa", "\u0B94": "au",
};
const SIGNS: Record<string, string> = {
  "\u0BBE": "aa", "\u0BBF": "i", "\u0BC0": "ee", "\u0BC1": "u", "\u0BC2": "oo",
  "\u0BC6": "e", "\u0BC7": "ae", "\u0BC8": "ai", "\u0BCA": "o", "\u0BCB": "oa",
  "\u0BCC": "au", "\u0BCD": "",
};
const CONS: Record<string, string> = {
  "\u0B95": "k", "\u0B99": "ng", "\u0B9A": "ch", "\u0B9E": "nj", "\u0B9F": "t",
  "\u0BA3": "n", "\u0BA4": "th", "\u0BA8": "n", "\u0BAA": "p", "\u0BAE": "m",
  "\u0BAF": "y", "\u0BB0": "r", "\u0BB2": "l", "\u0BB5": "v", "\u0BB4": "zh",
  "\u0BB3": "l", "\u0BB1": "r", "\u0BA9": "n", "\u0B9C": "j", "\u0BB6": "sh",
  "\u0BB7": "sh", "\u0BB8": "s", "\u0BB9": "h",
};

export function transliterateTamilWord(word: string): string {
  const known = lookupTanglish(word);
  if (known) return known;
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    if (VOWELS[ch]) out += VOWELS[ch];
    else if (CONS[ch]) {
      out += CONS[ch];
      const next = word[i + 1];
      if (!next || (!SIGNS[next] && next !== "\u0BCD")) out += "a";
    } else if (ch in SIGNS) out += SIGNS[ch];
    else if (!TAMIL_RE.test(ch)) out += ch;
  }
  return out;
}

/** Offline Tanglish for a whole lyric block, one output line per input line. */
export function transliterateTamilText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      /^\s*\[/.test(line) || !hasTamil(line)
        ? line
        : line.replace(/\S+/g, (w) => (hasTamil(w) ? transliterateTamilWord(w) : w)),
    )
    .join("\n");
}

/**
 * Authoritative spellings for the Tamil words present in this lyric, so the
 * model matches the songbook's conventions instead of inventing spellings.
 */
export function tanglishGlossary(text: string, limit = 140): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const core = raw.replace(PUNCT, "");
    if (!core || seen.has(core)) continue;
    seen.add(core);
    const hit = LEX[core];
    if (hit) out.push(`${core} = ${hit}`);
    if (out.length >= limit) break;
  }
  return out;
}
