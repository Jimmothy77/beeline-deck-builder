/**
 * Per-deck splash screens: which one a deck gets, and whether it already played this session.
 *
 * A splash plays once per browser session, the first time a deck is opened (Build, a saved deck, or
 * Continue). "Played" is kept in sessionStorage under one key per deck, `printabee.splash.v1.<deck id>`,
 * so it never touches localStorage, the saved decks or any other key, and a new session plays it again.
 * If sessionStorage can't be read or written, the splash does not play (better no splash than one on
 * every open).
 *
 * The registry (src/data/splash-assets.ts) maps a deck id to its asset. A deck with no entry gets the
 * fallback asset (Frame Lab's BeeLine splash); with no usable fallback either, it gets the generic splash
 * drawn by the app itself, which can't fail to load. A registered asset that is missing or fails (a 404,
 * an error, no "ready" message in time) skips cleanly: the splash just closes.
 */
export const SPLASH_KEY_PREFIX = "printabee.splash.v1.";

/** sessionStorage key for one deck. */
export const splashKey = (deckId: string) => `${SPLASH_KEY_PREFIX}${deckId}`;

type Store = Pick<Storage, "getItem" | "setItem">;

/** The splash should play: this deck has not had it this session, and sessionStorage works. */
export function shouldPlaySplash(store: Store | null | undefined, deckId: string): boolean {
  if (!store || !deckId) return false;
  try {
    return store.getItem(splashKey(deckId)) === null;
  } catch {
    return false;
  }
}

/** Remember that the deck's splash played (or was skipped, or failed). Returns false if it couldn't be stored. */
export function rememberSplash(store: Store | null | undefined, deckId: string): boolean {
  if (!store) return false;
  try {
    store.setItem(splashKey(deckId), "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * A Frame Lab splash: a self-contained HTML page under public/splash/ that speaks the beeline-splash
 * postMessage protocol ({type: "beeline-splash:ready" | "beeline-splash:end"}). It is shown in a
 * sandboxed iframe, always with ?noskip=1 (the app draws the one Skip button), and with ?poster=1
 * (a still frame) for reduced motion. `background` is the page's own backdrop colour, used behind
 * the frame while it loads so there is no flash of another colour.
 */
export type FrameSplash = { kind: "frame"; src: string; durationMs: number; label: string; background?: string };
/** A still image under public/splash/, shown for durationMs. */
export type ImageSplash = { kind: "image"; src: string; durationMs: number; label: string };
export type SplashAsset = FrameSplash | ImageSplash;
export type SplashRegistry = Readonly<Record<string, SplashAsset>>;

/** The generic splash, drawn by the app: the BeeLine bee and the deck's name. */
export const GENERIC_SPLASH_MS = 1600;
/** How long a still frame stays with reduced motion. */
export const SPLASH_STATIC_MS = 1200;
/** A frame splash that hasn't said "ready" by then is treated as missing and skipped. */
export const SPLASH_READY_TIMEOUT_MS = 2500;
/** A splash never stays longer than its duration plus this, even if its "end" message never comes. */
export const SPLASH_GRACE_MS = 1500;

export type SplashChoice = { kind: "generic"; durationMs: number } | SplashAsset;

function isSplashAsset(value: unknown): value is SplashAsset {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Partial<SplashAsset>;
  return (asset.kind === "frame" || asset.kind === "image") && typeof asset.src === "string" && asset.src !== "";
}

/** The deck's own splash from the registry, else the fallback asset, else the generic one. */
export function splashFor(deckId: string, registry: SplashRegistry, fallback?: SplashAsset): SplashChoice {
  // Only a well-formed entry counts (an inherited name such as "toString" isn't one).
  const asset: unknown = registry[deckId];
  if (isSplashAsset(asset)) return asset;
  if (isSplashAsset(fallback)) return fallback;
  return { kind: "generic", durationMs: GENERIC_SPLASH_MS };
}

/**
 * The frame URL to load. noskip=1 hides the page's own Skip pill and its tap and key handling (the app
 * draws the only Skip button and handles clicks and Esc itself); poster=1 freezes it on its poster
 * frame for reduced motion.
 */
export function frameUrl(src: string, reducedMotion: boolean): string {
  const params = reducedMotion ? "noskip=1&poster=1" : "noskip=1";
  return `${src}${src.includes("?") ? "&" : "?"}${params}`;
}

/** How long the splash may stay up before it closes on its own. */
export function splashLimitMs(choice: SplashChoice, reducedMotion: boolean): number {
  if (reducedMotion) return SPLASH_STATIC_MS;
  return choice.kind === "generic" ? choice.durationMs : choice.durationMs + (choice.kind === "frame" ? SPLASH_GRACE_MS : 0);
}
