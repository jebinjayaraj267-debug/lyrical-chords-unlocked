/**
 * Practice player: independent speed and pitch control, per-stem mixing,
 * a beat-locked metronome with count-in, and A/B section looping.
 * Everything runs in the browser on top of Web Audio + SoundTouch.
 */

export const STEMS = ["vocals", "drums", "bass", "other"] as const;
export type StemName = (typeof STEMS)[number];
export type TrackName = "full" | StemName;

export const STEM_LABELS: Record<TrackName, string> = {
  full: "Original",
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

interface Track {
  buffer: AudioBuffer;
  gain: GainNode;
  shifter: { tempo: number; pitchSemitones: number; percentagePlayed: number;
    connect: (n: AudioNode) => void; disconnect: () => void } | null;
  volume: number;
  muted: boolean;
}

type Tick = (position: number) => void;

export class StudioPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private tracks = new Map<TrackName, Track>();
  private PitchShifter: unknown = null;
  private raf = 0;
  private schedTimer = 0;
  private startCtxTime = 0;
  private startPos = 0;
  private beatIdx = 0;

  duration = 0;
  position = 0;
  playing = false;
  tempo = 1;
  semitones = 0;
  loop: { start: number; end: number } | null = null;
  metronome = false;
  countIn = false;
  beats: number[] = [];
  beatsPerBar = 4;
  onTick: Tick | null = null;

  constructor() {
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  get stems(): TrackName[] {
    return [...this.tracks.keys()];
  }

  async load(name: TrackName, blob: Blob) {
    const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    const existing = this.tracks.get(name);
    existing?.shifter?.disconnect();
    this.tracks.set(name, {
      buffer,
      gain,
      shifter: null,
      volume: existing?.volume ?? 1,
      muted: existing?.muted ?? false,
    });
    this.duration = Math.max(this.duration, buffer.duration);
    this.applyMix();
  }

  /** Only these tracks are audible; the rest are silenced. */
  setActive(names: TrackName[]) {
    for (const [name, t] of this.tracks) t.muted = !names.includes(name);
    this.applyMix();
  }

  setVolume(name: TrackName, volume: number) {
    const t = this.tracks.get(name);
    if (!t) return;
    t.volume = volume;
    this.applyMix();
  }

  setMuted(name: TrackName, muted: boolean) {
    const t = this.tracks.get(name);
    if (!t) return;
    t.muted = muted;
    this.applyMix();
  }

  isMuted(name: TrackName) {
    return this.tracks.get(name)?.muted ?? false;
  }

  volumeOf(name: TrackName) {
    return this.tracks.get(name)?.volume ?? 1;
  }

  private applyMix() {
    for (const t of this.tracks.values()) {
      t.gain.gain.value = t.muted ? 0 : t.volume;
    }
  }

  setTempo(tempo: number) {
    this.tempo = tempo;
    if (this.playing) {
      this.rebase();
      for (const t of this.tracks.values()) if (t.shifter) t.shifter.tempo = tempo;
    }
  }

  setPitch(semitones: number) {
    this.semitones = semitones;
    if (this.playing) {
      for (const t of this.tracks.values()) if (t.shifter) t.shifter.pitchSemitones = semitones;
    }
  }

  private rebase() {
    this.position = this.currentPosition();
    this.startPos = this.position;
    this.startCtxTime = this.ctx.currentTime;
    this.beatIdx = this.beats.findIndex((b) => b > this.position);
    if (this.beatIdx < 0) this.beatIdx = this.beats.length;
  }

  private currentPosition() {
    if (!this.playing) return this.position;
    const elapsed = (this.ctx.currentTime - this.startCtxTime) * this.tempo;
    return Math.max(this.startPos, Math.min(this.duration, this.startPos + elapsed));
  }

  async play() {
    if (this.playing || this.tracks.size === 0) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.PitchShifter) {
      this.PitchShifter = (await import("soundtouchjs")).PitchShifter;
    }
    const Shifter = this.PitchShifter as new (
      ctx: BaseAudioContext,
      buffer: AudioBuffer,
      size: number,
    ) => Track["shifter"];

    const beatLen = this.beats.length > 1 ? (this.beats[1]! - this.beats[0]!) || 0.5 : 0.5;
    const lead = this.countIn && this.metronome ? (this.beatsPerBar * beatLen) / this.tempo : 0;

    this.playing = true;
    this.startPos = this.position;
    this.startCtxTime = this.ctx.currentTime + lead;
    this.beatIdx = Math.max(
      0,
      this.beats.findIndex((b) => b > this.position),
    );

    if (lead > 0) {
      for (let i = 0; i < this.beatsPerBar; i++) {
        this.click(this.ctx.currentTime + (i * beatLen) / this.tempo, i === 0);
      }
    }

    const start = () => {
      if (!this.playing) return;
      for (const t of this.tracks.values()) {
        const shifter = new Shifter(this.ctx, t.buffer, 4096);
        if (!shifter) continue;
        shifter.tempo = this.tempo;
        shifter.pitchSemitones = this.semitones;
        shifter.percentagePlayed = this.duration ? this.position / this.duration : 0;
        shifter.connect(t.gain);
        t.shifter = shifter;
      }
    };
    if (lead > 0) window.setTimeout(start, lead * 1000);
    else start();

    this.schedTimer = window.setInterval(() => this.schedule(), 25);
    const tick = () => {
      if (!this.playing) return;
      this.position = this.currentPosition();
      if (this.loop && this.position >= this.loop.end) {
        this.seek(this.loop.start);
      } else if (this.position >= this.duration - 0.05) {
        this.pause();
        this.position = this.duration;
      }
      this.onTick?.(this.position);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.position = this.currentPosition();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.schedTimer);
    for (const t of this.tracks.values()) {
      t.shifter?.disconnect();
      t.shifter = null;
    }
    this.onTick?.(this.position);
  }

  seek(time: number) {
    const target = Math.max(0, Math.min(this.duration, time));
    if (!this.playing) {
      this.position = target;
      this.onTick?.(target);
      return;
    }
    this.position = target;
    this.startPos = target;
    this.startCtxTime = this.ctx.currentTime;
    this.beatIdx = Math.max(
      0,
      this.beats.findIndex((b) => b > target),
    );
    for (const t of this.tracks.values()) {
      if (!t.shifter) continue;
      t.shifter.percentagePlayed = this.duration ? target / this.duration : 0;
    }
    this.onTick?.(target);
  }

  /** Schedules metronome clicks a short way ahead of the audio clock. */
  private schedule() {
    if (!this.metronome || !this.playing) return;
    const horizon = this.currentPosition() + 0.3 * this.tempo;
    while (this.beatIdx < this.beats.length && this.beats[this.beatIdx]! <= horizon) {
      const beat = this.beats[this.beatIdx]!;
      const when = this.startCtxTime + (beat - this.startPos) / this.tempo;
      if (when > this.ctx.currentTime) this.click(when, this.beatIdx % this.beatsPerBar === 0);
      this.beatIdx++;
    }
  }

  private click(when: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.28, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + 0.07);
  }

  destroy() {
    this.pause();
    void this.ctx.close();
  }
}
