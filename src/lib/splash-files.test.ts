import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowListProblems, checkSplash, contentProblems, copySplash, manifestProblems, readManifest, shippedManifestText, SPLASH_DIR, SPLASH_FINAL, SPLASH_MANIFEST } from "../../scripts/copy-splash";
import { SPLASH_ALLOW_LIST, SPLASH_CSS_UNSHIPPED_URLS, SPLASH_EXCLUDED, SPLASH_EXCLUDED_DIRS, SPLASH_NOT_SHIPPED, SPLASH_PAGES } from "../../scripts/splash-files";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "../data/splash-assets";

const root = path.resolve(import.meta.dirname, "../..");
const manifest = readManifest(readFileSync(SPLASH_MANIFEST, "utf8"));
const deckIds = (JSON.parse(readFileSync(path.join(root, "public/decks/index.json"), "utf8")) as { decks: { id: string }[] }).decks.map((deck) => deck.id);
const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beeline-splash-test-"));
  temps.push(dir);
  return dir;
};
function listAll(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listAll(path.join(dir, entry.name), base) : [path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/")])).sort();
}
/** A stand-in for Frame Lab's folder: the shipped files plus the ones that must never be copied. */
function fakeSource() {
  const dir = temp();
  cpSync(SPLASH_DIR, dir, { recursive: true });
  for (const file of SPLASH_EXCLUDED) writeFileSync(path.join(dir, file), "not shipped\n");
  for (const folder of SPLASH_EXCLUDED_DIRS) cpSync(path.join(dir, "splash-base.css"), path.join(dir, folder, "copy.css"), { recursive: true });
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("splash registry", () => {
  it("has a Frame Lab page for every shipped deck id, and nothing for decks that don't exist", () => {
    expect(deckIds).toHaveLength(11);
    expect(Object.keys(SPLASH_ASSETS).sort()).toEqual([...deckIds].sort());
    for (const id of deckIds) {
      const asset = SPLASH_ASSETS[id]!;
      expect(asset.kind).toBe("frame");
      expect(SPLASH_PAGES.map((page) => `splash/${page}`)).toContain(asset.src);
    }
    expect(SPLASH_ASSETS["horror-movie-poster-secret-lair"]!.src).toBe("splash/splashes/horror-c.html");
    expect(SPLASH_ASSETS.silksong!.src).toBe("splash/splashes/silksong.html");
    expect(SPLASH_FALLBACK.src).toBe("splash/splashes/beeline.html");
    // Every page is played by exactly one deck or the fallback.
    const srcs = [...Object.values(SPLASH_ASSETS).map((asset) => asset.src), SPLASH_FALLBACK.src].sort();
    expect(srcs).toEqual(SPLASH_PAGES.map((page) => `splash/${page}`).sort());
  });
});

describe("splash files", () => {
  it("allow-lists Frame Lab's 40 frozen files less the player (39), and none of the excluded ones", () => {
    expect(SPLASH_ALLOW_LIST).toHaveLength(39);
    expect(manifest.size).toBe(39);
    expect(SPLASH_NOT_SHIPPED).toEqual(["splash-player.js"]);
    expect([...manifest.keys()].sort()).toEqual([...SPLASH_ALLOW_LIST]);
    // Frame Lab's FINAL.sha256 is kept byte for byte for provenance (40 lines, the player's included).
    expect(createHash("sha256").update(readFileSync(SPLASH_FINAL)).digest("hex")).toBe("a4be742ff59092a910ec2625985eeefee48f4e0c34a8fa01883b72d17ab69c93");
    expect(readManifest(readFileSync(SPLASH_FINAL, "utf8")).size).toBe(40);
    expect(allowListProblems(readManifest(readFileSync(SPLASH_FINAL, "utf8")))).toEqual(["splash-player.js: not shipped, but in the manifest"]);
    expect(allowListProblems(manifest, [...SPLASH_ALLOW_LIST, "splash-player.js"])).toContain("splash-player.js: excluded, but on the allow-list");
    expect(allowListProblems(manifest)).toEqual([]);
    for (const file of ["splashes/horror.html", "splashes/horror-a.html", "splashes/horror-b.html", "fonts/fell-sc.woff2", "fonts/vt323.woff2", "index.html"]) {
      expect(SPLASH_EXCLUDED).toContain(file);
      expect(SPLASH_ALLOW_LIST).not.toContain(file);
    }
    expect(SPLASH_EXCLUDED_DIRS).toEqual(["review/", "tools/"]);
    expect(allowListProblems(manifest, [...SPLASH_ALLOW_LIST, "splashes/horror-a.html"])).toContain("splashes/horror-a.html: excluded, but on the allow-list");
    expect(allowListProblems(manifest, SPLASH_ALLOW_LIST.filter((file) => file !== "fonts/anton.woff2"))).toContain("fonts/anton.woff2: in the manifest, not on the allow-list");
  });

  it("checks against a derived 39-line manifest: FINAL.sha256 less the splash-player.js line, every other byte the same", () => {
    const finalText = readFileSync(SPLASH_FINAL, "utf8");
    const shippedText = readFileSync(SPLASH_MANIFEST, "utf8");
    const playerLine = finalText.split("\n").filter((line) => line.endsWith("  splash-player.js"));
    expect(playerLine).toHaveLength(1);
    expect(shippedText).toBe(finalText.replace(`${playerLine[0]}\n`, ""));
    expect(shippedText).toBe(shippedManifestText(finalText));
    expect(shippedText.split("\n").filter(Boolean)).toHaveLength(39);
    expect(shippedText).not.toContain("splash-player.js");
    expect(manifestProblems(finalText, shippedText)).toEqual([]);
    const drift = ["scripts/splash-shipped.sha256: not scripts/splash-final.sha256 less the splash-player.js line"];
    expect(manifestProblems(finalText, finalText)).toEqual(drift);
    expect(manifestProblems(finalText, shippedText.replace(/^[0-9a-f]/, (c) => (c === "0" ? "1" : "0")))).toEqual(drift);
    expect(manifestProblems(finalText, shippedText.split("\n").slice(1).join("\n"))).toEqual(drift);
    expect(manifestProblems(finalText, `${shippedText}\n`)).toEqual(drift);
    expect(checkSplash(SPLASH_DIR, manifest, undefined, { final: finalText, shipped: finalText })).toContain(drift[0]);
    expect(checkSplash(SPLASH_DIR, manifest, undefined, { final: finalText, shipped: shippedText })).toEqual([]);
  });

  it("passes a plain sha256sum -c of the shipped manifest inside public/splash/", () => {
    const out = execFileSync("sha256sum", ["-c", SPLASH_MANIFEST], { cwd: SPLASH_DIR, encoding: "utf8" });
    expect(out.trim().split("\n")).toHaveLength(39);
    expect(out.trim().split("\n").every((line) => line.endsWith(": OK"))).toBe(true);
  });

  it("ships public/splash/ exactly as the manifest says, with the excluded files absent", () => {
    expect(listAll(SPLASH_DIR)).toEqual([...SPLASH_ALLOW_LIST]);
    for (const file of SPLASH_EXCLUDED) expect(existsSync(path.join(SPLASH_DIR, file))).toBe(false);
    for (const folder of SPLASH_EXCLUDED_DIRS) expect(existsSync(path.join(SPLASH_DIR, folder))).toBe(false);
    expect(checkSplash(SPLASH_DIR, manifest)).toEqual([]);
  });

  it("copies only the allow-list, writes nothing the second time, and removes a file that isn't on it", () => {
    const source = fakeSource();
    const dest = temp();
    const first = copySplash(source, dest, manifest);
    expect(first.written).toHaveLength(39);
    expect(first.written).not.toContain("splash-player.js");
    expect(listAll(dest)).toEqual([...SPLASH_ALLOW_LIST]);
    const second = copySplash(source, dest, manifest);
    expect(second).toEqual({ written: [], unchanged: [...SPLASH_ALLOW_LIST], removed: [] });
    writeFileSync(path.join(dest, "splashes/horror-b.html"), "an old variant\n");
    cpSync(path.join(source, "review"), path.join(dest, "review"), { recursive: true });
    const third = copySplash(source, dest, manifest);
    expect(third.removed.sort()).toEqual(["review/copy.css", "splashes/horror-b.html"]);
    expect(listAll(dest)).toEqual([...SPLASH_ALLOW_LIST]);
    expect(checkSplash(dest, manifest)).toEqual([]);
  });

  it("refuses to copy a source that doesn't match the manifest, and changes nothing", () => {
    const source = fakeSource();
    writeFileSync(path.join(source, "splashes/vader.html"), readFileSync(path.join(source, "splashes/vader.html"), "utf8") + "<!-- edited -->");
    const dest = temp();
    expect(() => copySplash(source, dest, manifest)).toThrow(/splashes\/vader\.html: sha256 differs from the manifest/);
    expect(listAll(dest)).toEqual([]);
  });

  it("--check finds a changed, missing or extra file, and a network URL", () => {
    const dest = temp();
    copySplash(fakeSource(), dest, manifest);
    writeFileSync(path.join(dest, "fonts/anton.woff2"), "x");
    rmSync(path.join(dest, "assets/bee.svg"));
    writeFileSync(path.join(dest, "splashes/horror.html"), "x");
    const vader = path.join(dest, "splashes/vader.html");
    writeFileSync(vader, readFileSync(vader, "utf8").replace("</head>", '<script src="https://cdn.example.com/x.js"></script></head>'));
    const problems = checkSplash(dest, manifest);
    expect(problems).toContain("splashes/vader.html: network URL https://cdn.example.com/x.js");
    expect(problems).toContain("fonts/anton.woff2: sha256 differs from the manifest");
    expect(problems).toContain("assets/bee.svg: missing");
    expect(problems).toContain("splashes/horror.html: not on the allow-list");
  });

  it("flags a network URL, a key, a Drive id, a user name, an unlisted font or file, a font path outside the folder, and a registry mismatch", () => {
    const dest = temp();
    copySplash(fakeSource(), dest, manifest);
    const page = (name: string) => path.join(dest, "splashes", name);
    const edit = (name: string, change: (html: string) => string) => writeFileSync(page(name), change(readFileSync(page(name), "utf8")));
    edit("vader.html", (html) => html.replace("</head>", '<link rel="stylesheet" href="https://fonts.example.com/x.css"></head>'));
    edit("tmnt.html", (html) => html.replace("</body>", `<!-- ${["AI", "za"].join("")}SyExample -->\n</body>`));
    edit("kpdh.html", (html) => html.replace("</body>", `<!-- ${["1AbCdEfGhIj", "KlMnOpQrSt", "UvWxYz012345"].join("")} -->\n</body>`));
    edit("nier.html", (html) => html.replace("</body>", `<!-- ${["Ja", "mes"].join("")} -->\n</body>`));
    edit("xmen.html", (html) => html.replace("BL Bangers", "BL Fell").replace("</body>", '<img src="../assets/extra.png">\n</body>'));
    edit("sxf.html", (html) => html.replace('data-duration="2200"', 'data-duration="2900"'));
    const css = path.join(dest, "splash-base.css");
    // A font declared but not shipped (like the BL Fell of Frame Lab's earlier freeze).
    writeFileSync(css, readFileSync(css, "utf8").replace("url(fonts/russo.woff2)", "url(../fonts/russo.woff2)") + '@font-face{font-family:"BL Fell";src:url(fonts/fell-sc.woff2) format("woff2");font-display:block}\n');
    const problems = contentProblems(dest).join("\n");
    // The font path bug of Frame Lab's first freeze: relative to splash-base.css, ../fonts leaves the folder.
    expect(problems).toMatch(/splash-base\.css: refers to \.\.\/fonts\/russo\.woff2, outside the splash folder/);
    expect(problems).toMatch(/splashes\/eggman\.html: uses BL Russo \(\.\.\/fonts\/russo\.woff2\), not on the allow-list/);
    expect(problems).toMatch(/splashes\/vader\.html: network URL https:\/\/fonts\.example\.com/);
    expect(problems).toMatch(/splashes\/tmnt\.html: holds a Google API key prefix/);
    expect(problems).toMatch(/splashes\/kpdh\.html: 1 Drive-id-like string/);
    expect(problems).toMatch(/splashes\/nier\.html: holds a user name/);
    expect(problems).toMatch(/splashes\/xmen\.html: uses BL Fell \(fonts\/fell-sc\.woff2\), not on the allow-list/);
    expect(problems).toMatch(/splashes\/xmen\.html: refers to assets\/extra\.png, not on the allow-list/);
    expect(problems).toMatch(/splashes\/sxf\.html: registry durationMs 2200, page data-duration 2900/);
  });

  it("ships no splash-player.js in public/ or dist/, and an upgrade's copy removes an old one", { timeout: 60_000 }, () => {
    const everywhere = (dir: string): string[] => (existsSync(dir) ? listAll(dir).filter((file) => path.posix.basename(file) === "splash-player.js") : []);
    expect(everywhere(path.join(root, "public"))).toEqual([]);
    // A build of its own, so another test rebuilding dist/ at the same time can't race it.
    const built = temp();
    execSync(`npx vite build --outDir "${built}" --emptyOutDir`, { cwd: root, stdio: "pipe", timeout: 60_000 });
    expect(existsSync(path.join(built, "index.html"))).toBe(true);
    expect(existsSync(path.join(built, "splash", "splash-runtime.js"))).toBe(true);
    expect(everywhere(built)).toEqual([]);
    // dist/ may be mid-rebuild by another test (emptyOutDir), so a folder that vanishes while it is read is
    // tried again; the fresh-unzip verify checks the final dist/ as well.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        if (existsSync(path.join(root, "dist"))) expect(everywhere(path.join(root, "dist"))).toEqual([]);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt === 4) throw error;
      }
    }
    const source = fakeSource();
    writeFileSync(path.join(source, "splash-player.js"), "Frame Lab's player\n");
    const dest = temp();
    copySplash(source, dest, manifest);
    writeFileSync(path.join(dest, "splash-player.js"), "left over from v0.1.32\n");
    expect(checkSplash(dest, manifest)).toContain("splash-player.js: not on the allow-list");
    const again = copySplash(source, dest, manifest);
    expect(again.removed).toEqual(["splash-player.js"]);
    expect(existsSync(path.join(dest, "splash-player.js"))).toBe(false);
    expect(checkSplash(dest, manifest)).toEqual([]);
  });

  it("resolves every url() in the shipped splash CSS to a shipped file, with no exceptions", () => {
    // Every stylesheet and inline style the splash ships, with the folder its relative urls resolve from.
    const sheets: { file: string; css: string }[] = [];
    for (const file of SPLASH_ALLOW_LIST) {
      const text = readFileSync(path.join(SPLASH_DIR, file), "utf8");
      if (file.endsWith(".css")) sheets.push({ file, css: text });
      if (file.endsWith(".html")) {
        for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) sheets.push({ file, css: match[1]! });
        for (const match of text.matchAll(/\sstyle="([^"]*)"/gi)) sheets.push({ file, css: match[1]! });
      }
    }
    expect(sheets.some((sheet) => sheet.file === "splash-base.css")).toBe(true);
    const unresolved: string[] = [];
    let urls = 0;
    for (const { file, css } of sheets) {
      for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const ref = match[2]!.trim();
        if (ref.startsWith("data:") || ref.startsWith("#")) continue;
        urls += 1;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.split(/[?#]/)[0]!));
        if (target.startsWith("../") || !SPLASH_ALLOW_LIST.includes(target) || !existsSync(path.join(SPLASH_DIR, target))) unresolved.push(target);
      }
    }
    expect(SPLASH_CSS_UNSHIPPED_URLS).toEqual([]);
    expect(unresolved).toEqual([]);
    // Every @font-face in splash-base.css loads a shipped font, and every shipped font is declared.
    const css = readFileSync(path.join(SPLASH_DIR, "splash-base.css"), "utf8");
    const declared = [...css.matchAll(/@font-face\{[^}]*?url\(\s*['"]?([^'")]+)/g)].map((match) => path.posix.normalize(match[1]!));
    const shippedFonts = SPLASH_ALLOW_LIST.filter((file) => file.startsWith("fonts/"));
    expect(declared).toHaveLength(22);
    expect(urls).toBe(22);
    expect([...new Set(declared)].sort()).toEqual(shippedFonts);
    expect(css).not.toMatch(/BL VT323|BL Fell|vt323|fell-sc/);
  });

  it("never loads Frame Lab's player: the app plays the pages itself", () => {
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(path.join(dir, entry.name)) : /\.(?:tsx?|css|html)$/.test(entry.name) && !entry.name.includes(".test.") ? [path.join(dir, entry.name)] : []));
    for (const file of [...sources(path.join(root, "src")), path.join(root, "index.html")]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/splash-player|BeeLineSplash|beeline\.splashSeen/);
    }
  });
});
