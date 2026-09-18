import { createFileRoute } from "@tanstack/react-router";

/**
 * Stem separation proxy. POST an audio file to start a Demucs job on Replicate,
 * GET `?id=` to poll it, GET `?download=` to stream a finished stem back to the
 * app (keeps the API token server-side and avoids cross-origin fetch issues).
 */
const MODEL = "ryan5453/demucs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/separate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["REPLICATE_API_TOKEN"];
        if (!token) return json({ error: "Stem separation is not configured yet." }, 503);

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "No audio file was sent." }, 400);
        if (file.size > 60 * 1024 * 1024)
          return json({ error: "That file is too large to separate (60 MB max)." }, 400);

        const upload = new FormData();
        upload.append("content", file, file.name || "audio.mp3");
        const uploaded = await fetch("https://api.replicate.com/v1/files", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: upload,
        });
        if (!uploaded.ok) {
          return json({ error: `Upload failed (${uploaded.status}).` }, 502);
        }
        const fileRes = (await uploaded.json()) as { urls?: { get?: string } };
        const audioUrl = fileRes.urls?.get;
        if (!audioUrl) return json({ error: "Upload failed." }, 502);

        const started = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: { audio: audioUrl, stem: "", output_format: "mp3" },
          }),
        });
        const prediction = (await started.json()) as { id?: string; detail?: string };
        if (!started.ok || !prediction.id) {
          return json({ error: prediction.detail ?? "Could not start separation." }, 502);
        }
        return json({ id: prediction.id });
      },

      GET: async ({ request }) => {
        const token = process.env["REPLICATE_API_TOKEN"];
        const url = new URL(request.url);
        const download = url.searchParams.get("download");

        if (download) {
          if (!/^https:\/\/[a-z0-9.-]*replicate\.(delivery|com)\//i.test(download)) {
            return json({ error: "Unsupported download source." }, 400);
          }
          const res = await fetch(download, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok || !res.body) return json({ error: "Download failed." }, 502);
          return new Response(res.body, {
            headers: { "Content-Type": res.headers.get("content-type") ?? "audio/mpeg" },
          });
        }

        if (!token) return json({ error: "Stem separation is not configured yet." }, 503);
        const id = url.searchParams.get("id");
        if (!id || !/^[a-z0-9]+$/i.test(id)) return json({ error: "Missing job id." }, 400);

        const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as {
          status?: string;
          error?: string;
          output?: Record<string, string> | null;
        };
        if (!res.ok) return json({ error: "Could not check that job." }, 502);
        return json({
          status: body.status ?? "unknown",
          error: body.error ?? null,
          output: body.output ?? null,
        });
      },
    },
  },
});
