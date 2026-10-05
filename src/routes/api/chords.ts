import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_BASE = "https://chords.alday.dev/v1";

function noteId(root: string): string {
  const normalized = root.toLowerCase();
  return normalized.length === 2 && normalized[1] === "#"
    ? `${normalized[0]}_sharp`
    : normalized.length === 2 && normalized[1] === "b"
      ? `${normalized[0]}_flat`
      : normalized;
}

function typeId(quality: string): string | null {
  if (!quality || quality === "maj") return "major";
  if (quality === "m" || quality === "min") return "minor";
  if (quality === "dim") return "dim";
  if (quality === "7") return "7";
  return null;
}

export const Route = createFileRoute("/api/chords")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const match = /^([A-Ga-g](?:#|b)?)(.*)$/.exec(url.searchParams.get("label") ?? "");
        if (!match)
          return Response.json({ ok: false, reason: "Invalid chord label" }, { status: 400 });

        const type = typeId(match[2]!);
        if (!type) return Response.json({ ok: true, chord: null });

        const base = (process.env["CHORDS_API_URL"] ?? DEFAULT_BASE).replace(/\/+$/, "");
        const target = new URL(`${base}/chords`);
        target.searchParams.set("note", noteId(match[1]!));
        target.searchParams.set("type", type);
        target.searchParams.set("limit", "all");

        try {
          const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) return Response.json({ ok: true, chord: null });
          const payload = (await response.json()) as { data?: unknown[] };
          const requested = `${match[1]}${match[2]}`
            .toLowerCase()
            .replace(/maj$/, "major")
            .replace(/^([a-g](?:#|b)?)m$/, "$1minor");
          const chord = (payload.data ?? []).find((item) => {
            if (!item || typeof item !== "object") return false;
            const name = (item as { name?: { eng?: string } }).name?.eng ?? "";
            return name.replace(/\s+/g, "").toLowerCase() === requested;
          });
          return Response.json({ ok: true, chord: chord ?? null });
        } catch {
          return Response.json({ ok: true, chord: null });
        }
      },
    },
  },
});
