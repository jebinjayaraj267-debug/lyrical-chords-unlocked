import { createFileRoute } from "@tanstack/react-router";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { zipSync } from "fflate";

const execFileAsync = promisify(execFile);
const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;
const MAX_BYTES = 50 * 1024 * 1024;

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
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "No audio file was sent." }, 400);
        if (file.size === 0) return json({ error: "The audio file is empty." }, 400);
        if (file.size > MAX_BYTES)
          return json({ error: "That file is too large to separate (50 MB max)." }, 400);

        const workDir = await mkdtemp(join(tmpdir(), "chordlab-demucs-"));
        const inputName = basename(file.name || "audio.mp3").replace(/[^a-zA-Z0-9._-]/g, "_");
        const inputPath = join(workDir, inputName);
        const outputDir = join(workDir, "output");
        try {
          await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
          const python = process.env["DEMUCS_PYTHON"] ?? "python3";
          const model = process.env["DEMUCS_MODEL"] ?? "htdemucs";
          const script = join(process.cwd(), "scripts", "demucs_cpu.py");
          await execFileAsync(
            python,
            [
              script,
              "-n",
              model,
              "--float32",
              "-o",
              outputDir,
              inputPath,
            ],
            { timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 },
          );

          const files = await readdir(join(outputDir, model), { recursive: true });
          const archive: Record<string, Uint8Array> = {};
          for (const stem of STEM_NAMES) {
            const relative = files.find((path) => path.toLowerCase().endsWith(`/${stem}.wav`));
            if (relative) archive[`${stem}.wav`] = await readFile(join(outputDir, model, relative));
          }
          if (Object.keys(archive).length !== STEM_NAMES.length) {
            throw new Error("Demucs completed without producing all four stems");
          }

          return new Response(zipSync(archive), {
            headers: { "Content-Type": "application/zip" },
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Could not run Demucs.";
          const hint = detail.includes("No module named")
            ? " Install Demucs with: python3 -m pip install -U demucs."
            : "";
          console.error("Demucs separation failed:", detail);
          return json({ error: `Demucs could not separate this audio.${hint}` }, 502);
        } finally {
          await rm(workDir, { recursive: true, force: true });
        }
      },
    },
  },
});
