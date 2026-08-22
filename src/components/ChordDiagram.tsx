import { useMemo } from "react";

import { getInstrument, pianoNotes, voicingsFor, type Instrument } from "@/lib/instruments";

interface Props {
  chord: string;
  size?: number;
  instrument?: string;
  /** which alternative voicing to show (0 = easiest) */
  variant?: number;
  showLabel?: boolean;
}

export function ChordDiagram({
  chord,
  size = 76,
  instrument = "guitar",
  variant = 0,
  showLabel = true,
}: Props) {
  const inst = getInstrument(instrument);
  return (
    <div className="flex w-fit flex-col items-center gap-1">
      {showLabel && <span className="chord-token text-sm">{chord}</span>}
      {inst.kind === "keys" ? (
        <PianoDiagram chord={chord} width={size * 1.5} />
      ) : (
        <FretDiagram chord={chord} instrument={inst} size={size} variant={variant} />
      )}
    </div>
  );
}

function FretDiagram({
  chord,
  instrument,
  size,
  variant,
}: {
  chord: string;
  instrument: Instrument;
  size: number;
  variant: number;
}) {
  const shapes = useMemo(() => voicingsFor(chord, instrument, 3), [chord, instrument]);
  const shape = shapes[Math.min(variant, Math.max(0, shapes.length - 1))] ?? null;

  const strings = instrument.tuning.length;
  const frets = instrument.frets;
  const w = size;
  const h = size * 1.3;
  const padX = w * 0.15;
  const padTop = h * 0.2;
  const padBottom = h * 0.12;
  const gridW = w - padX * 2;
  const gridH = h - padTop - padBottom;
  const sx = gridW / (strings - 1);
  const fy = gridH / frets;

  const played = (shape ?? []).filter((f) => f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const baseFret = minFret > 4 ? minFret : 1;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${chord} chord for ${instrument.name}`}
    >
      {!shape && (
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          fill="var(--color-muted-foreground)"
          fontSize={w * 0.16}
        >
          ?
        </text>
      )}
      {shape && (
        <g>
          {Array.from({ length: strings }).map((_, i) => (
            <line
              key={`s${i}`}
              x1={padX + i * sx}
              y1={padTop}
              x2={padX + i * sx}
              y2={padTop + gridH}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: frets + 1 }).map((_, i) => (
            <line
              key={`f${i}`}
              x1={padX}
              y1={padTop + i * fy}
              x2={padX + gridW}
              y2={padTop + i * fy}
              stroke="var(--color-border)"
              strokeWidth={i === 0 && baseFret === 1 ? 3 : 1}
            />
          ))}
          {baseFret > 1 && (
            <text
              x={padX - 4}
              y={padTop + fy * 0.75}
              textAnchor="end"
              fill="var(--color-muted-foreground)"
              fontSize={w * 0.13}
            >
              {baseFret}
            </text>
          )}
          {shape.map((fret, i) => {
            const x = padX + i * sx;
            if (fret === -1)
              return (
                <text
                  key={i}
                  x={x}
                  y={padTop - 4}
                  textAnchor="middle"
                  fill="var(--color-muted-foreground)"
                  fontSize={w * 0.14}
                >
                  ×
                </text>
              );
            if (fret === 0)
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={padTop - w * 0.07}
                  r={w * 0.045}
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth={1.5}
                />
              );
            const rel = fret - baseFret + 1;
            if (rel < 1 || rel > frets) return null;
            return (
              <circle
                key={i}
                cx={x}
                cy={padTop + rel * fy - fy / 2}
                r={w * 0.07}
                fill="var(--color-primary)"
              />
            );
          })}
          {instrument.labels.map((l, i) => (
            <text
              key={`l${i}`}
              x={padX + i * sx}
              y={h - 1}
              textAnchor="middle"
              fill="var(--color-muted-foreground)"
              fontSize={w * 0.11}
            >
              {l}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = [0, 1, 3, 4, 5]; // white index within an octave that has a black key after it

function PianoDiagram({ chord, width }: { chord: string; width: number }) {
  const notes = pianoNotes(chord);
  const octaves = 2;
  const whites = 7 * octaves;
  const kw = width / whites;
  const kh = kw * 3.4;
  const bw = kw * 0.62;
  const bh = kh * 0.62;
  const active = new Set((notes?.pcs ?? []).map((p) => ((p % 24) + 24) % 24));

  const isOn = (pc: number, octave: number) => {
    const rel = pc + octave * 12;
    return active.has(rel % 24) || active.has(rel);
  };

  return (
    <svg width={width} height={kh + 2} viewBox={`0 0 ${width} ${kh + 2}`} role="img" aria-label={`${chord} on piano`}>
      {Array.from({ length: octaves }).map((_, o) =>
        WHITE_PC.map((pc, i) => {
          const x = (o * 7 + i) * kw;
          const on = isOn(pc, o);
          return (
            <rect
              key={`w${o}-${i}`}
              x={x}
              y={0}
              width={kw - 1}
              height={kh}
              rx={2}
              fill={on ? "var(--color-primary)" : "var(--color-card)"}
              stroke="var(--color-border)"
            />
          );
        }),
      )}
      {Array.from({ length: octaves }).map((_, o) =>
        BLACK_AFTER.map((i) => {
          const pc = WHITE_PC[i]! + 1;
          const x = (o * 7 + i) * kw + kw - bw / 2;
          const on = isOn(pc, o);
          return (
            <rect
              key={`b${o}-${i}`}
              x={x}
              y={0}
              width={bw}
              height={bh}
              rx={2}
              fill={on ? "var(--color-primary)" : "var(--color-foreground)"}
              stroke="var(--color-border)"
            />
          );
        }),
      )}
    </svg>
  );
}
