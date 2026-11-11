/**
 * Copy Frame Lab's approved splash files into public/splash/, and check them.
 *
 *   npx tsx scripts/copy-splash.ts --from <Frame Lab folder>   copy the allow-listed files (idempotent)
 *   npx tsx scripts/copy-splash.ts --check                     public/splash/ matches the manifest
 *   npx tsx scripts/copy-splash.ts --check --from <folder>     and the folder still matches it too
 *
 * The allow-list (scripts/splash-files.ts) is the 40 files in Frame Lab's freeze list less
 * splash-player.js (39 files). Frame Lab's list is kept byte for byte in scripts/splash-final.sha256, for
 * provenance; the checks use scripts/splash-shipped.sha256 (the manifest), which is that list less the
 * player's line (SPLASH_NOT_SHIPPED), so a plain `sha256sum -c` of it passes in public/splash/ and
 * dist/splash/. --check fails if the two ever disagree. Copying refuses to
 * run unless every source file matches the manifest, and it never copies anything else: files in
 * public/splash/ that are not on the allow-list (an old variant, say) are removed. A second run with
 * the same files writes nothing.
 *
 * Both modes also check what is shipped: no network URLs, no Google API key prefix, no Drive ids, no
 * user names, every page's references and fonts resolve to allow-listed files, the shared runtime
 * speaks the protocol the app expects, the size limits hold, and the registry in
 * src/data/splash-assets.ts agrees with the pages (one entry per shipped deck, durations, backgrounds).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "../src/data/splash-assets";
import { driveIdsIn } from "../src/lib/public-ids";
import type { SplashAsset } from "../src/lib/splash";
import { SPLASH_ALLOW_LIST, SPLASH_EXCLUDED, SPLASH_EXCLUDED_DIRS, SPLASH_MAX_FILE_BYTES, SPLASH_MAX_TOTAL_BYTES, SPLASH_NOT_SHIPPED, SPLASH_PAGES } from "./splash-files";

const root = path.resolve(import.meta.dirname, "..");
export const SPLASH_DIR = path.join(root, "public/splash");
/** Frame Lab's FINAL.sha256, byte for byte (40 lines). Provenance only. */
export const SPLASH_FINAL = path.join(root, "scripts/splash-final.sha256");
/** The 39 shipped files' lines: FINAL.sha256 less splash-player.js. What every check reads. */
export const SPLASH_MANIFEST = path.join(root, "scripts/splash-shipped.sha256");

// Built from pieces so this file never holds them as plain text itself.
const KEY_PREFIX = ["AI", "za"].join("");
const USER_NAME = ["ja", "mes"].join("");
const TEXT_FILE = /\.(?:html|css|js|svg)$/;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The manifest's lines: path -> sha256, in the format sha256sum -c reads. */
export function readManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw new Error(`bad manifest line: ${line}`);
    entries.set(match[2]!, match[1]!);
  }
  return entries;
}

/** FINAL.sha256's text less the lines of files that are not shipped, every other byte unchanged. */
export function shippedManifestText(finalText: string): string {
  return finalText
    .split(/(?<=\n)/)
    .filter((line) => !SPLASH_NOT_SHIPPED.some((file) => line.replace(/\n$/, "").endsWith(`  ${file}`)))
    .join("");
}

/** The shipped manifest must be exactly Frame Lab's list less the player's line. */
export function manifestProblems(finalText: string, shippedText: string): string[] {
  return shippedText === shippedManifestText(finalText) ? [] : ["scripts/splash-shipped.sha256: not scripts/splash-final.sha256 less the splash-player.js line"];
}

/** The allow-list itself must be sound: exactly the manifest, and nothing excluded on it. */
export function allowListProblems(manifest: Map<string, string>, allow: readonly string[] = SPLASH_ALLOW_LIST): string[] {
  const problems: string[] = [];
  for (const file of allow) {
    if (SPLASH_EXCLUDED.includes(file) || SPLASH_EXCLUDED_DIRS.some((dir) => file.startsWith(dir))) problems.push(`${file}: excluded, but on the allow-list`);
    if (!manifest.has(file)) problems.push(`${file}: on the allow-list, not in the manifest`);
  }
  for (const file of manifest.keys()) {
    if (SPLASH_NOT_SHIPPED.includes(file)) problems.push(`${file}: not shipped, but in the manifest`);
    else if (!allow.includes(file)) problems.push(`${file}: in the manifest, not on the allow-list`);
  }
  return problems;
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/** Every allow-listed file in `dir` matches the manifest's sha256. */
export function hashProblems(dir: string, manifest: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, hash] of manifest) {
    const full = path.join(dir, file);
    if (!existsSync(full)) problems.push(`${file}: missing`);
    else if (sha256(readFileSync(full)) !== hash) problems.push(`${file}: sha256 differs from the manifest`);
  }
  return problems;
}

const bodyBackground = (html: string) => /body\{background:([^;}]+)/.exec(html)?.[1]?.trim() ?? null;

