import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowListProblems, checkSplash, contentProblems, copySplash, readManifest, SPLASH_DIR, SPLASH_MANIFEST } from "../../scripts/copy-splash";
import { SPLASH_ALLOW_LIST, SPLASH_EXCLUDED, SPLASH_EXCLUDED_DIRS, SPLASH_PAGES } from "../../scripts/splash-files";
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
  it("allow-lists exactly Frame Lab's 40 frozen files, and none of the excluded ones", () => {
    expect(SPLASH_ALLOW_LIST).toHaveLength(40);
    expect([...manifest.keys()].sort()).toEqual([...SPLASH_ALLOW_LIST]);
    expect(allowListProblems(manifest)).toEqual([]);
    for (const file of ["splashes/horror.html", "splashes/horror-a.html", "splashes/horror-b.html", "fonts/fell-sc.woff2", "fonts/vt323.woff2", "index.html"]) {
      expect(SPLASH_EXCLUDED).toContain(file);
      expect(SPLASH_ALLOW_LIST).not.toContain(file);
    }
    expect(SPLASH_EXCLUDED_DIRS).toEqual(["review/", "tools/"]);
    expect(allowListProblems(manifest, [...SPLASH_ALLOW_LIST, "splashes/horror-a.html"])).toContain("splashes/horror-a.html: excluded, but on the allow-list");
    expect(allowListProblems(manifest, SPLASH_ALLOW_LIST.filter((file) => file !== "fonts/anton.woff2"))).toContain("fonts/anton.woff2: in the manifest, not on the allow-list");
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
    expect(first.written).toHaveLength(40);
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
    writeFileSync(css, readFileSync(css, "utf8").replace("url(fonts/russo.woff2)", "url(../fonts/russo.woff2)"));
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

  it("never loads Frame Lab's player: the app plays the pages itself", () => {
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(path.join(dir, entry.name)) : /\.(?:tsx?|css|html)$/.test(entry.name) && !entry.name.includes(".test.") ? [path.join(dir, entry.name)] : []));
    for (const file of [...sources(path.join(root, "src")), path.join(root, "index.html")]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/splash-player|BeeLineSplash|beeline\.splashSeen/);
    }
  });
});
