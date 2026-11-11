import type { FrameSplash, SplashRegistry } from "@/lib/splash";

/**
 * Per-deck splash screens, by deck id (the `id` in public/decks/index.json): Frame Lab's pages, copied
 * into public/splash/ by scripts/copy-splash.ts from its explicit allow-list (scripts/splash-files.ts).
 *
 * Each page is splashes/<slug>.html with its shared runtime, CSS and fonts beside it. `durationMs` is the
 * page's data-duration and `background` its body background; `copy-splash.ts --check` fails if either
 * drifts from the copied page. Approved choices: horror-c (the creaky door) for Horror Movie Poster
 * Secret Lair, and Silksong v2 (silksong.html, the round 2 redo).
 *
 * To change a deck's splash, add its page to the allow-list, run the copy script, and edit the line here.
 * A file that is missing or fails to load is skipped: the splash just closes, and the deck opens as usual.
 */
export const SPLASH_ASSETS: SplashRegistry = {
  "dr-eggman": { kind: "frame", src: "splash/splashes/eggman.html", durationMs: 2200, label: "Dr. Eggman", background: "#3a0004" },
  "floating-world": { kind: "frame", src: "splash/splashes/floating-world.html", durationMs: 2300, label: "Floating World", background: "#efe4cb" },
  "horror-movie-poster-secret-lair": { kind: "frame", src: "splash/splashes/horror-c.html", durationMs: 2400, label: "Horror Movie Poster", background: "#020101" },
  kpdh: { kind: "frame", src: "splash/splashes/kpdh.html", durationMs: 2200, label: "KPDH", background: "#0b0315" },
  nier: { kind: "frame", src: "splash/splashes/nier.html", durationMs: 2300, label: "Nier", background: "#2a2822" },
  "persona-5": { kind: "frame", src: "splash/splashes/persona5.html", durationMs: 2200, label: "Persona 5", background: "#0a0a0a" },
  silksong: { kind: "frame", src: "splash/splashes/silksong.html", durationMs: 2400, label: "Silksong", background: "#070d10" },
  sxf: { kind: "frame", src: "splash/splashes/sxf.html", durationMs: 2200, label: "SxF", background: "#14231e" },
  tmnt: { kind: "frame", src: "splash/splashes/tmnt.html", durationMs: 2200, label: "TMNT", background: "#0b120d" },
  vader: { kind: "frame", src: "splash/splashes/vader.html", durationMs: 2300, label: "Vader", background: "#000" },
  "x-men": { kind: "frame", src: "splash/splashes/xmen.html", durationMs: 2100, label: "X-Men", background: "#0a1f6e" },
};

/** Any deck without its own entry (a deck added later, say) gets Frame Lab's BeeLine splash. */
export const SPLASH_FALLBACK: FrameSplash = { kind: "frame", src: "splash/splashes/beeline.html", durationMs: 2500, label: "BeeLine", background: "#d57528" };
