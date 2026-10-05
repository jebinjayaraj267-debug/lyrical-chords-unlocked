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
  return STEMS.flatMap((name) => {
    const entry = Object.entries(archive).find(([path]) =>
      new RegExp(`(?:^|/)${name}\\.(?:mp3|wav|m4a)$`, "i").test(path),
    );
    return entry
      ? [{
          name,
          blob: new Blob([entry[1]], {
            type: path.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg",
          }),
        }]
      : [];
  });
}
