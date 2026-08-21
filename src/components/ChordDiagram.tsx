import { shapeFor } from "@/lib/chords";

interface Props {
  chord: string;
  size?: number;
}

export function ChordDiagram({ chord, size = 76 }: Props) {
  const shape = shapeFor(chord);
  const w = size;
  const h = size * 1.25;
  const padX = w * 0.14;
  const padTop = h * 0.2;
  const padBottom = h * 0.08;
  const gridW = w - padX * 2;
  const gridH = h - padTop - padBottom;
  const strings = 6;
  const frets = 5;
  const sx = gridW / (strings - 1);
  const fy = gridH / frets;

  const played = (shape ?? []).filter((f) => f > 0);
  const minFret = played.length ? Math.min(...played) : 1;
  const baseFret = minFret > 4 ? minFret : 1;

  return (
    <div className="flex w-fit flex-col items-center gap-1">
      <span className="chord-token text-sm">{chord}</span>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${chord} chord`}>
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
          </g>
        )}
      </svg>
    </div>
  );
}
