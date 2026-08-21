import type { AnalysisResult } from "./audio-analysis";

export interface LyricLine {
  text: string;
  roman?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  createdAt: number;
  analysis: AnalysisResult;
  /** raw lyrics pasted by the user */
  lyrics: string;
  /** romanized (Hinglish / Tanglish / etc.) lyrics */
  romanized: string;
  romanizationStyle: string;
  capo: number;
  transpose: number;
  notes: string;
}

const KEY = "chordlab.songs.v1";

function read(): Song[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Song[]) : [];
  } catch {
    return [];
  }
}

function write(songs: Song[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(songs));
  window.dispatchEvent(new CustomEvent("chordlab:songs"));
}

export function listSongs(): Song[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function getSong(id: string): Song | undefined {
  return read().find((s) => s.id === id);
}

export function saveSong(song: Song) {
  const songs = read();
  const i = songs.findIndex((s) => s.id === song.id);
  if (i >= 0) songs[i] = song;
  else songs.push(song);
  write(songs);
}

export function deleteSong(id: string) {
  write(read().filter((s) => s.id !== id));
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
