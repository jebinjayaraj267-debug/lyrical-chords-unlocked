import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Flag,
  Gauge,
  Headphones,
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat,
  SlidersHorizontal,
  Timer,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { getAudio, putAudio } from "@/lib/audio-store";
import { fetchStem, pollSeparation, startSeparation, stemUrls } from "@/lib/separate";
import { STEMS, STEM_LABELS, StudioPlayer, type TrackName } from "@/lib/studio";
import type { Song } from "@/lib/storage";

export interface Marker {
  time: number;
  label: string;
}

/** Practice studio: mix stems, change speed and key, loop a section, click track. */
export function StudioPanel({ song }: { song: Song }) {
  const playerRef = useRef<StudioPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(100);
  const [pitch, setPitch] = useState(0);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackName[]>([]);
  const [mix, setMix] = useState<Record<string, { volume: number; muted: boolean }>>({});
  const [separating, setSeparating] = useState(false);
  const [sepStage, setSepStage] = useState("");

  const duration = song.analysis.duration || 1;

  const markers = useMemo<Marker[]>(() => {
    const out: Marker[] = [];
    for (const line of song.syncedLyrics ?? []) {
      const m = /^\s*\[([^\]]+)\]/.exec(line.text);
      if (m) out.push({ time: line.time, label: m[1]! });
    }
    if (out.length === 0) {
      const beats = song.analysis.beats;
      const bar = song.analysis.timeSignature || 4;
      for (let i = 0; i < beats.length; i += bar * 8) {
        out.push({ time: beats[i]!, label: `Bar ${Math.floor(i / bar) + 1}` });
      }
    }
    return out.slice(0, 24);
  }, [song]);

  useEffect(() => {
    let cancelled = false;
    const player = new StudioPlayer();
    playerRef.current = player;
    player.beats = song.analysis.beats;
    player.beatsPerBar = song.analysis.timeSignature || 4;
    player.onTick = (p) => {
      setPosition(p);
      setPlaying(player.playing);
    };

    void (async () => {
      const loaded: TrackName[] = [];
      const full = await getAudio(song.id);
      if (full) {
        await player.load("full", full);
        loaded.push("full");
      }
      for (const stem of STEMS) {
        const blob = await getAudio(`${song.id}::${stem}`);
        if (blob) {
          await player.load(stem, blob);
          loaded.push(stem);
        }
      }
      if (cancelled) return;
      // With stems available the original is muted so the mix is the stems.
      if (loaded.length > 1) player.setMuted("full", true);
      setTracks(loaded);
      setMix(
        Object.fromEntries(
          loaded.map((n) => [n, { volume: 1, muted: n === "full" && loaded.length > 1 }]),
        ),
      );
      setReady(loaded.length > 0);
    })();

    return () => {
      cancelled = true;
      player.destroy();
      playerRef.current = null;
    };
  }, [song.id, song.analysis.beats, song.analysis.timeSignature]);

  function toggle() {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setPlaying(false);
    } else {
      void p.play();
      setPlaying(true);
    }
  }

  function seek(t: number) {
    playerRef.current?.seek(t);
    setPosition(t);
  }

  async function separate() {
    const blob = await getAudio(song.id);
    if (!blob) {
      toast.error("The audio for this song isn't saved on this device");
      return;
    }
    setSeparating(true);
    setSepStage("Uploading");
    try {
      const id = await startSeparation(blob);
      setSepStage("Separating (this can take a few minutes)");
      let output: Record<string, string> | null = null;
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const res = await pollSeparation(id);
        if (res.status === "succeeded") {
          output = res.output;
          break;
        }
        if (res.status === "failed" || res.status === "canceled") {
          throw new Error(res.error ?? "Separation failed");
        }
      }
      if (!output) throw new Error("Separation timed out");

      setSepStage("Downloading tracks");
      const player = playerRef.current;
      const loaded: TrackName[] = ["full"];
      for (const { name, url } of stemUrls(output)) {
        const stemBlob = await fetchStem(url);
        await putAudio(`${song.id}::${name}`, stemBlob);
        await player?.load(name, stemBlob);
        loaded.push(name);
      }
      player?.setMuted("full", true);
      setTracks(loaded);
      setMix(Object.fromEntries(loaded.map((n) => [n, { volume: 1, muted: n === "full" }])));
      toast.success("Tracks separated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Separation failed");
    } finally {
      setSeparating(false);
      setSepStage("");
    }
  }

  const hasStems = tracks.some((t) => t !== "full");

  return (
    <div className="panel mt-4 space-y-5 p-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Practice studio</h2>
      </div>

      {!ready && (
        <p className="text-xs text-muted-foreground">
          The audio for this song isn't available on this device.
        </p>
      )}

      {ready && (
        <>
          {/* Transport */}
          <div className="flex items-center gap-3">
            <Button size="icon" onClick={toggle}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Slider
              className="flex-1"
              min={0}
              max={Math.round(duration)}
              step={1}
              value={[Math.min(position, duration)]}
              onValueChange={([v]) => seek(v ?? 0)}
            />
            <span className="font-mono text-xs text-muted-foreground">
              {fmt(position)} / {fmt(duration)}
            </span>
          </div>

          {/* Speed & pitch */}
          <div className="space-y-3">
            <Row
              icon={<Gauge className="size-4 text-muted-foreground" />}
              label="Speed"
              value={`${speed}%`}
            >
              <Slider
                className="w-40"
                min={40}
                max={150}
                step={5}
                value={[speed]}
                onValueChange={([v]) => {
                  const next = v ?? 100;
                  setSpeed(next);
                  playerRef.current?.setTempo(next / 100);
                }}
              />
            </Row>
            <Row
              icon={<Music2 className="size-4 text-muted-foreground" />}
              label="Pitch"
              value={`${pitch > 0 ? "+" : ""}${pitch}`}
            >
              <Slider
                className="w-40"
                min={-6}
                max={6}
                step={1}
                value={[pitch]}
                onValueChange={([v]) => {
                  const next = v ?? 0;
                  setPitch(next);
                  playerRef.current?.setPitch(next);
                }}
              />
            </Row>
          </div>

          {/* Metronome */}
          <div className="space-y-3">
            <Row icon={<Timer className="size-4 text-muted-foreground" />} label="Metronome">
              <Switch
                checked={metronome}
                onCheckedChange={(v) => {
                  setMetronome(v);
                  if (playerRef.current) playerRef.current.metronome = v;
                }}
              />
            </Row>
            <Row icon={<Timer className="size-4 text-muted-foreground" />} label="One bar count-in">
              <Switch
                checked={countIn}
                onCheckedChange={(v) => {
                  setCountIn(v);
                  if (playerRef.current) playerRef.current.countIn = v;
                }}
              />
            </Row>
          </div>

          {/* Loop */}
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Repeat className="size-4 text-muted-foreground" /> Loop section
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={loopA !== null ? "default" : "secondary"}
                  onClick={() => {
                    if (loopA === null) {
                      setLoopA(position);
                      toast.success(`Loop start at ${fmt(position)}`);
                    } else if (position > loopA + 1) {
                      const region = { start: loopA, end: position };
                      setLoop(region);
                      setLoopA(null);
                      if (playerRef.current) playerRef.current.loop = region;
                      toast.success(`Looping ${fmt(region.start)} – ${fmt(region.end)}`);
                    } else {
                      toast.error("Play a little further before setting the end");
                    }
                  }}
                >
                  {loopA === null ? "Set A" : "Set B"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setLoop(null);
                    setLoopA(null);
                    if (playerRef.current) playerRef.current.loop = null;
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
            {loop && (
              <p className="mt-1 text-xs text-primary">
                Looping {fmt(loop.start)} – {fmt(loop.end)}
              </p>
            )}
          </div>

          {/* Markers */}
          {markers.length > 0 && (
            <div>
              <span className="flex items-center gap-2 text-sm">
                <Flag className="size-4 text-muted-foreground" /> Sections
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {markers.map((m, i) => (
                  <button
                    key={`${m.time}-${i}`}
                    type="button"
                    onClick={() => seek(m.time)}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs transition-colors hover:border-primary/60"
                  >
                    {m.label} · {fmt(m.time)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mixer */}
          <div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Headphones className="size-4 text-muted-foreground" /> Tracks
              </span>
              {!hasStems && (
                <Button size="sm" variant="secondary" disabled={separating} onClick={() => void separate()}>
                  {separating ? <Loader2 className="size-4 animate-spin" /> : null}
                  {separating ? "Separating…" : "Separate vocals & instruments"}
                </Button>
              )}
            </div>
            {separating && <p className="mt-1 text-xs text-muted-foreground">{sepStage}</p>}
            <div className="mt-3 space-y-2">
              {tracks.map((name) => {
                const state = mix[name] ?? { volume: 1, muted: false };
                return (
                  <div key={name} className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-muted-foreground"
                      aria-label={`${state.muted ? "Unmute" : "Mute"} ${STEM_LABELS[name]}`}
                      onClick={() => {
                        const muted = !state.muted;
                        playerRef.current?.setMuted(name, muted);
                        setMix((m) => ({ ...m, [name]: { ...state, muted } }));
                      }}
                    >
                      {state.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                    </button>
                    <span className="w-16 text-xs">{STEM_LABELS[name]}</span>
                    <Slider
                      className="flex-1"
                      min={0}
                      max={100}
                      step={5}
                      value={[Math.round(state.volume * 100)]}
                      onValueChange={([v]) => {
                        const volume = (v ?? 100) / 100;
                        playerRef.current?.setVolume(name, volume);
                        setMix((m) => ({ ...m, [name]: { ...state, volume } }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-sm">
        {icon} {label}
        {value && <span className="font-mono text-xs text-muted-foreground">{value}</span>}
      </span>
      {children}
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export { Label };
