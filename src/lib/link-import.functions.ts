import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface LinkMeta {
  source: "youtube" | "spotify" | "other";
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
}

/**
 * Import public metadata for a YouTube or Spotify link via oEmbed.
 * Streaming platforms do not permit downloading their audio, so only the
 * title, artist and artwork are imported — the audio itself comes from a
 * file the user picks or records.
 */
export const importLink = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data }): Promise<LinkMeta> => {
    const url = data.url.trim();
    const host = new URL(url).hostname.replace(/^www\./, "");

    const source: LinkMeta["source"] = /youtube\.com|youtu\.be/.test(host)
      ? "youtube"
      : /spotify\.com/.test(host)
        ? "spotify"
        : "other";

    if (source === "other") {
      throw new Error("Paste a YouTube or Spotify link");
    }

    const endpoint =
      source === "youtube"
        ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
        : `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;

    const res = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("Could not read that link");
    const json = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    let title = (json.title ?? "").trim();
    let artist = (json.author_name ?? "").replace(/\s*-\s*Topic$/i, "").trim();

    const dash = title.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
    if (dash) {
      artist = dash[1]!.trim();
      title = dash[2]!.trim();
    }
    title = title.replace(/\s*[([][^)\]]*(official|video|lyric|audio|hd|4k)[^)\]]*[)\]]/gi, "").trim();

    return {
      source,
      title,
      artist,
      thumbnail: json.thumbnail_url ?? "",
      url,
    };
  });
