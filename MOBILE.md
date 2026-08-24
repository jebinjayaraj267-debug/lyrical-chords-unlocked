# Building ChordLab as a native mobile app

ChordLab is packaged with [Capacitor](https://capacitorjs.com), so the same
code ships as a real Android (`.apk` / `.aab`) and iOS app. Everything the app
stores — songs, chord sheets, settings and the recorded/imported audio — lives
in on-device storage, so the app works without an account and without a server.

## One-time setup on your computer

Requirements: Node 20+, Android Studio (for Android), Xcode 15+ on a Mac (for iOS).

```bash
git clone <your repo>   # export the project to GitHub from Lovable first
cd <project>
npm install

# add the native projects
npx cap add android
npx cap add ios
```

## Build and run

```bash
npm run build          # builds the web assets
npx cap sync           # copies them + plugins into the native projects
npx cap open android   # opens Android Studio  -> Run / Build APK
npx cap open ios       # opens Xcode           -> Run / Archive
```

## Permissions

The microphone is used by live chord detection, the tuner and "record what's
playing". Capacitor adds the Android permission automatically; on iOS add this
to `ios/App/App/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>ChordLab listens to music and your instrument to detect chords and tune.</string>
```

## Updating the app

`capacitor.config.ts` points the native shell at the published Lovable URL, so
publishing from Lovable updates the installed app without a new store build.
To ship a fully bundled offline build instead, delete the `server` block in
`capacitor.config.ts` and re-run `npm run build && npx cap sync`.

## About YouTube and Spotify

Neither platform permits downloading their audio, so a pasted link imports the
track's title, artist and artwork only. Analyze the song from an audio file you
own, or use "Record what's playing" to capture it through the microphone while
it plays.
