import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface SyncedLine {
  /** seconds */
  time: number;
  text: string;
}

export interface SyncedLyricsResult {
  found: boolean;
  plain: string;
  synced: SyncedLine[];
  trackName?: string;
  artistName?: string;
}

const Input = z.object({
  title: z.string().min(1).max(200),
  artist: z.string().max(200).optional(),
  duration: z.number().min(0).max(3600).optional(),
});

interface LrcLibHit {
  trackName?: string;
  artistName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** Parse an LRC body into timestamped lines. */
export function parseLrc(lrc: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of lrc.replace(/\r/g, "").split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const s of stamps) {
      const frac = s[3] ? Number(`0.${s[3]}`) : 0;
      out.push({ time: Number(s[1]) * 60 + Number(s[2]) + frac, text });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Fetch time-synced lyrics from LRCLIB (the same source ChordMini's
 * /api/lrclib-lyrics endpoint uses). Public, key-free and read-only.
 */
export const fetchSyncedLyrics = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<SyncedLyricsResult> => {
    const params = new URLSearchParams();
    params.set("track_name", data.title.trim());
    if (data.artist?.trim()) params.set("artist_name", data.artist.trim());

    let hits: LrcLibHit[] = [];
    try {
      const res = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
        headers: { accept: "application/json", "user-agent": "ChordLab (chord sheet app)" },
      });
      if (res.ok) hits = (await res.json()) as LrcLibHit[];
    } catch (error) {
      console.error("LRCLIB search failed", error);
    }

    if (!Array.isArray(hits) || hits.length === 0) {
      return { found: false, plain: "", synced: [] };
    }

    const scored = hits
      .map((h) => {
        let score = 0;
        if (h.syncedLyrics) score += 10;
        if (h.plainLyrics) score += 2;
        if (data.duration && h.duration) {
          score += Math.max(0, 6 - Math.abs(h.duration - data.duration) / 2);
        }
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0]!.h;
    const synced = best.syncedLyrics ? parseLrc(best.syncedLyrics) : [];
    const plain = (best.plainLyrics ?? synced.map((l) => l.text).join("\n")).trim();

    return {
      found: Boolean(plain || synced.length),
      plain,
      synced,
      ...(best.trackName ? { trackName: best.trackName } : {}),
      ...(best.artistName ? { artistName: best.artistName } : {}),
    };
  });
