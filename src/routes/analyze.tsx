import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Cpu,
  Link2,
  Loader2,
  Mic,
  Music4,
  Square,
  TextSearch,
  Upload,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { analyzeAudioBuffer, type AnalysisResult } from "@/lib/audio-analysis";
import { putAudio } from "@/lib/audio-store";
import { analyzeWithChordMini, type ChordMiniModels } from "@/lib/chordmini";
import { importLink } from "@/lib/link-import.functions";
import { fetchSyncedLyrics, type SyncedLine } from "@/lib/lyrics-fetch.functions";
import { romanizeLyrics } from "@/lib/lyrics.functions";
import { newId, saveSong } from "@/lib/storage";

export const Route = createFileRoute("/analyze")({
  head: () => ({
    meta: [
      { title: "Analyze a Song — ChordLab" },
      {
        name: "description",
        content:
          "Import a YouTube or Spotify link, pick an audio file or record what's playing, and get chords, key, tempo and a chord sheet with Hinglish and Tanglish lyrics.",
      },
      { property: "og:title", content: "Analyze a Song — ChordLab" },
      {
        property: "og:description",
        content: "Chords, key and tempo from any track, right on your phone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyzePage,
});

type Style = "auto" | "hinglish" | "tanglish" | "english";

function AnalyzePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [synced, setSynced] = useState<SyncedLine[]>([]);
  const [style, setStyle] = useState<Style>("auto");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [link, setLink] = useState("");
  const [artwork, setArtwork] = useState("");
  const [importing, setImporting] = useState(false);
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [beatModel, setBeatModel] = useState<ChordMiniModels["beatModel"]>("auto");
  const [chordModel] = useState<ChordMiniModels["chordModel"]>("chord-cnn-lstm");
  const [useChordMini, setUseChordMini] = useState(true);

  useEffect(() => {
    if (!recording) return;
    const iv = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => window.clearInterval(iv);
  }, [recording]);

  function onPick(f: File | null) {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  async function runImport() {
    if (!link.trim()) return;
    setImporting(true);
    try {
      const meta = await importLink({ data: { url: link.trim() } });
      setTitle(meta.title);
      if (meta.artist) setArtist(meta.artist);
      setArtwork(meta.thumbnail);
      toast.success(`Imported details from ${meta.source === "youtube" ? "YouTube" : "Spotify"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that link");
    } finally {
      setImporting(false);
    }
  }

  async function grabLyrics(silent = false): Promise<SyncedLine[]> {
    if (!title.trim()) {
      if (!silent) toast.error("Add a title first");
      return [];
    }
    setFetchingLyrics(true);
    try {
      const res = await fetchSyncedLyrics({
        data: { title: title.trim(), ...(artist.trim() ? { artist: artist.trim() } : {}) },
      });
      if (!res.found) {
        if (!silent) toast.error("No lyrics found for that title");
        return [];
      }
      setLyrics(res.plain);
      setSynced(res.synced);
      if (!silent) {
        toast.success(
          res.synced.length ? "Found time-synced lyrics" : "Found lyrics (no timings available)",
        );
      }
      return res.synced;
    } catch {
      if (!silent) toast.error("Lyrics lookup failed");
      return [];
    } finally {
      setFetchingLyrics(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const f = new File([blob], "recording.webm", { type: blob.type });
        setFile(f);
        setRecording(false);
        if (!title) setTitle("Recording");
        toast.success("Recording captured — tap Detect chords");
      };
      setRecSecs(0);
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access was blocked");
    }
  }

  async function run() {
    if (!file) {
      toast.error("Choose an audio file first");
      return;
    }
    setBusy(true);
    setProgress(2);
    setStage("Decoding audio");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 22050);
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));

      let analysis: AnalysisResult | null = null;
      let engine: "chordmini" | "local" = "local";
      let models: ChordMiniModels | undefined;

      if (useChordMini) {
        setStage("Analysing with ChordMini");
        setProgress(15);
        const outcome = await analyzeWithChordMini(file, decoded.duration, {
          beatModel,
          chordModel,
        });
        if (outcome.ok) {
          analysis = outcome.analysis;
          engine = "chordmini";
          models = outcome.models;
          setProgress(85);
        } else {
          toast.warning(`${outcome.reason} — analysing on device instead`);
        }
      }

      if (!analysis) {
        // Downsample to 22.05 kHz mono for a faster, cleaner chromagram.
        const off = new OfflineAudioContext(
          1,
          Math.ceil((decoded.duration * 22050) as number),
          22050,
        );
        const src = off.createBufferSource();
        src.buffer = decoded;
        src.connect(off.destination);
        src.start();
        const mono = await off.startRendering();

        analysis = await analyzeAudioBuffer(mono, {
          onProgress: (p, s) => {
            setProgress(Math.min(85, p * 0.85));
            setStage(s);
          },
        });
      }

      let lyricText = lyrics;
      let syncedLines = synced;
      if (!lyricText.trim() && title.trim()) {
        setStage("Looking up lyrics");
        setProgress(88);
        const found = await grabLyrics(true);
        if (found.length) syncedLines = found;
        lyricText = found.length ? found.map((l) => l.text).join("\n") : lyricText;
      }

      let romanized = "";
      if (lyricText.trim() && style !== "english") {
        setStage("Transliterating lyrics");
        setProgress(93);
        try {
          const res = await romanizeLyrics({ data: { lyrics: lyricText, style } });
          romanized = res.text;
        } catch (e) {
          toast.warning(e instanceof Error ? e.message : "Transliteration skipped");
        }
      }

      const id = newId();
      setStage("Saving");
      setProgress(97);
      await putAudio(id, file);
      saveSong({
        id,
        title: title.trim() || "Untitled",
        artist: artist.trim(),
        createdAt: Date.now(),
        analysis,
        lyrics: lyricText,
        romanized,
        romanizationStyle: style,
        capo: 0,
        transpose: 0,
        notes: "",
        engine,
        ...(models ? { models } : {}),
        ...(syncedLines.length ? { syncedLyrics: syncedLines } : {}),
      });
      setProgress(100);
      toast.success(
        engine === "chordmini" ? "Analysed with ChordMini" : "Analysis complete (on device)",
      );
      void navigate({ to: "/song/$id", params: { id } });
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not analyze that file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Analyze a song</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        ChordMini handles beat and chord detection, with on-device analysis as backup.
      </p>

      <div className="panel mt-5 p-4">
        <Label htmlFor="link">YouTube or Spotify link</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Imports the title, artist and artwork. Streaming apps don't allow their audio to be
          downloaded, so record the track as it plays or pick the file below.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            id="link"
            value={link}
            placeholder="https://youtu.be/… or open.spotify.com/track/…"
            onChange={(e) => setLink(e.target.value)}
          />
          <Button variant="secondary" onClick={() => void runImport()} disabled={importing}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          </Button>
        </div>
        {artwork && (
          <img
            src={artwork}
            alt={`Artwork for ${title || "the imported track"}`}
            loading="lazy"
            className="mt-3 h-24 w-full rounded-lg object-cover"
          />
        )}
        <Button
          variant={recording ? "destructive" : "secondary"}
          className="mt-3 w-full"
          onClick={() => void toggleRecord()}
        >
          {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          {recording ? `Stop recording (${recSecs}s)` : "Record what's playing"}
        </Button>
      </div>

      <div className="panel mt-4 p-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-8 text-center transition-colors hover:border-primary/60"
        >
          {file ? (
            <>
              <Music4 className="size-7 text-primary" />
              <span className="text-sm font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">Tap to choose another file</span>
            </>
          ) : (
            <>
              <Upload className="size-7 text-primary" />
              <span className="text-sm font-medium">Choose an audio file</span>
              <span className="text-xs text-muted-foreground">MP3, WAV, M4A, FLAC, OGG</span>
            </>
          )}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="artist">Artist</Label>
            <Input id="artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" />
          <Label>Analysis engine</Label>
        </div>
        <Select
          value={useChordMini ? beatModel : "local"}
          onValueChange={(v) => {
            if (v === "local") {
              setUseChordMini(false);
            } else {
              setUseChordMini(true);
              setBeatModel(v as ChordMiniModels["beatModel"]);
            }
          }}
        >
          <SelectTrigger className="mt-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">ChordMini · auto beat model</SelectItem>
            <SelectItem value="madmom">ChordMini · madmom (fast, 3/4 &amp; 4/4)</SelectItem>
            <SelectItem value="beat-transformer">
              ChordMini · beat-transformer (slow, complex mixes)
            </SelectItem>
            <SelectItem value="local">On-device only (offline)</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs text-muted-foreground">
          {useChordMini
            ? "Chords via chord-cnn-lstm. ChordMini allows 2 analyses per minute — if it's busy, the on-device engine takes over automatically."
            : "Everything runs on your device — your audio never leaves the phone."}
        </p>
      </div>

      <div className="panel mt-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lyrics">Lyrics (optional)</Label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void grabLyrics()}
            disabled={fetchingLyrics}
          >
            {fetchingLyrics ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <TextSearch className="size-4" />
            )}
            Fetch lyrics
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Fetch time-synced lyrics by title and artist, or paste your own. Add markers like [Verse]
          or [Chorus] to shape the sheet.
        </p>
        <Textarea
          id="lyrics"
          value={lyrics}
          onChange={(e) => {
            setLyrics(e.target.value);
            setSynced([]);
          }}
          rows={7}
          placeholder={"[Verse]\nyour lyric line here\nanother line\n\n[Chorus]\n..."}
          className="mt-2 font-mono text-xs"
        />
        {synced.length > 0 && (
          <p className="mt-2 text-xs text-primary">
            {synced.length} timed lines — chords will align to the exact words.
          </p>
        )}
        <div className="mt-3 space-y-1.5">
          <Label>Transliteration</Label>
          <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto detect (Hinglish / Tanglish / other)</SelectItem>
              <SelectItem value="hinglish">Hinglish (Hindi in Roman script)</SelectItem>
              <SelectItem value="tanglish">Tanglish (Tamil in Roman script)</SelectItem>
              <SelectItem value="english">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {busy && (
        <div className="panel mt-4 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-primary" />
            {stage}
          </div>
          <Progress value={progress} className="mt-3" />
        </div>
      )}

      <Button size="lg" className="mt-5 w-full" onClick={run} disabled={busy || !file}>
        <Wand2 className="size-4" />
        {busy ? "Analyzing…" : "Detect chords"}
      </Button>
    </div>
  );
}
