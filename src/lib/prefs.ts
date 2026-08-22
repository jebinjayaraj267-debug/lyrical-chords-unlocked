import { useCallback, useEffect, useState } from "react";

const KEY = "chordlab.instrument";
const EVENT = "chordlab:instrument";

export function getInstrumentPref(): string {
  if (typeof window === "undefined") return "guitar";
  return window.localStorage.getItem(KEY) ?? "guitar";
}

export function setInstrumentPref(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Instrument preference shared across pages (read after hydration). */
export function useInstrument(): [string, (id: string) => void] {
  const [id, setId] = useState("guitar");

  useEffect(() => {
    const sync = () => setId(getInstrumentPref());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const set = useCallback((next: string) => {
    setId(next);
    setInstrumentPref(next);
  }, []);

  return [id, set];
}
