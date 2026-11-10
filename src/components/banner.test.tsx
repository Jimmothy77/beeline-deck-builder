import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeeLineBanner } from "@/components/BeeLineBanner";
import { BANNER_COPY, SHOP_URL } from "@/components/banner-copy";

const root = path.resolve(import.meta.dirname, "../..");
const html = renderToStaticMarkup(<BeeLineBanner />);
const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("BeeLine banner", () => {
  it("shows the exact homepage copy", () => {
    expect(BANNER_COPY).toEqual({
      kicker: "BeeLine Deck Builder",
      title: "BeeLine",
      tagline: "The shortest path from Beespair art to a Leyline print.",
      blurb: "Pick a deck, swap the art, and download the XML. Save your decks and customize them the way you want. Leave the rest up to me.",
    });
    expect(html).toContain('<h1 class="wordmark">BeeLine</h1>');
    for (const line of Object.values(BANNER_COPY)) expect(text).toContain(line);
    expect(text).toContain("Card designs and deck lists by Beespair.");
    expect(text).not.toContain("Artwork and deck lists");
    expect(text).toContain("Head over to Beespair's Shop to get your premium files if you haven't already.");
  });

  it("links Beespair's Shop to the Ko-fi shop in a new tab", () => {
    expect(SHOP_URL).toBe("https://ko-fi.com/beespair/shop");
    expect(html).toMatch(/<a href="https:\/\/ko-fi\.com\/beespair\/shop" target="_blank" rel="noopener noreferrer">Beespair&#x27;s Shop<\/a>/);
  });

  it("puts the slot left of the wordmark, the card in the orbit, and the yellow bee on top", () => {
    expect(html.indexOf("brand-slot")).toBeLessThan(html.indexOf("wordmark"));
    expect(html).toMatch(/class="orbit"[^>]*><img class="emblem-back" src="[^"]*brand\/meridian-back\.png"[^>]*\/><img class="emblem-front" src="[^"]*brand\/meridian-front\.png"/);
    expect(html).toMatch(/class="flyer" src="[^"]*brand\/beespair-bee-yellow\.svg"/);
  });

  it("ships the traced mascot and meridian art unchanged from the mockups", () => {
    const bee = readFileSync(path.join(root, "public/brand/beespair-bee-yellow.svg"), "utf8");
    expect(bee).toMatch(/^<svg|<\?xml/);
    expect(readFileSync(path.join(root, "public/favicon.svg"), "utf8")).toBe(bee);
    for (const name of ["meridian-back.png", "meridian-front.png"]) {
      const png = readFileSync(path.join(root, "public/brand", name));
      expect(png.readUInt32BE(16)).toBe(437);
      expect(png.readUInt32BE(20)).toBe(673);
    }
  });
});

describe("banner stacking", () => {
  const css = readFileSync(path.join(root, "src/index.css"), "utf8");
  const rules = (selector: RegExp) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => selector.test(m[1]!)).map((m) => m[2]!);

  it("sets no z-index, filter, opacity, or transform on the orbit or banner-top", () => {
    const parents = rules(/\.(orbit|banner-top)\s*(,|$)/);
    expect(parents.length).toBeGreaterThanOrEqual(3);
    for (const body of parents) expect(body).not.toMatch(/z-index|filter|opacity|transform|isolation|will-change|contain\s*:/);
  });

  it("layers the card back, the bee, the card front, and the trail in that order", () => {
    const z = (selector: RegExp) => Number(rules(selector).join(";").match(/z-index:\s*(\d+)/)?.[1]);
    expect(z(/\.emblem-back\s*\{?$/)).toBe(1);
    expect(z(/\.flyer\.behind/)).toBe(2);
    expect(z(/\.emblem-front\s*$/)).toBe(3);
    expect(z(/\.flyer\s*$/)).toBe(4);
  });

  it("lands at once for reduced motion", () => {
    const source = readFileSync(path.join(root, "src/components/BeeLineBanner.tsx"), "utf8");
    expect(source).toMatch(/prefers-reduced-motion: reduce/);
    expect(source).toMatch(/if \(prefersReducedMotion\(\)\) land\(\);/);
  });
});

describe("rebrand", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });

  it("shows no old name and no personal name in the app or page", () => {
    const sources = [...files(path.join(root, "src")), path.join(root, "index.html"), path.join(root, "public/config.js")].filter((file) => /\.(tsx?|html|js|css)$/.test(file));
    for (const file of sources) {
      const body = readFileSync(file, "utf8");
      expect(body, file).not.toMatch(new RegExp(["print", "a", "bee"].join("-"), "i"));
      expect(body, file).not.toMatch(new RegExp(["ja", "mes"].join(""), "i"));
    }
    expect(readFileSync(path.join(root, "index.html"), "utf8")).toContain("<title>BeeLine Deck Builder</title>");
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))).toMatchObject({ name: "beeline-deck-builder", version: "0.1.27" });
  });
});
