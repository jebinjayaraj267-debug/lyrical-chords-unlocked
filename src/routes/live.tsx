import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChordDiagram } from "@/components/ChordDiagram";
import { LiveChordDetector } from "@/lib/audio-analysis";
import { SHARP_NOTES } from "@/lib/chords";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Chord Detection — ChordLab" },
      {
        name: "description",
        content:
          "Point your phone at a speaker or instrument and see chords recognised in real time.",
      },
      { property: "og:title", content: "Live Chord Detection — ChordLab" },
      {
        property: "og:description",
        content: "Real-time chord recognition from your microphone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const detectorRef = useRef<LiveChordDetector | null>(null);
  const [running, setRunning] = useState(false);
  const [chord, setChord] = useState("—");
  const [chroma, setChroma] = useState<number[]>(Array(12).fill(0));
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => () => detectorRef.current?.stop(), []);

  async function start() {
    try {
      const d = new LiveChordDetector();
      detectorRef.current = d;
      await d.start((label, c) => {
        setChord(label === "N" ? "—" : label);
        setChroma(Array.from(c));
        if (label !== "N")
          setHistory((h) => (h[h.length - 1] === label ? h : [...h, label].slice(-24)));
      });
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

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Live chords</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Play or stream music near your device to detect chords as they happen.
      </p>

      <div className="panel mt-5 flex flex-col items-center gap-4 p-6">
        <div className="flex h-32 items-center justify-center">
          <span className="chord-token text-6xl">{chord}</span>
        </div>
        {chord !== "—" && <ChordDiagram chord={chord} size={96} />}

        <div className="mt-2 grid w-full grid-cols-12 gap-1">
          {chroma.map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex h-20 w-full items-end rounded bg-surface-2">
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

      {history.length > 0 && (
        <div className="panel mt-4 p-4">
          <h2 className="text-sm font-semibold">Detected progression</h2>
          <p className="mt-2 font-mono text-sm text-chord">{history.join("  ·  ")}</p>
        </div>
      )}
    </div>
  );
}
