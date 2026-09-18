import { STEMS, type StemName } from "./studio";

export interface SeparationResult {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  error: string | null;
  output: Record<string, string> | null;
}

export async function startSeparation(file: File | Blob): Promise<string> {
  const form = new FormData();
  form.append("file", file, "audio");
  const res = await fetch("/api/separate", { method: "POST", body: form });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? "Could not start separation.");
  return body.id;
}

export async function pollSeparation(id: string): Promise<SeparationResult> {
  const res = await fetch(`/api/separate?id=${encodeURIComponent(id)}`);
  const body = (await res.json()) as SeparationResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not check that job.");
  return body;
}

export async function fetchStem(url: string): Promise<Blob> {
  const res = await fetch(`/api/separate?download=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Could not download a separated track.");
  return await res.blob();
}

/** Picks the four stems out of whatever the model returned. */
export function stemUrls(output: Record<string, string>): { name: StemName; url: string }[] {
  return STEMS.flatMap((name) => {
    const url = output[name];
    return url ? [{ name, url }] : [];
  });
}
