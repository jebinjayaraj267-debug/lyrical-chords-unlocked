export interface CatalogChord {
  _id?: string;
  name?: { eng?: string; spa?: string };
  notes?: Array<{ name?: string | { eng?: string } } | string>;
  images?: { pos1?: string };
}

export async function fetchCatalogChord(label: string): Promise<CatalogChord | null> {
  try {
    const response = await fetch(`/api/chords?label=${encodeURIComponent(label)}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; chord?: CatalogChord | null };
    return payload.ok ? (payload.chord ?? null) : null;
  } catch {
    return null;
  }
}
