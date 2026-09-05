import { createServerFn } from "@tanstack/react-start";
import { streamText } from "ai";
import { z } from "zod";

import { hasTamil, tanglishGlossary, transliterateTamilText } from "./translit";


const Input = z.object({
  lyrics: z.string().min(1),
  style: z.enum(["hinglish", "tanglish", "auto", "english"]),
});

const STYLE_PROMPT: Record<string, string> = {
  hinglish:
    "Transliterate Devanagari/Hindi/Urdu text into Hinglish (Roman script Hindi as commonly typed by Indian users).",
  tanglish:
    "Transliterate Tamil text into Tanglish (Roman script Tamil as commonly typed by Tamil speakers).",
  auto: "Detect the script/language of each line and transliterate it into the natural Roman-script form used by native speakers (Hinglish for Hindi/Urdu, Tanglish for Tamil, and similar for other Indic languages). Leave lines that are already in Roman script unchanged.",
  english:
    "Provide a plain-English meaning for each line, keeping one output line per input line.",
};

/**
 * Transliterates lyric text the user supplied themselves. It never fetches or
 * generates song lyrics — it only converts the user's own input line by line.
 */
export const romanizeLyrics = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const tamil = hasTamil(data.lyrics) && data.style !== "english";
    const offline = () => (tamil ? { text: transliterateTamilText(data.lyrics) } : null);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      const fallback = offline();
      if (fallback) return fallback;
      throw new Error("AI is not configured for this app.");
    }

    const gateway = (
      await import("./ai-gateway.server")
    ).createLovableAiGatewayProvider(apiKey);

    const glossary = tamil ? tanglishGlossary(data.lyrics) : [];

    const system = [
      "You are a transliteration engine for song lyrics that the user already has.",
      STYLE_PROMPT[data.style],
      "Rules: output ONLY the converted text. Preserve the exact number of lines and the line order.",
      "Preserve blank lines and section markers such as [Verse] or [Chorus] exactly as given.",
      "Do not translate unless asked, do not add commentary, do not add or remove lines.",
      glossary.length
        ? `Use exactly these Roman spellings for the Tamil words listed (they come from a Tamil songbook and are authoritative): ${glossary.join("; ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const result = streamText({
        model: gateway("google/gemini-3.7-flash"),
        system,
        prompt: data.lyrics,
      });
      const text = await result.text;
      const trimmed = text.trim();
      if (!trimmed) {
        const fallback = offline();
        if (fallback) return fallback;
      }
      return { text: trimmed };
    } catch (error) {
      const fallback = offline();
      if (fallback) return fallback;
      const status = (error as { statusCode?: number; status?: number })?.statusCode ??
        (error as { status?: number })?.status;
      if (status === 429) throw new Error("Too many requests right now — try again in a moment.");
      if (status === 402) throw new Error("AI credits are exhausted for this workspace.");
      throw new Error("Transliteration failed. Please try again.");
    }
  });

