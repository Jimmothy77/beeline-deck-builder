/**
 * The explicit allow-list of Frame Lab splash files the app ships (copied into public/splash/ by
 * scripts/copy-splash.ts). Nothing else from Frame Lab's folder is ever copied: not the variants that
 * were not picked, not the review page, the player or the tools.
 *
 * It is the 40 files in Frame Lab's freeze list, FINAL.sha256 (kept here byte for byte as
 * scripts/splash-final.sha256), less splash-player.js (SPLASH_NOT_SHIPPED): 39 files, each checked
 * against that list, so `grep -v ' splash-player.js$' scripts/splash-final.sha256 | sha256sum -c`
 * passes inside public/splash/.
 *
 * Paths are relative to Frame Lab's folder and to public/splash/ alike (the pages load
 * ../splash-runtime.js, ../splash-base.css, ../fonts/* and ../assets/*, so the layout is kept).
 */

/** One page per deck (see src/data/splash-assets.ts), plus the BeeLine fallback. */
export const SPLASH_PAGES = [
  "splashes/eggman.html",
  "splashes/floating-world.html",
  "splashes/horror-c.html",
  "splashes/kpdh.html",
  "splashes/nier.html",
  "splashes/persona5.html",
  "splashes/silksong.html",
  "splashes/sxf.html",
  "splashes/tmnt.html",
  "splashes/vader.html",
  "splashes/xmen.html",
  "splashes/beeline.html",
] as const;

/** What the pages load: the shared runtime and CSS, the fonts they use, and the fallback's images. */
export const SPLASH_SHARED = [
  "splash-runtime.js",
  "splash-base.css",
  "assets/bee.svg",
  "assets/meridian-back.webp",
  "assets/meridian-front.webp",
  "fonts/abril.woff2",
  "fonts/anton.woff2",
  "fonts/archivo-black.woff2",
  "fonts/bangers.woff2",
  "fonts/blackops.woff2",
  "fonts/bungee.woff2",
  "fonts/cinzel.woff2",
  "fonts/cormorant-italic.woff2",
  "fonts/cormorant.woff2",
  "fonts/courier-bold.woff2",
  "fonts/courier.woff2",
  "fonts/fraunces.woff2",
  "fonts/marker.woff2",
  "fonts/michroma.woff2",
  "fonts/mincho-jp.woff2",
  "fonts/oswald.woff2",
  "fonts/outfit.woff2",
  "fonts/playfair.woff2",
  "fonts/russo.woff2",
  "fonts/special-elite.woff2",
  "fonts/spray.woff2",
  "fonts/unbounded.woff2",
] as const;

export const SPLASH_ALLOW_LIST: readonly string[] = [...SPLASH_PAGES, ...SPLASH_SHARED].sort();

/**
 * Entries of Frame Lab's freeze list that are deliberately not shipped. splash-player.js is Frame Lab's
 * own player: the app plays the pages itself (src/components/Splash.tsx), and the player would keep a
 * "seen" flag in localStorage under a key outside printabee.*. It was shipped but never loaded up to
 * v0.1.32; from v0.1.33 it isn't copied at all. Its manifest line is skipped, not deleted, so the
 * manifest stays Frame Lab's file byte for byte.
 */
export const SPLASH_NOT_SHIPPED: readonly string[] = ["splash-player.js"];

/**
 * Files in Frame Lab's folder that must never be copied. The allow-list alone already keeps them out;
 * this list is checked too, so adding one of them to the allow-list by mistake fails loudly.
 * - splashes/horror.html, horror-a.html, horror-b.html: Horror options not picked (horror-c was).
 * - fonts/vt323.woff2, fonts/fell-sc.woff2: used only by the options not picked and the review page.
 * - index.html, README.md, review/, tools/: the review page, notes, renders and review tooling.
 * - splash-player.js: Frame Lab's player, never used (see SPLASH_NOT_SHIPPED).
 */
export const SPLASH_EXCLUDED: readonly string[] = [
  "splash-player.js",
  "splashes/horror.html",
  "splashes/horror-a.html",
  "splashes/horror-b.html",
  "fonts/vt323.woff2",
  "fonts/fell-sc.woff2",
  "index.html",
  "README.md",
  "FINAL.md",
  "FINAL.sha256",
];
/**
 * url()s in the frozen splash CSS allowed to point at files not shipped: none. Up to Frame Lab's first
 * v0.1.33 freeze, splash-base.css declared "BL VT323" and "BL Fell" (fonts/vt323.woff2,
 * fonts/fell-sc.woff2), used only by the Horror alternates not picked; Frame Lab re-froze without them
 * (FINAL.sha256 a4be742f…), so every url() must now resolve to a shipped file.
 */
export const SPLASH_CSS_UNSHIPPED_URLS: readonly string[] = [];

/** Whole folders that are never copied. */
export const SPLASH_EXCLUDED_DIRS: readonly string[] = ["review/", "tools/"];

/** Size limits: no single file over 128 KB, and the whole set under 1 MB. */
export const SPLASH_MAX_FILE_BYTES = 128 * 1024;
export const SPLASH_MAX_TOTAL_BYTES = 1024 * 1024;
