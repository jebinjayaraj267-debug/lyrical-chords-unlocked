# Use ChordMini for chord + beat analysis

Replace the on-device chord engine as the *primary* analyser with the ChordMini API, keep the current in-browser engine as an automatic fallback, and add auto-fetched time-synced lyrics.

## Important: where ChordMini runs

ChordMini's public docs only give `http://localhost:5001` — there is no published remote URL, and a browser/edge app cannot reach your laptop's localhost. So the base URL has to be configurable:

- Stored as a backend secret `CHORDMINI_API_URL` (I'll prompt you for it).
- If you run the Flask backend locally and open the app in the same browser on that machine, we can also point at `http://localhost:5001` directly from the device.
- If the secret is unset or the call fails, the app silently uses today's on-device analysis, so nothing breaks.

## What changes for you

1. **Analyze page** — after picking/recording audio, the app sends it to ChordMini for beat tracking and chord recognition. A small badge shows which engine produced the result ("ChordMini · chord-cnn-lstm" vs "On-device").
2. **Model choice** — a compact selector: beats (`auto` / `madmom` / `beat-transformer`) and chords (`chord-cnn-lstm`). Defaults to `auto` + `chord-cnn-lstm`.
3. **Rate limit handling** — ChordMini allows 2 analyses/minute. If it returns 429 or times out, the app shows "ChordMini busy — analysed on device" and continues with the local engine instead of failing.
4. **Auto lyrics** — with a title/artist filled in (including from a YouTube/Spotify link import), the app fetches time-synced lyrics from LRCLIB. Lyrics stay fully editable, and the timestamps drive chord-over-lyric placement, which should fix most of the alignment drift. Hinglish/Tanglish transliteration runs exactly as it does now.
5. **Chord sheet** — with real beats + downbeats + synced lyric timestamps, chords land on the correct word instead of being estimated from syllable counts.

## Technical detail

- **New server route** `src/routes/api/chordmini.ts` (POST, multipart). Audio can't cross the server-function RPC boundary cleanly, so this route accepts the `File`, forwards it as `FormData` to `${CHORDMINI_API_URL}/api/detect-beats` and `/api/recognize-chords` (run in parallel), and returns a normalised JSON DTO. Validates content type and caps upload size (~20 MB). Returns a typed `{ ok: false, reason }` on upstream failure rather than throwing.
- **New server fn** `src/lib/lyrics-fetch.functions.ts` → `fetchSyncedLyrics({ title, artist, duration })`, calling LRCLIB `GET /api/search` and parsing the LRC into `{ time, text }[]`.
- **New adapter** `src/lib/chordmini.ts` — maps ChordMini's chord labels (301-label vocabulary, e.g. `C:maj`, `A:min7`, `N`) into the app's existing `ChordSpan` / `AnalysisResult` shape, so the sheet, transposition, simplify toggle, instrument diagrams and PDF/image export all keep working untouched. Derives key from the chord histogram and BPM/time signature from the beats response.
- **`src/routes/analyze.tsx`** — orchestration: try ChordMini → on failure `analyzeAudioBuffer()` as today. Records `engine: "chordmini" | "local"` on the saved song.
- **`src/lib/sheet.ts`** — new path: when a song has synced lyric timestamps, place chords by matching chord onset times against line start/end times and interpolating within the line, replacing the length-weighted estimate. The estimate stays as the fallback for pasted, untimed lyrics.
- **`src/lib/storage.ts`** — `Song` gains optional `engine`, `syncedLyrics`, and `models` fields; existing saved songs keep loading.
- Base URL read via `process.env['CHORDMINI_API_URL']` **inside** the handler, never at module scope.

## Out of scope

- No self-hosting/deployment of the ChordMini Python backend from here.
- No change to the tuner, live detection, chord library, or export formats.
