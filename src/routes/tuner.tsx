import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { detectPitch } from "@/lib/audio-analysis";
import { pcToNote } from "@/lib/chords";

export const Route = createFileRoute("/tuner")({
  head: () => ({
    meta: [
      { title: "Guitar Tuner — ChordLab" },
      {
        name: "description",
        content: "A precise chromatic tuner for guitar, ukulele and voice built into ChordLab.",
      },
      { property: "og:title", content: "Guitar Tuner — ChordLab" },
      { property: "og:description", content: "Chromatic instrument tuner with cent accuracy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TunerPage,
});

const STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];

function TunerPage() {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("—");
  const [cents, setCents] = useState(0);
  const [freq, setFreq] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close();
    ctxRef.current = null;
    streamRef.current = null;
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const f = detectPitch(buf, ctx.sampleRate);
        if (f && f > 55 && f < 1400) {
          const midi = 69 + 12 * Math.log2(f / 440);
          const rounded = Math.round(midi);
          setNote(pcToNote(((rounded % 12) + 12) % 12) + (Math.floor(rounded / 12) - 1));
          setCents(Math.round((midi - rounded) * 100));
          setFreq(Math.round(f * 10) / 10);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
      setRunning(true);
    } catch {
      toast.error("Microphone access was blocked");
    }
  }

  function stop() {
    cleanup();
    setRunning(false);
    setNote("—");
    setCents(0);
    setFreq(0);
  }

  const inTune = Math.abs(cents) <= 5 && note !== "—";

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tuner</h1>
      <p className="mt-1 text-sm text-muted-foreground">Chromatic, accurate to a few cents.</p>

      <div className="panel mt-5 flex flex-col items-center gap-5 p-6">
        <span
          className={
            inTune
              ? "text-7xl font-bold text-accent transition-colors"
              : "text-7xl font-bold text-foreground transition-colors"
          }
        >
          {note}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {freq ? `${freq} Hz` : "listening…"}
        </span>

        <div className="relative h-3 w-full rounded-full bg-surface-2">
          <div className="absolute left-1/2 top-[-6px] h-6 w-px bg-border" />
          <div
            className={
              inTune
                ? "absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-all"
                : "absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-all"
            }
            style={{ left: `${Math.min(100, Math.max(0, 50 + cents))}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {note === "—" ? "Play a note" : `${cents > 0 ? "+" : ""}${cents} cents`}
        </span>

        <Button
          size="lg"
          className="w-full"
          variant={running ? "destructive" : "default"}
          onClick={running ? stop : start}
        >
          {running ? <Square className="size-4" /> : <Mic className="size-4" />}
          {running ? "Stop" : "Start tuner"}
        </Button>
      </div>

      <div className="panel mt-4 p-4">
        <h2 className="text-sm font-semibold">Standard tuning</h2>
        <div className="mt-3 flex justify-between">
          {STANDARD.map((s) => (
            <span
              key={s}
              className={
                note === s
                  ? "rounded-lg bg-primary px-3 py-1.5 font-mono text-sm text-primary-foreground"
                  : "rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm text-muted-foreground"
              }
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
