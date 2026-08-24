import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.chordlab",
  appName: "ChordLab",
  webDir: "dist/client",
  server: {
    // Loads the deployed app inside the native shell so audio analysis,
    // the local song database and lyric transliteration all work offline-first
    // while still receiving updates when you publish.
    url: "https://lyrical-chords-unlocked.lovable.app",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#1b1e26",
      showSpinner: false,
    },
  },
};

export default config;