/** What a page refers to, relative to the splash folder. */
function pageReferences(page: string, html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1]!;
    if (ref.startsWith("#") || ref.startsWith("data:")) continue;
    refs.push(path.posix.normalize(path.posix.join(path.posix.dirname(page), ref)));
  }
  for (const match of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const ref = match[1]!;
    if (ref.startsWith("#") || ref.startsWith("data:")) continue;
    refs.push(path.posix.normalize(path.posix.join(path.posix.dirname(page), ref)));
  }
  return refs;
}

/**
 * Font families declared in splash-base.css -> the font files they load, resolved against the CSS
 * file's own folder (the splash folder's root). A path that climbs out of the folder ("../fonts/…")
 * resolves to something like "../fonts/x.woff2", which is never on the allow-list, so it is reported.
 */
function fontFaces(css: string): Map<string, string[]> {
  const faces = new Map<string, string[]>();
  for (const match of css.matchAll(/@font-face\{font-family:"([^"]+)";[^}]*?src:url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    faces.set(match[1]!, [...(faces.get(match[1]!) ?? []), path.posix.normalize(match[2]!)]);
  }
  return faces;
}

/** The registry entry that plays a page, keyed by its src. */
function registryBySrc(): Map<string, { id: string; asset: SplashAsset }> {
  const bySrc = new Map<string, { id: string; asset: SplashAsset }>();
  for (const [id, asset] of Object.entries(SPLASH_ASSETS)) bySrc.set(asset.src, { id, asset });
  bySrc.set(SPLASH_FALLBACK.src, { id: "(fallback)", asset: SPLASH_FALLBACK });
  return bySrc;
}

/** Checks on the files as shipped in `dir` (public/splash/, or a source folder before copying). */
export function contentProblems(dir: string, allow: readonly string[] = SPLASH_ALLOW_LIST): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const file of allow) {
    const full = path.join(dir, file);
    if (!existsSync(full)) {
      problems.push(`${file}: missing`);
      continue;
    }
    const data = readFileSync(full);
    total += data.length;
    if (data.length > SPLASH_MAX_FILE_BYTES) problems.push(`${file}: ${data.length} bytes, over ${SPLASH_MAX_FILE_BYTES}`);
    if (data.includes(KEY_PREFIX)) problems.push(`${file}: holds a Google API key prefix`);
    if (data.toString("latin1").toLowerCase().includes(USER_NAME)) problems.push(`${file}: holds a user name`);
    if (!TEXT_FILE.test(file)) continue;
    const text = data.toString("utf8");
    for (const url of text.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)<>]*/gi) ?? []) {
      // The SVG namespace is a name, not a request.
      if (/^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)$/.test(url)) continue;
      problems.push(`${file}: network URL ${url}`);
    }
    if (/@import\b/.test(text)) problems.push(`${file}: @import`);
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\s*\(|\bimport\s*\(/.test(text)) problems.push(`${file}: makes network requests from script`);
    const ids = driveIdsIn(text);
    if (ids.length) problems.push(`${file}: ${ids.length} Drive-id-like string(s)`);
  }
  if (total > SPLASH_MAX_TOTAL_BYTES) problems.push(`total ${total} bytes, over ${SPLASH_MAX_TOTAL_BYTES}`);

  // The shared runtime speaks the protocol Splash.tsx expects.
  const runtimePath = path.join(dir, "splash-runtime.js");
  if (existsSync(runtimePath)) {
    const runtime = readFileSync(runtimePath, "utf8");
    for (const needle of ["beeline-splash:ready", "beeline-splash:end", "window.parent.postMessage", "'poster'", "'noskip'"]) {
      if (!runtime.includes(needle)) problems.push(`splash-runtime.js: does not mention ${needle}`);
    }
  }
  const cssPath = path.join(dir, "splash-base.css");
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
  const faces = fontFaces(css);
  for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const ref = path.posix.normalize(match[1]!);
    // Paths are relative to splash-base.css, at the folder's root. Declared fonts no page uses (the
    // excluded variants' vt323 and fell-sc) need not ship; a used font must (checked per page below).
    if (ref.startsWith("../") || ref.startsWith("/")) problems.push(`splash-base.css: refers to ${ref}, outside the splash folder (paths are relative to splash-base.css)`);
  }
  const bySrc = registryBySrc();
  for (const page of SPLASH_PAGES) {
    const full = path.join(dir, page);
    if (!existsSync(full)) continue;
    const html = readFileSync(full, "utf8");
    const slug = path.posix.basename(page, ".html");
    const head = /<html\b[^>]*>/.exec(html)?.[0] ?? "";
    if (!head.includes(`data-slug="${slug}"`)) problems.push(`${page}: data-slug is not "${slug}"`);
    const duration = Number(/data-duration="(\d+)"/.exec(head)?.[1] ?? NaN);
    if (!Number.isFinite(duration)) problems.push(`${page}: no data-duration`);
    for (const needed of ["splash-runtime.js", "splash-base.css"]) if (!pageReferences(page, html).includes(needed)) problems.push(`${page}: does not load ${needed}`);
    for (const ref of pageReferences(page, html)) if (!allow.includes(ref)) problems.push(`${page}: refers to ${ref}, not on the allow-list`);
    for (const family of new Set(html.match(/BL [A-Za-z0-9]+/g) ?? [])) {
      const files = faces.get(family);
      if (!files) problems.push(`${page}: uses font ${family}, not declared in splash-base.css`);
      else for (const font of files) if (!allow.includes(font)) problems.push(`${page}: uses ${family} (${font}), not on the allow-list`);
    }
    const entry = bySrc.get(`splash/${page}`);
    if (!entry) {
      problems.push(`${page}: no registry entry plays it`);
      continue;
    }
    if (entry.asset.durationMs !== duration) problems.push(`${page}: registry durationMs ${entry.asset.durationMs}, page data-duration ${duration}`);
    const background = entry.asset.kind === "frame" ? entry.asset.background : undefined;
    if (background !== bodyBackground(html)) problems.push(`${page}: registry background ${background}, page body background ${bodyBackground(html)}`);
  }
  for (const src of bySrc.keys()) if (!SPLASH_PAGES.some((page) => `splash/${page}` === src)) problems.push(`registry: ${src} is not a shipped page`);
  return problems;
}

