import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ChordDiagram } from "@/components/ChordDiagram";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import { LiveChordDetector } from "@/lib/audio-analysis";
import { SHARP_NOTES } from "@/lib/chords";
import { useInstrument } from "@/lib/prefs";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Chord Detection — One Chord Per Beat — ChordLab" },
      {
        name: "description",
        content:
          "Point your phone at a speaker or instrument and see one chord locked in on every beat or half beat, with diagrams for guitar, piano, ukulele, bass and banjo.",
      },
      { property: "og:title", content: "Live Chord Detection — ChordLab" },
      {
        property: "og:description",
        content: "Real-time chord recognition on a beat grid, for any instrument.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePage,
});

interface Cell {
  label: string;
  bar: number;
  beat: number;
}

function LivePage() {
  const detectorRef = useRef<LiveChordDetector | null>(null);
  const latestRef = useRef("N");
  const tapsRef = useRef<number[]>([]);
  const countRef = useRef(0);
  const [instrument, setInstrument] = useInstrument();
  const [running, setRunning] = useState(false);
  const [chord, setChord] = useState("—");
  const [chroma, setChroma] = useState<number[]>(Array(12).fill(0));
  const [grid, setGrid] = useState<Cell[]>([]);
  const [bpm, setBpm] = useState(90);
  const [division, setDivision] = useState<1 | 2>(1);
  const [pulse, setPulse] = useState(0);

  useEffect(() => () => detectorRef.current?.stop(), []);

  // Beat clock: commits whatever chord is being heard on every beat / half beat.
  useEffect(() => {
    if (!running) return;
    const ms = (60 / bpm) * 1000 * (division === 2 ? 0.5 : 1);
    const iv = window.setInterval(() => {
      const label = latestRef.current;
      const n = countRef.current++;
      const perBar = 4 * division;
      setPulse(n % perBar);
      setGrid((g) =>
        [
          ...g,
          {
            label: label === "N" ? "–" : label,
            bar: Math.floor(n / perBar) + 1,
            beat: (n % perBar) + 1,
          },
        ].slice(-64),
      );
    }, ms);
    return () => window.clearInterval(iv);
  }, [running, bpm, division]);

  const tap = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 3000);
    taps.push(now);
    tapsRef.current = taps;
    if (taps.length >= 2) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]!);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const next = Math.round(60000 / avg);
      if (next >= 40 && next <= 220) setBpm(next);
    }
  }, []);

  async function start() {
    try {
      const d = new LiveChordDetector();
      detectorRef.current = d;
      await d.start((label, c) => {
        latestRef.current = label;
        setChord(label === "N" ? "—" : label);
        setChroma(Array.from(c));
      });
      countRef.current = 0;
      setGrid([]);
      setRunning(true);
    } catch {
      toast.error("Microphone access was blocked");
    }
  }

  function stop() {
    detectorRef.current?.stop();
    detectorRef.current = null;
    setRunning(false);
    setChord("—");
  }

  const perBar = 4 * division;

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Live chords</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One chord is locked in on every {division === 2 ? "half beat" : "beat"} while you play.
      </p>

      <div className="panel mt-5 flex flex-col items-center gap-4 p-6">
        <div className="flex h-28 items-center justify-center">
          <span className="chord-token text-6xl">{chord}</span>
        </div>
        {chord !== "—" && <ChordDiagram chord={chord} size={96} instrument={instrument} />}

        <div className="mt-1 grid w-full grid-cols-12 gap-1">
          {chroma.map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex h-16 w-full items-end rounded bg-surface-2">
                <div
                  className="w-full rounded bg-accent transition-[height] duration-100"
                  style={{ height: `${Math.max(2, v * 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{SHARP_NOTES[i]}</span>
            </div>
          ))}
        </div>

        <Button
          size="lg"
          className="w-full"
          variant={running ? "destructive" : "default"}
          onClick={running ? stop : start}
        >
          {running ? <Square className="size-4" /> : <Mic className="size-4" />}
          {running ? "Stop listening" : "Start listening"}
        </Button>
      </div>

      <div className="panel mt-4 space-y-4 p-4">
        <InstrumentPicker value={instrument} onChange={setInstrument} />

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Resolution</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={division === 1 ? "default" : "secondary"}
              onClick={() => setDivision(1)}
            >
              1 / beat
            </Button>
            <Button
              size="sm"
              variant={division === 2 ? "default" : "secondary"}
              onClick={() => setDivision(2)}
            >
              1 / half beat
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Tempo</span>
          <span className="font-mono text-sm text-chord">{bpm} BPM</span>
        </div>
        <Slider
          min={40}
          max={200}
          step={1}
          value={[bpm]}
          onValueChange={([v]) => setBpm(v ?? 90)}
        />
        <Button variant="secondary" className="w-full" onClick={tap}>
          <Timer className="size-4" /> Tap tempo
        </Button>

        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: perBar }).map((_, i) => (
            <span
              key={i}
              className={`size-2.5 rounded-full transition-colors ${
                running && pulse === i ? "bg-primary" : "bg-surface-2"
              }`}
            />
          ))}
        </div>
      </div>

      {grid.length > 0 && (
        <div className="panel mt-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Beat grid</h2>
            <Button variant="ghost" size="sm" onClick={() => setGrid([])}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div
            className="mt-3 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${perBar}, minmax(0, 1fr))` }}
          >
            {grid.map((c, i) => (
              <div
                key={i}
                className={`rounded-md px-1 py-2 text-center font-mono text-xs ${
                  c.beat === 1 ? "bg-surface-2 text-chord" : "bg-surface-2/50 text-chord"
                }`}
              >
                {c.label}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each cell is one {division === 2 ? "half beat" : "beat"}; each row is a bar of 4.
          </p>
        </div>
      )}
    </div>
  );
}
