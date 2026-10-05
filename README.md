# Harmony Hub

build me an application exactly like chord AI with all of its functions and along with that i also want the application to give out the lyrics too of the song including in hinglish and tanglish for hindi and tamil songs and the output should look like the chord sheet in ultimate guitar and i should also have option to download the chord sheet anaylsis in pdf or image form

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://lyrical-chords-unlocked.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7f257c9f-e466-4d0b-aaa1-af91e988116d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Server configuration

Chord analysis uses `https://chordmini.me` by default. The public service may require a short-lived `CHORDMINI_APP_CHECK_TOKEN`; set that server secret when needed. Alternatively, set `CHORDMINI_API_URL` to a self-hosted ChordMiniApp backend, for example `http://localhost:5001`, which avoids the public App Check requirement.

Stem separation runs [Demucs](https://github.com/facebookresearch/demucs) on a Node server with access to Python. Install the requested repository with `python3 -m pip install -U git+https://github.com/facebookresearch/demucs.git`, then make sure the server can run `python3 -m demucs.separate`. The app returns a ZIP of vocals, drums, bass and other stems, which it unpacks locally. Set `DEMUCS_PYTHON` or `DEMUCS_MODEL` when using a different Python environment or model. A Cloudflare-only deployment cannot run local Demucs; use a separate Demucs worker and set the API route to forward to it.

Copy `.env.example` to `.env` for local development. For a deployed app, add `ELEVENLABS_API_KEY` as a server-side secret in the hosting provider; never expose it as a `VITE_` variable.
