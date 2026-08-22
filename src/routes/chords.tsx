import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getInstrument,
  LIBRARY_QUALITIES,
  LIBRARY_ROOTS,
  pianoNotes,
  voicingsFor,
} from "@/lib/instruments";
import { useInstrument } from "@/lib/prefs";

export const Route = createFileRoute("/chords")({
  head: () => ({
    meta: [
      { title: "Chord Library — Guitar, Piano, Ukulele, Bass & Banjo — ChordLab" },
      {
        name: "description",
        content:
          "Browse chord diagrams for guitar, drop D, bass, ukulele, banjo, mandolin and piano — every root and quality with alternative voicings.",
      },
      { property: "og:title", content: "Chord Library — ChordLab" },
      {
        property: "og:description",
        content: "Chord shapes for every instrument, from major and minor to 7ths, sus and dim.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChordLibraryPage,
});

function ChordLibraryPage() {
  const [instrument, setInstrument] = useInstrument();
  const [root, setRoot] = useState("C");
  const [quality, setQuality] = useState("");
  const [q, setQ] = useState("");

  const inst = getInstrument(instrument);
  const chord = root + quality;

  const results = useMemo(() => {
    const term = q.trim();
    if (!term) return null;
    return LIBRARY_ROOTS.flatMap((r) =>
      LIBRARY_QUALITIES.map((x) => r + x.id).filter((c) =>
        c.toLowerCase().startsWith(term.toLowerCase()),
      ),
    ).slice(0, 24);
  }, [q]);

  const voicings = useMemo(
    () => (inst.kind === "fretted" ? voicingsFor(chord, inst, 3) : []),
    [chord, inst],
  );
  const keys = inst.kind === "keys" ? pianoNotes(chord) : null;

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Chord library</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every chord, drawn for whichever instrument you play.
      </p>

      <div className="panel mt-5 p-4">
        <InstrumentPicker value={instrument} onChange={setInstrument} />
        <Input
          className="mt-3"
          placeholder="Search a chord, e.g. F#m7"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {results ? (
        <div className="panel mt-4 grid grid-cols-3 gap-3 p-4">
          {results.length === 0 && (
            <p className="col-span-3 text-sm text-muted-foreground">No chord matches that.</p>
          )}
          {results.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setQ("");
                const m = /^([A-G]#?)(.*)$/.exec(c);
                if (m) {
                  setRoot(m[1]!);
                  setQuality(m[2]!);
                }
              }}
              className="flex justify-center rounded-lg p-1 transition-colors hover:bg-surface-2"
            >
              <ChordDiagram chord={c} instrument={instrument} size={72} />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="panel mt-4 p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Root</p>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {LIBRARY_ROOTS.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={r === root ? "default" : "secondary"}
                  onClick={() => setRoot(r)}
                >
                  {r}
                </Button>
              ))}
            </div>

            <p className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">Type</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIBRARY_QUALITIES.map((x) => (
                <Button
                  key={x.id || "maj"}
                  size="sm"
                  variant={x.id === quality ? "default" : "secondary"}
                  onClick={() => setQuality(x.id)}
                >
                  {x.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="panel mt-4 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="chord-token text-2xl">{chord}</h2>
              <span className="text-xs text-muted-foreground">{inst.name}</span>
            </div>

            {inst.kind === "keys" ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                <ChordDiagram chord={chord} instrument={instrument} size={140} showLabel={false} />
                <p className="font-mono text-sm text-chord">{keys?.names.join(" · ")}</p>
              </div>
            ) : voicings.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No playable shape for {chord} on {inst.short}.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-5">
                {voicings.map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <ChordDiagram
                      chord={chord}
                      instrument={instrument}
                      size={92}
                      variant={i}
                      showLabel={false}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {i === 0 ? "Easiest" : `Voicing ${i + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel mt-4 p-4">
            <h2 className="text-sm font-semibold">All {LIBRARY_QUALITIES.find((x) => x.id === quality)?.name.toLowerCase()} chords</h2>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {LIBRARY_ROOTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoot(r)}
                  className="flex justify-center rounded-lg p-1 transition-colors hover:bg-surface-2"
                >
                  <ChordDiagram chord={r + quality} instrument={instrument} size={72} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