/** Files in the destination that must go: anything not on the allow-list. */
export function strayFiles(dir: string, allow: readonly string[] = SPLASH_ALLOW_LIST): string[] {
  return listFiles(dir).filter((file) => !allow.includes(file));
}

export type CopyResult = { written: string[]; unchanged: string[]; removed: string[] };

/** Copy the allow-listed files from `from` into `to`. Refuses (changing nothing) unless every source file matches the manifest. */
export function copySplash(from: string, to: string, manifest: Map<string, string>, allow: readonly string[] = SPLASH_ALLOW_LIST): CopyResult {
  const before = [...allowListProblems(manifest, allow), ...hashProblems(from, manifest)];
  if (before.length) throw new Error(`not copying:\n  ${before.join("\n  ")}`);
  const result: CopyResult = { written: [], unchanged: [], removed: [] };
  for (const file of allow) {
    const data = readFileSync(path.join(from, file));
    const target = path.join(to, file);
    if (existsSync(target) && readFileSync(target).equals(data)) {
      result.unchanged.push(file);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    result.written.push(file);
  }
  for (const file of strayFiles(to, allow)) {
    rmSync(path.join(to, file));
    result.removed.push(file);
  }
  removeEmptyDirs(to);
  return result;
}

function removeEmptyDirs(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    removeEmptyDirs(full);
    if (readdirSync(full).length === 0) rmdirSync(full);
  }
}

/** --check: the destination holds exactly the allow-list, every file matches the manifest, and the content checks pass. */
export function checkSplash(dir: string, manifest: Map<string, string>, from?: string, texts?: { final: string; shipped: string }): string[] {
  return [
    ...(texts ? manifestProblems(texts.final, texts.shipped) : []),
    ...allowListProblems(manifest),
    ...strayFiles(dir).map((file) => `${file}: not on the allow-list`),
    ...hashProblems(dir, manifest),
    ...(from ? hashProblems(from, manifest).map((problem) => `source ${problem}`) : []),
    ...contentProblems(dir),
  ];
}

function main(argv: string[]) {
  const check = argv.includes("--check");
  const fromIndex = argv.indexOf("--from");
  const from = fromIndex >= 0 ? argv[fromIndex + 1] : undefined;
  if (fromIndex >= 0 && (!from || !statSync(from, { throwIfNoEntry: false })?.isDirectory())) throw new Error("--from needs Frame Lab's folder");
  const texts = { final: readFileSync(SPLASH_FINAL, "utf8"), shipped: readFileSync(SPLASH_MANIFEST, "utf8") };
  const manifest = readManifest(texts.shipped);
  if (check) {
    const problems = checkSplash(SPLASH_DIR, manifest, from, texts);
    if (problems.length) {
      console.error(`public/splash/ does not match the manifest:\n  ${problems.join("\n  ")}`);
      process.exitCode = 1;
      return;
    }
    const bytes = SPLASH_ALLOW_LIST.reduce((sum, file) => sum + statSync(path.join(SPLASH_DIR, file)).size, 0);
    console.log(`public/splash/ matches the manifest: ${SPLASH_ALLOW_LIST.length} files, ${bytes} bytes, ${Object.keys(SPLASH_ASSETS).length} decks and the fallback${from ? "; the source folder matches too" : ""}.`);
    return;
  }
  if (!from) throw new Error("usage: copy-splash.ts --from <Frame Lab folder> | --check [--from <folder>]");
  const drift = manifestProblems(texts.final, texts.shipped);
  if (drift.length) throw new Error(`not copying: ${drift.join("; ")}`);
  const source = contentProblems(from);
  if (source.length) throw new Error(`not copying, the source fails its checks:\n  ${source.join("\n  ")}`);
  const result = copySplash(from, SPLASH_DIR, manifest);
  console.log(`public/splash/: ${result.written.length} written, ${result.unchanged.length} unchanged, ${result.removed.length} removed${result.removed.length ? ` (${result.removed.join(", ")})` : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
