import { forwardRef } from "react";

import { transposeChord } from "@/lib/chords";
import type { Sheet } from "@/lib/sheet";

interface Props {
  sheet: Sheet;
  title: string;
  artist: string;
  keyLabel: string;
  bpm: number;
  capo: number;
  transpose: number;
  useFlats: boolean;
  showRoman: boolean;
  fontSize: number;
  activeChordTime?: number | null;
}

/** Ultimate-Guitar style monospace chord sheet. */
export const ChordSheetView = forwardRef<HTMLDivElement, Props>(function ChordSheetView(
  {
    sheet,
    title,
    artist,
    keyLabel,
    bpm,
    capo,
    transpose,
    useFlats,
    showRoman,
    fontSize,
    activeChordTime,
  },
  ref,
) {
  return (
    <div ref={ref} className="rounded-xl bg-sheet p-4 text-sheet-foreground">
      <header className="mb-4 border-b border-border pb-3">
        <h2 className="text-lg font-semibold leading-tight">{title || "Untitled"}</h2>
        {artist && <p className="text-sm text-muted-foreground">{artist}</p>}
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Key {keyLabel} · {Math.round(bpm)} BPM · Capo {capo ? `fret ${capo}` : "none"}
          {transpose ? ` · Transposed ${transpose > 0 ? "+" : ""}${transpose}` : ""}
        </p>
      </header>

      <div style={{ fontSize: `${fontSize}px`, lineHeight: 1.45 }} className="font-mono">
        {sheet.sections.map((section, si) => (
          <section key={si} className="mb-5">
            <h3 className="mb-1 font-sans text-xs font-bold uppercase tracking-widest text-accent">
              [{section.name}]
            </h3>
            {section.lines.map((line, li) => (
              <div key={li} className="mb-1">
                {line.chords.length > 0 && (
                  <pre className="whitespace-pre font-mono">
                    {renderChordLine(line.chords, transpose, useFlats, activeChordTime)}
                  </pre>
                )}
                {line.lyric && <pre className="whitespace-pre-wrap">{line.lyric}</pre>}
                {showRoman && line.roman && (
                  <pre className="whitespace-pre-wrap text-muted-foreground">{line.roman}</pre>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
});

function renderChordLine(
  chords: Props["sheet"]["sections"][number]["lines"][number]["chords"],
  transpose: number,
  useFlats: boolean,
  activeTime?: number | null,
) {
  const out: React.ReactNode[] = [];
  let col = 0;
  chords.forEach((c, i) => {
    if (c.pos > col) {
      out.push(" ".repeat(c.pos - col));
      col = c.pos;
    }
    const label = transposeChord(c.label, transpose, useFlats);
    const active = activeTime != null && Math.abs(activeTime - c.time) < 0.001;
    out.push(
      <span key={i} className={active ? "chord-token rounded bg-primary/25 px-0.5" : "chord-token"}>
        {label}
      </span>,
    );
    out.push(" ");
    col += label.length + 1;
  });
  return out;
}
