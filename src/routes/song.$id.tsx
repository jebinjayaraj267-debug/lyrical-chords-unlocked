import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileImage,
  FileText,
  Languages,
  Minus,
  Pause,
  Play,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordSheetView } from "@/components/ChordSheetView";
import { getAudio, deleteAudio } from "@/lib/audio-store";
import { downloadSheetImage, downloadSheetPdf, downloadText } from "@/lib/export";
import { buildSheet, sheetToText, uniqueChords } from "@/lib/sheet";
import { deleteSong, getSong, saveSong, type Song } from "@/lib/storage";

export const Route = createFileRoute("/song/$id")({
  head: () => ({
    meta: [
      { title: "Chord Sheet — ChordLab" },
      {
        name: "description",
        content:
          "Your detected chord sheet with transposition, capo, autoscroll and PDF or image export.",
      },
      { property: "og:title", content: "Chord Sheet — ChordLab" },
      {
        property: "og:description",
        content: "Chords, lyrics and transliteration in one printable sheet.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SongPage,
});

function SongPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState<Song | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [showRoman, setShowRoman] = useState(true);
  const [useFlats, setUseFlats] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    setSong(getSong(id) ?? null);
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    let url: string | null = null;
    void getAudio(id).then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  useEffect(() => {
    if (!scrollSpeed) return;
    const iv = window.setInterval(() => window.scrollBy(0, scrollSpeed), 60);
    return () => window.clearInterval(iv);
  }, [scrollSpeed]);

  const sheet = useMemo(
    () => (song ? buildSheet(song.analysis, song.lyrics, song.romanized) : null),
    [song],
  );

  const activeChord = useMemo(() => {
    if (!song) return null;
    return song.analysis.chords.find((c) => time >= c.start && time < c.end) ?? null;
  }, [song, time]);

  const chordList = useMemo(
    () => (sheet ? uniqueChords(sheet, song?.transpose ?? 0, useFlats) : []),
    [sheet, song?.transpose, useFlats],
  );

  if (!loaded) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!song || !sheet)
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <p className="text-sm text-muted-foreground">That song is no longer in your library.</p>
        <Button asChild className="mt-4">
          <Link to="/">Back to library</Link>
        </Button>
      </div>
    );

  function update(patch: Partial<Song>) {
    if (!song) return;
    const next = { ...song, ...patch };
    setSong(next);
    saveSong(next);
  }

  const textOptions = {
    title: song.title,
    artist: song.artist,
    key: song.analysis.key,
    bpm: song.analysis.bpm,
    capo: song.capo,
    transpose: song.transpose,
    useFlats,
    showRoman,
  };

  const slug = (song.title || "chord-sheet").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="mx-auto max-w-lg px-4 pt-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="size-4" /> Library
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            deleteSong(song.id);
            void deleteAudio(song.id);
            toast.success("Deleted");
            void navigate({ to: "/" });
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {/* Controls */}
      <div className="panel mt-2 space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stepper
            label="Transpose"
            value={song.transpose}
            display={`${song.transpose > 0 ? "+" : ""}${song.transpose}`}
            onChange={(v) => update({ transpose: Math.max(-11, Math.min(11, v)) })}
          />
          <Stepper
            label="Capo"
            value={song.capo}
            display={song.capo ? `Fret ${song.capo}` : "None"}
            onChange={(v) => update({ capo: Math.max(0, Math.min(11, v)) })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm">
            <Type className="size-4 text-muted-foreground" /> Text size
          </span>
          <Slider
            className="w-36"
            min={10}
            max={22}
            step={1}
            value={[fontSize]}
            onValueChange={([v]) => setFontSize(v ?? 13)}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            <Languages className="size-4 text-muted-foreground" /> Show transliteration
          </span>
          <Switch checked={showRoman} onCheckedChange={setShowRoman} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm">Use flats (♭)</span>
          <Switch checked={useFlats} onCheckedChange={setUseFlats} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">Autoscroll</span>
          <Slider
            className="w-36"
            min={0}
            max={6}
            step={1}
            value={[scrollSpeed]}
            onValueChange={([v]) => setScrollSpeed(v ?? 0)}
          />
        </div>
      </div>

      {/* Player */}
      {audioUrl && (
        <div className="panel mt-4 p-4">
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              onClick={() => {
                const a = audioRef.current;
                if (!a) return;
                if (a.paused) {
                  void a.play();
                  setPlaying(true);
                } else {
                  a.pause();
                  setPlaying(false);
                }
              }}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <div className="flex-1">
              <div className="chord-token text-2xl leading-none">
                {activeChord && activeChord.label !== "N" ? activeChord.label : "—"}
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${(time / (song.analysis.duration || 1)) * 100}%` }}
                />
              </div>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {fmt(time)} / {fmt(song.analysis.duration)}
            </span>
          </div>
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
        </div>
      )}

      {/* Chord shapes */}
      <div className="panel mt-4 p-4">
        <h2 className="text-sm font-semibold">Chords used</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {chordList.map((c) => (
            <ChordDiagram key={c} chord={c} />
          ))}
        </div>
      </div>

      {/* Sheet */}
      <div className="panel mt-4 p-2">
        <ChordSheetView
          ref={sheetRef}
          sheet={sheet}
          title={song.title}
          artist={song.artist}
          keyLabel={song.analysis.key}
          bpm={song.analysis.bpm}
          capo={song.capo}
          transpose={song.transpose}
          useFlats={useFlats}
          showRoman={showRoman}
          fontSize={fontSize}
          activeChordTime={activeChord?.start ?? null}
        />
      </div>

      {/* Export */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          onClick={() => void downloadSheetPdf(sheetToText(sheet, textOptions), slug)}
        >
          <FileText className="size-4" /> PDF
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            if (!sheetRef.current) return;
            try {
              await downloadSheetImage(sheetRef.current, slug);
            } catch {
              toast.error("Image export failed");
            }
          }}
        >
          <FileImage className="size-4" /> Image
        </Button>
        <Button
          variant="secondary"
          onClick={() => downloadText(sheetToText(sheet, textOptions), slug)}
        >
          <Type className="size-4" /> Text
        </Button>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  display,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => onChange(value - 1)}>
          <Minus className="size-4" />
        </Button>
        <span className="font-mono text-sm">{display}</span>
        <Button variant="ghost" size="icon" onClick={() => onChange(value + 1)}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export { ChevronDown, ChevronUp };
