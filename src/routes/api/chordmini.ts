import { createFileRoute } from "@tanstack/react-router";

/**
 * Proxy to a ChordMini backend (https://www.chordmini.me/docs).
 *
 * The audio file is forwarded as multipart/form-data to the ChordMini Flask
 * backend for beat tracking and chord recognition. The base URL is private to
 * the deployment and is read from CHORDMINI_API_URL at request time.
 */

const MAX_BYTES = 20 * 1024 * 1024;

type Failure = { ok: false; reason: string };

function fail(reason: string, status = 200): Response {
  return Response.json({ ok: false, reason } satisfies Failure, { status });
}

async function callChordMini(base: string, path: string, file: File, model: string) {
  const body = new FormData();
  body.append("file", file, file.name || "audio");
  if (model) body.append("model", model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error("rate-limited");
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/chordmini")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const base = (process.env["CHORDMINI_API_URL"] ?? "").replace(/\/+$/, "");
        if (!base) return fail("ChordMini is not configured");

        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("multipart/form-data")) {
          return fail("Expected multipart/form-data", 415);
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return fail("Could not read the uploaded audio", 400);
        }

        const file = form.get("file");
        if (!(file instanceof File)) return fail("No audio file provided", 400);
        if (file.size === 0) return fail("Audio file is empty", 400);
        if (file.size > MAX_BYTES) return fail("Audio file is larger than 20 MB", 413);

        const beatModel = String(form.get("beatModel") ?? "auto");
        const chordModel = String(form.get("chordModel") ?? "chord-cnn-lstm");
        const allowedBeat = new Set(["auto", "madmom", "beat-transformer"]);
        const allowedChord = new Set(["chord-cnn-lstm"]);
        if (!allowedBeat.has(beatModel) || !allowedChord.has(chordModel)) {
          return fail("Unknown model requested", 400);
        }

        try {
          const [beats, chords] = await Promise.all([
            callChordMini(base, "/api/detect-beats", file, beatModel),
            callChordMini(base, "/api/recognize-chords", file, chordModel),
          ]);
          return Response.json({ ok: true, beats, chords, models: { beatModel, chordModel } });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          console.error("ChordMini proxy failed:", message);
          if (message === "rate-limited") return fail("ChordMini is rate-limited right now");
          if (message.includes("abort")) return fail("ChordMini timed out");
          return fail("ChordMini could not analyse this audio");
        }
      },
    },
  },
});
