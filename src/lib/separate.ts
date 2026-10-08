import { unzipSync } from "fflate";
import { STEMS, type StemName } from "./studio";

export async function startSeparation(
  file: File | Blob,
): Promise<{ name: StemName; blob: Blob }[]> {
  const form = new FormData();
  form.append("file", file, "audio");
  const res = await fetch("/api/separate", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not separate stems.");
  }
  const archive = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const entries = Object.entries(archive);
  return STEMS.flatMap<{ name: StemName; blob: Blob }>((name) => {
    const entry = entries.find(([path]) =>
      new RegExp(`(?:^|/)${name}\\.(?:mp3|wav|m4a)$`, "i").test(path),
    );
    if (!entry) return [];
    const [path, bytes] = entry;
    return [
      {
        name,
        blob: new Blob([bytes], {
          type: path.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
        }),
      },
    ];
  });
}
