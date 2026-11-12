/**
 * The v0.1.33 Drive layout: a public BeeLine folder of deck folders, each holding a shortcut to that
 * deck's Standard folder. The deck parents (Standard beside Deluxe and Partial Foil) are Restricted, and
 * the Ko-fi order links straight to the paid folder. Every id here is fake.
 */
import { describe, expect, it } from "vitest";
import { canonicalDeckId, canonicalDeckName, DECK_ALIASES } from "@/data/deck-aliases";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "@/data/splash-assets";
import {
  assertPublicTreeFree,
  buildShippedStandardTree,
  guardPublicTree,
  listId,
  PaidFolderError,
  PublicTreeError,
  parseEmbeddedFolder,
  type ListedFolder,
  type Lister,
} from "@/lib/crawl";
import { readDriveTree } from "@/lib/drive";
import { catalogueFromTree, looksLikePaidName, productEditionKind } from "@/lib/group";
import { preferDeckName } from "@/lib/names";
import { splashFor } from "@/lib/splash";
import type { DeckIndex } from "@/lib/types";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkPublicTree } from "../../scripts/build-catalogue";
import { deckForEntry, rootProblems } from "../../scripts/check-public-root";
import { PUBLIC_FOLDER_PATHS } from "../../scripts/public-folder-paths";
import { listEmbedded, ListingError } from "../../scripts/public-root";

const root = path.resolve(import.meta.dirname, "../..");
const shipped = (JSON.parse(readFileSync(path.join(root, "public/decks/index.json"), "utf8")) as DeckIndex).decks;

const NAMES = PUBLIC_FOLDER_PATHS;
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

/** A fake Drive: folders, files and shortcuts by id. `restricted` folders can't be listed or read. */
type Node = { name: string; kind: "folder" | "file" | "shortcut"; children?: string[]; target?: string; restricted?: true };
type World = Record<string, Node>;

function standardDeck(world: World, key: string, standardName: string, fileName = "Sol Ring.png") {
  world[`std${key}_fake`] = { name: standardName, kind: "folder", children: [`full${key}_fake`] };
  world[`full${key}_fake`] = { name: "Full Deck", kind: "folder", children: [`file${key}_fake`] };
  world[`file${key}_fake`] = { name: fileName, kind: "file" };
}
function deluxeDeck(world: World, key: string, name: string) {
  world[`dlx${key}_fake`] = { name, kind: "folder", children: [`dlxFull${key}_fake`] };
  world[`dlxFull${key}_fake`] = { name: "Full Deck", kind: "folder", children: [`dlxFile${key}_fake`] };
  world[`dlxFile${key}_fake`] = { name: "Sol Ring.png", kind: "file" };
}
function partialDeck(world: World, key: string, name: string) {
  world[`pf${key}_fake`] = { name, kind: "folder", children: [`pfMap${key}_fake`] };
  world[`pfMap${key}_fake`] = { name: "PDF Partial Foil Map", kind: "folder", children: [`pfFull${key}_fake`] };
  world[`pfFull${key}_fake`] = { name: "Full Deck", kind: "folder", children: [`pfFile${key}_fake`] };
  world[`pfFile${key}_fake`] = { name: "Sol Ring.pdf", kind: "file" };
}

/** BeeLine with three decks, plus the Restricted SxF parent that holds all three SxF editions. */
function beeLine(): World {
  const world: World = {
    fakeRoot0001: { name: "BeeLine", kind: "folder", children: ["wrapP500001", "wrapTmnt0001", "wrapSxf00001"] },
    wrapP500001: { name: "10_Persona 5", kind: "folder", children: ["scutP500001"] },
    scutP500001: { name: "1_P5 Standard Edition", kind: "shortcut", target: "stdP5_fake" },
    wrapTmnt0001: { name: "1_TMNT", kind: "folder", children: ["scutTmnt0001"] },
    scutTmnt0001: { name: "TMNT", kind: "shortcut", target: "stdTmnt_fake" },
    wrapSxf00001: { name: "6_SxF", kind: "folder", children: ["scutSxf00001"] },
    scutSxf00001: { name: "1_Spy x Family Standard Edition", kind: "shortcut", target: "stdSxf_fake" },
    parentSxf001: { name: "6_SxF", kind: "folder", children: ["stdSxf_fake", "dlxSxf_fake", "pfSxf_fake"], restricted: true },
  };
  standardDeck(world, "P5", "1_P5 Standard Edition");
  standardDeck(world, "Tmnt", "TMNT");
  world.fullTmnt_fake!.name = "Full Deck (800 DPI)";
  standardDeck(world, "Sxf", "1_Spy x Family Standard Edition");
  deluxeDeck(world, "Sxf", "2_Spy x Family Deluxe Edition");
  partialDeck(world, "Sxf", "3_Spy x Family Partial Foil Edition");
  return world;
}

const PAID_IDS = /^(dlx|pf|parent)/;

/** The embedded-folder-view lister the catalogue scripts use, over a fake world. */
function embeddedLister(world: World) {
  const listed: string[] = [];
  const list: Lister = async (id) => {
    listed.push(id);
    const node = world[id];
    if (!node || node.restricted) throw new ListingError(401, "Drive folder listing failed (401). The folder may be Restricted.");
    if (node.kind === "shortcut") return { title: node.name, entries: [] };
    const entries = (node.children ?? []).map((child) => {
      const item = world[child]!;
      if (item.kind === "shortcut") {
        const target = world[item.target!];
        return { id: child, name: item.name, folder: target?.kind !== "file", shortcut: true as const, targetId: item.target };
      }
      return { id: child, name: item.name, folder: item.kind === "folder" };
    });
    return { title: node.name, entries } satisfies ListedFolder;
  };
  return { list, listed };
}

/** Drive API v3 over a fake world, recording every request. `parents` is never answered. */
function driveApi(world: World) {
  const requests: string[] = [];
  const listed: string[] = [];
  const meta: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fileOf = (id: string) => {
    const node = world[id]!;
    if (node.kind === "shortcut") return { id, name: node.name, mimeType: SHORTCUT, shortcutDetails: { targetId: node.target, targetMimeType: world[node.target!]?.kind === "file" ? "image/png" : FOLDER } };
    return { id, name: node.name, mimeType: node.kind === "folder" ? FOLDER : node.name.endsWith(".pdf") ? "application/pdf" : "image/png" };
  };
  const fetchImpl = async (input: string) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    requests.push(url);
    const parent = url.match(/'([^']+)' in parents/)?.[1];
    if (parent) {
      listed.push(parent);
      const node = world[parent];
      if (!node || node.restricted) return json({ error: { message: "File not found" } }, 404);
      return json({ files: (node.children ?? []).map(fileOf) });
    }
    const id = url.match(/\/files\/([^?/]+)/)?.[1];
    if (id) {
      meta.push(id);
      const node = world[id];
      if (!node || node.restricted) return json({ error: { message: "File not found" } }, 404);
      return json(fileOf(id));
    }
    return json({ error: { message: "unexpected" } }, 400);
  };
  return { fetchImpl, requests, listed, meta };
}

describe("parsing a public folder listing with shortcuts", () => {
  it("keeps a shortcut's own id and lists its target", () => {
    // The shape of Drive's embedded folder view for a shortcut (from a public BeeLine deck folder, ids replaced).
    const html = `<html><head><title>4_Vader</title></head><body><div class="flip-entries">
      <div class="flip-entry" id="entry-scutFake01" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/targFake01" target="_blank"><div class="flip-entry-visual"><div class="flip-entry-visual-card"><div class="flip-entry-icon"><svg class="drive-shortcut-icon icon-svg" width="16px" height="16px" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="white"/></svg><div aria-label="Folder" class="icon-color-1"></div></div></div></div><div class="flip-entry-title">1_Vader Standard Edition</div></a></div></div>
      <div class="flip-entry" id="entry-plainFolder1"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/plainFolder1"><div aria-label="Folder"></div><div class="flip-entry-title">Extras</div></a></div></div>
      <div class="flip-entry" id="entry-fileShortcut"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/realFile0001/view"><svg class="drive-shortcut-icon"></svg><div class="flip-entry-title">Card.png</div></a></div></div>
    </div></body></html>`;
    const listed = parseEmbeddedFolder(html);
    expect(listed.title).toBe("4_Vader");
    expect(listed.entries).toEqual([
      { id: "scutFake01", name: "1_Vader Standard Edition", folder: true, shortcut: true, targetId: "targFake01" },
      { id: "plainFolder1", name: "Extras", folder: true },
      { id: "fileShortcut", name: "Card.png", folder: false, shortcut: true, targetId: "realFile0001" },
    ]);
    expect(listed.entries.map(listId)).toEqual(["targFake01", "plainFolder1", "realFile0001"]);
  });
});

describe("the public-root guard", () => {
  it("passes BeeLine, follows every shortcut to a Standard folder, and never lists the Restricted parent", async () => {
    const world = beeLine();
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.paid).toEqual([]);
    expect(report.unreadable).toEqual([]);
    expect(report.shortcuts).toBe(3);
    expect(report.decks).toEqual([
      { entry: "10_Persona 5", via: ["1_P5 Standard Edition"], standard: "1_P5 Standard Edition" },
      { entry: "1_TMNT", via: ["TMNT"], standard: "TMNT" },
      { entry: "6_SxF", via: ["1_Spy x Family Standard Edition"], standard: "1_Spy x Family Standard Edition" },
    ]);
    expect(listed.filter((id) => PAID_IDS.test(id))).toEqual([]);
    expect(() => assertPublicTreeFree(report)).not.toThrow();
  });

  const cases: [string, (world: World) => void, string][] = [
    [
      "a paid folder straight under the root",
      (world) => world.fakeRoot0001!.children!.push("dlxSxf_fake"),
      "BeeLine / 2_Spy x Family Deluxe Edition",
    ],
    [
      "a paid folder inside a deck folder",
      (world) => world.wrapSxf00001!.children!.push("pfSxf_fake"),
      "BeeLine / 6_SxF / 3_Spy x Family Partial Foil Edition",
    ],
    [
      "a paid folder nested deep inside Standard",
      (world) => world.fullP5_fake!.children!.push("dlxSxf_fake"),
      "BeeLine / 10_Persona 5 / 1_P5 Standard Edition / Full Deck / 2_Spy x Family Deluxe Edition",
    ],
    [
      "a shortcut named as a paid edition",
      (world) => {
        world.scutPaid0001 = { name: "2_P5 Deluxe Edition", kind: "shortcut", target: "dlxSxf_fake" };
        world.wrapP500001!.children!.push("scutPaid0001");
      },
      "BeeLine / 10_Persona 5 / 2_P5 Deluxe Edition",
    ],
    [
      "an allowed shortcut path whose target is a paid folder",
      (world) => {
        world.scutTmnt0001!.target = "dlxSxf_fake";
      },
      "BeeLine / 1_TMNT / TMNT (shortcut to “2_Spy x Family Deluxe Edition”)",
    ],
  ];
  for (const [label, change, expected] of cases) {
    it(`fails on ${label}, naming the path and never an id`, async () => {
      const world = beeLine();
      change(world);
      const { list, listed } = embeddedLister(world);
      const report = await guardPublicTree("fakeRoot0001", list, NAMES);
      expect(report.paid).toContain(expected);
      let caught: unknown;
      try {
        assertPublicTreeFree(report);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PaidFolderError);
      const message = (caught as Error).message;
      expect(message).toContain(expected);
      for (const id of Object.keys(world)) expect(message).not.toContain(id);
      // A folder named as a paid edition is never listed; one reached by an innocent name is listed once
      // (that's how its title is learned) and not walked.
      expect(listed.filter((id) => id === "dlxFullSxf_fake" || id === "pfMapSxf_fake")).toEqual([]);
      expect(rootProblems(report, shipped.filter((deck) => ["persona-5", "tmnt", "sxf"].includes(deck.id))).some((line) => line.includes(expected))).toBe(true);
    });
  }

  it("fails on paid editions reached through a shortcut's Deluxe-named target, and on a paid root", async () => {
    const world = beeLine();
    const { list } = embeddedLister(world);
    const paidRoot = await guardPublicTree("dlxSxf_fake", list, NAMES);
    expect(paidRoot.paid).toEqual(["2_Spy x Family Deluxe Edition"]);
    expect(() => assertPublicTreeFree(paidRoot)).toThrow(PaidFolderError);
  });

  it("reports unreadable folders and an unreadable root by name", async () => {
    const world = beeLine();
    // The SxF shortcut now leads to the Restricted deck parent.
    world.scutSxf00001!.target = "parentSxf001";
    const { list } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.paid).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.unreadable).toEqual(["BeeLine / 6_SxF / 1_Spy x Family Standard Edition"]);
    const problems = rootProblems(report, shipped.filter((deck) => ["persona-5", "tmnt", "sxf"].includes(deck.id)));
    expect(problems).toEqual(["can't list: BeeLine / 6_SxF / 1_Spy x Family Standard Edition", "6_SxF: no Standard folder found under it"]);
    expect(problems.join("\n")).not.toMatch(/parentSxf001|scutSxf00001/);
    const gone = await guardPublicTree("noSuchRoot01", list, NAMES);
    expect(gone.unreadable).toEqual(["public root"]);
  });

  it("names every shipped deck missing from the root, a deck with no Standard, and one that isn't shipped", async () => {
    const world = beeLine();
    world.wrapNew00001 = { name: "Extras", kind: "folder", children: [] };
    world.wrapNew00002 = { name: "12_Brand New", kind: "folder", children: [] };
    world.fakeRoot0001!.children!.push("wrapNew00001", "wrapNew00002");
    // Root entries that aren't shipped decks only get this far when their paths are on the list.
    const allowed = new Set([...NAMES, "Extras", "1_Spy x Family Standard Edition", "1_Spy x Family Standard Edition / 1_Spy x Family Standard Edition"]);
    const { list } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, allowed);
    const problems = rootProblems(report, shipped);
    expect(problems).toContain("Extras: no Standard folder found under it");
    expect(problems).toContain("Extras: not one of the shipped decks");
    // A deck folder whose name isn't on the allow-list is refused by name and never listed.
    expect(problems).toContain("not on the public folder allow-list: BeeLine / 12_Brand New");
    // ...and isn't counted as a deck entry either.
    expect(problems.filter((line) => line.startsWith("12_Brand New"))).toEqual([]);
    const missing = problems.filter((line) => line.endsWith(": no entry in the public root"));
    expect(missing).toHaveLength(shipped.length - 3);
    expect(missing.join("\n")).not.toMatch(/TMNT|SxF|Persona 5/);
    // Two entries for one deck.
    world.wrapSxf00002 = { name: "1_Spy x Family Standard Edition", kind: "folder", children: ["scutSxf00001"] };
    world.fakeRoot0001!.children!.push("wrapSxf00002");
    const twice = rootProblems(await guardPublicTree("fakeRoot0001", embeddedLister(world).list, allowed), shipped);
    expect(twice).toContain("1_Spy x Family Standard Edition: a second entry for SxF");
  });

  it("matches a root entry to its deck by folder, shortcut or Standard name, aliases included", () => {
    const find = (entry: string, via: string[] = [], standard: string | null = null) => deckForEntry({ entry, via, standard }, shipped)?.id ?? null;
    expect(find("10_Persona 5")).toBe("persona-5");
    expect(find("1_P5 Standard Edition")).toBe("persona-5");
    expect(find("6_SxF")).toBe("sxf");
    expect(find("1_Spy x Family Standard Edition")).toBe("sxf");
    expect(find("Box", ["1_ Silksong Standard Edition"])).toBe("silksong");
    expect(find("Box", [], "1_Dr. Eggman Standard Edition")).toBe("dr-eggman");
    expect(find("3.1_Horror Movie Poster Secret Lair")).toBe("horror-movie-poster-secret-lair");
    expect(find("Box")).toBeNull();
  });
});

describe("the public-root guard is an allow-list", () => {
  const DISGUISED = ["DLX Edition", "PF Edition", "Partial Foil Templates", "Deluxe PSD", "D\u0435luxe Edition", "Premium Edition", "Foil Tokens", "p.f. edition", "dlx", "\uff24\uff25\uff2c\uff35\uff38\uff25"];

  it("reads every disguised paid name as paid, and no live public name as paid", () => {
    for (const name of DISGUISED) expect(looksLikePaidName(name), name).toBe(true);
    // The Cyrillic one reads as plain "dluxe edition" to the old edition match, so only the new rule catches it.
    expect(productEditionKind("D\u0435luxe Edition")).toBeNull();
    expect(productEditionKind("DLX Edition")).toBeNull();
    for (const name of [...PUBLIC_FOLDER_PATHS].flatMap((item) => item.split(" / "))) expect(looksLikePaidName(name), name).toBe(false);
    for (const name of ["Standard Edition", "Full Deck", "Extras", "Tokens", "Card Back", "PDF Decklist"]) expect(looksLikePaidName(name), name).toBe(false);
    // Separators are dropped before the word match, so a name that runs "p" into "f" across a space is refused
    // too. That errs toward stopping the build; no public name does it today (checked above).
    expect(looksLikePaidName("Top Fetch")).toBe(true);
  });

  it("keeps the allow-list to plain public name paths: no duplicates, no paid word, ASCII only, parents listed", () => {
    expect(PUBLIC_FOLDER_PATHS.size).toBeGreaterThan(100);
    for (const item of PUBLIC_FOLDER_PATHS) {
      const names = item.split(" / ");
      for (const name of names) {
        expect(name, item).not.toBe("");
        expect(name, item).toBe(name.trim());
        expect(name, item).toMatch(/^[\x20-\x7e]+$/);
        expect(looksLikePaidName(name), item).toBe(false);
      }
      // Every path's parent is on the list too, so nothing is reachable only through a gap.
      if (names.length > 1) expect(PUBLIC_FOLDER_PATHS.has(names.slice(0, -1).join(" / ")), item).toBe(true);
    }
    // Each path written once in the source list.
    const listed = [...readFileSync(path.join(root, "scripts/public-folder-paths.ts"), "utf8").matchAll(/^  ("(?:[^"\\]|\\.)*"),$/gm)].map((match) => JSON.parse(match[1]!) as string);
    expect(listed).toHaveLength(PUBLIC_FOLDER_PATHS.size);
    for (const item of ["2_X-Men / 1_X-Men Standard Edition", "10_Persona 5 / 1_P5 Standard Edition / Full Deck", "6_SxF / 1_Spy x Family Standard Edition / Extras", "10_Persona 5", "1_TMNT / TMNT"]) {
      expect(PUBLIC_FOLDER_PATHS.has(item), item).toBe(true);
    }
    // Bare names are not paths: "Extras" is allowed only where it is.
    for (const name of ["Extras", "Full Deck", "TMNT", "6_SxF / Extras"]) expect(PUBLIC_FOLDER_PATHS.has(name), name).toBe(false);
  });

  for (const name of DISGUISED) {
    it(`fails on “${name}” inside a deck, even if the name were on the list, and never lists it`, async () => {
      const world = beeLine();
      world.sneaky000001 = { name, kind: "folder", children: ["sneakyFile01"] };
      world.sneakyFile01 = { name: "Sol Ring.png", kind: "file" };
      world.fullSxf_fake!.children!.push("sneaky000001");
      for (const allowed of [NAMES, new Set([...NAMES, `6_SxF / 1_Spy x Family Standard Edition / Full Deck / ${name}`])]) {
        const { list, listed } = embeddedLister(world);
        const report = await guardPublicTree("fakeRoot0001", list, allowed);
        const where = `BeeLine / 6_SxF / 1_Spy x Family Standard Edition / Full Deck / ${name}`;
        expect(report.paid).toEqual([where]);
        expect(listed).not.toContain("sneaky000001");
        expect(() => assertPublicTreeFree(report)).toThrow(PaidFolderError);
        expect(() => assertPublicTreeFree(report)).toThrow(where);
      }
    });
  }

  it("refuses a folder name that isn't on the list, by name path, without listing it", async () => {
    const world = beeLine();
    world.bonus0000001 = { name: "Bonus Art", kind: "folder", children: ["dlxSxf_fake"] };
    world.stdP5_fake!.children!.push("bonus0000001");
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.paid).toEqual([]);
    expect(report.unknown).toEqual(["BeeLine / 10_Persona 5 / 1_P5 Standard Edition / Bonus Art"]);
    expect(listed).not.toContain("bonus0000001");
    expect(listed).not.toContain("dlxSxf_fake");
    expect(() => assertPublicTreeFree(report)).toThrow(PublicTreeError);
    expect(() => assertPublicTreeFree(report)).toThrow(/not on the public folder allow-list: BeeLine \/ 10_Persona 5 \/ 1_P5 Standard Edition \/ Bonus Art/);
  });

  it("checks a shortcut's own title before listing its target, and the target's title before walking it", async () => {
    for (const [name, field] of [["DLX Edition", "paid"], ["Bonus Art", "unknown"]] as const) {
      const world = beeLine();
      world.scutSneak001 = { name, kind: "shortcut", target: "stdP5_fake" };
      world.wrapTmnt0001!.children!.push("scutSneak001");
      const { list, listed } = embeddedLister(world);
      // The P5 Standard folder is reached first through its own shortcut, so drop that to see this one alone.
      world.wrapP500001!.children = [];
      const report = await guardPublicTree("fakeRoot0001", list, NAMES);
      expect(report[field]).toEqual([`BeeLine / 1_TMNT / ${name}`]);
      expect(listed).not.toContain("stdP5_fake");
    }
    // An allowed shortcut name whose target turns out to be unlisted: listed once for its title, then not walked.
    const world = beeLine();
    world.oddTarget001 = { name: "Old Stuff", kind: "folder", children: ["oddInner001"] };
    world.oddInner001 = { name: "Full Deck", kind: "folder", children: [] };
    world.scutTmnt0001!.target = "oddTarget001";
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.unknown).toEqual(["BeeLine / 1_TMNT / TMNT (shortcut to “Old Stuff”)"]);
    expect(listed).toContain("oddTarget001");
    expect(listed).not.toContain("oddInner001");
  });

  it("refuses an allowed name in the wrong place: an Extras shortcut to a paid edition's Extras folder, at deck level or deeper", async () => {
    for (const where of ["deck", "standard"] as const) {
      const world = beeLine();
      world.dlxSxf_fake!.children!.push("dlxExtraSxf1");
      world.dlxExtraSxf1 = { name: "Extras", kind: "folder", children: ["dlxExtraFil1"] };
      world.dlxExtraFil1 = { name: "Sol Ring.png", kind: "file" };
      world.scutExtra901 = { name: "Extras", kind: "shortcut", target: "dlxExtraSxf1" };
      // At deck level the path isn't on the list; inside Standard the path is ("Extras" really is there), but
      // a shortcut that deep is never followed.
      (where === "deck" ? world.wrapSxf00001! : world.stdSxf_fake!).children!.push("scutExtra901");
      const { list, listed } = embeddedLister(world);
      const report = await guardPublicTree("fakeRoot0001", list, NAMES);
      expect(report.paid).toEqual([]);
      expect(report.unknown).toEqual([where === "deck" ? "BeeLine / 6_SxF / Extras" : "BeeLine / 6_SxF / 1_Spy x Family Standard Edition / Extras (shortcut below deck level)"]);
      expect(listed).not.toContain("dlxExtraSxf1");
      expect(listed.filter((id) => PAID_IDS.test(id))).toEqual([]);
      expect(() => assertPublicTreeFree(report)).toThrow(PublicTreeError);
      // With the old flat list, where "Extras" was allowed anywhere, this would have been walked.
      expect(NAMES.has(`6_SxF / ${where === "deck" ? "" : "1_Spy x Family Standard Edition / "}Extras`)).toBe(where === "standard");
    }
  });

  it("follows a shortcut only at deck level: not inside a folder reached through a shortcut", async () => {
    const world = beeLine();
    world.scutWrapTm01 = { name: "1_TMNT", kind: "shortcut", target: "wrapTmnt0001" };
    world.fakeRoot0001!.children = ["wrapP500001", "scutWrapTm01", "wrapSxf00001"];
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.unknown).toEqual(["BeeLine / 1_TMNT / TMNT (shortcut below deck level)"]);
    expect(listed).toContain("wrapTmnt0001");
    expect(listed).not.toContain("stdTmnt_fake");
    expect(report.decks.map((deck) => deck.standard)).toEqual(["1_P5 Standard Edition", null, "1_Spy x Family Standard Edition"]);

    // Nor below a deck folder's own plain subfolder, even when every name on the path is on the list.
    const plain = beeLine();
    plain.boxSxf000001 = { name: "Box", kind: "folder", children: ["scutBoxExtra"] };
    plain.scutBoxExtra = { name: "Extras", kind: "shortcut", target: "stdP5_fake" };
    plain.wrapSxf00001!.children!.push("boxSxf000001");
    plain.wrapP500001!.children = [];
    const deeper = embeddedLister(plain);
    const allowed = new Set([...NAMES, "6_SxF / Box", "6_SxF / Box / Extras"]);
    const deep = await guardPublicTree("fakeRoot0001", deeper.list, allowed);
    expect(deep.unknown).toEqual(["BeeLine / 6_SxF / Box / Extras (shortcut below deck level)"]);
    expect(deeper.listed).toContain("boxSxf000001");
    expect(deeper.listed).not.toContain("stdP5_fake");
  });

  it("refuses an empty or missing listing title instead of trusting the shortcut's name", async () => {
    for (const title of ["", "   ", undefined]) {
      const world = beeLine();
      const { list: plain, listed } = embeddedLister(world);
      // The TMNT Standard folder comes back with no title.
      const list: Lister = async (id) => {
        const listing = await plain(id);
        return id === "stdTmnt_fake" ? ({ ...listing, title } as unknown as ListedFolder) : listing;
      };
      const report = await guardPublicTree("fakeRoot0001", list, NAMES);
      expect(report.unknown).toEqual(["BeeLine / 1_TMNT / TMNT (listing has no title)"]);
      expect(listed).toContain("stdTmnt_fake");
      expect(listed).not.toContain("fullTmnt_fake");
      expect(() => assertPublicTreeFree(report)).toThrow(PublicTreeError);
    }
  });

  it("refuses a folder with no name, and a root with no title, without listing anything under them", async () => {
    const world = beeLine();
    world.blankName001 = { name: "", kind: "folder", children: ["dlxSxf_fake"] };
    world.fakeRoot0001!.children!.push("blankName001");
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.unknown).toEqual(["BeeLine / (folder with no name)"]);
    expect(report.decks).toHaveLength(3);
    expect(listed).not.toContain("blankName001");

    world.fakeRoot0001!.name = "";
    const blank = embeddedLister(world);
    const rootReport = await guardPublicTree("fakeRoot0001", blank.list, NAMES);
    expect(rootReport.unknown).toEqual(["public root (listing has no title)"]);
    expect(blank.listed).toEqual(["fakeRoot0001"]);
    expect(() => assertPublicTreeFree(rootReport)).toThrow(PublicTreeError);
  });

  it("refuses the deck parent reached through an allowed shortcut path by its title, before walking it", async () => {
    const world = beeLine();
    delete world.parentSxf001!.restricted;
    world.scutSxf00001!.target = "parentSxf001";
    const { list, listed } = embeddedLister(world);
    const report = await guardPublicTree("fakeRoot0001", list, NAMES);
    expect(report.unknown).toEqual(["BeeLine / 6_SxF / 1_Spy x Family Standard Edition (shortcut to “6_SxF”)"]);
    expect(listed.filter((id) => /^(dlx|pf)/.test(id))).toEqual([]);
    expect(listed).not.toContain("stdSxf_fake");
  });

  it("build-catalogue stops on a paid folder, an unlisted name, or a folder it couldn't read, before building", async () => {
    const good = beeLine();
    await expect(checkPublicTree("fakeRoot0001", embeddedLister(good).list)).resolves.toMatchObject({ paid: [], unknown: [], unreadable: [] });

    const unreadable = beeLine();
    unreadable.scutSxf00001!.target = "parentSxf001";
    const failed = await checkPublicTree("fakeRoot0001", embeddedLister(unreadable).list).catch((error: Error) => error);
    expect(failed).toBeInstanceOf(PublicTreeError);
    expect((failed as Error).message).toContain("can't list: BeeLine / 6_SxF / 1_Spy x Family Standard Edition");
    for (const id of Object.keys(unreadable)) expect((failed as Error).message).not.toContain(id);

    const rootGone = await checkPublicTree("noSuchRoot01", embeddedLister(good).list).catch((error: Error) => error);
    expect((rootGone as Error).message).toContain("can't list: public root");

    const unknown = beeLine();
    unknown.wrapNew00002 = { name: "12_Brand New", kind: "folder", children: [] };
    unknown.fakeRoot0001!.children!.push("wrapNew00002");
    await expect(checkPublicTree("fakeRoot0001", embeddedLister(unknown).list)).rejects.toThrow(/not on the public folder allow-list: BeeLine \/ 12_Brand New/);

    const paid = beeLine();
    paid.wrapSxf00001!.children!.push("dlxSxf_fake");
    await expect(checkPublicTree("fakeRoot0001", embeddedLister(paid).list)).rejects.toThrow(PaidFolderError);
  });
});

describe("building a shipped catalogue from BeeLine", () => {
  it("builds each deck from the shortcut's Standard folder with the same deck name as before", async () => {
    const world = beeLine();
    // A shortcut inside Standard too (an Extras folder kept elsewhere), followed to its files.
    world.scutExtra001 = { name: "Extras", kind: "shortcut", target: "extrasP5Real" };
    world.extrasP5Real = { name: "Extras", kind: "folder", children: ["extraP5File1"] };
    world.extraP5File1 = { name: "Sol Ring 2.png", kind: "file" };
    world.stdP5_fake!.children!.push("scutExtra001");
    const { list, listed } = embeddedLister(world);
    const p5 = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "Persona 5", list });
    expect(p5.deckName).toBe("Persona 5");
    expect(JSON.stringify(p5.tree)).toContain("fileP5_fake");
    expect(JSON.stringify(p5.tree)).toContain("extraP5File1");
    const tmnt = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "TMNT", list });
    expect(tmnt.deckName).toBe("TMNT");
    expect(catalogueFromTree(tmnt.tree, tmnt.deckName).editions[0]!.cards.map((card) => card.faces[0]!.defaultArt?.id)).toEqual(["fileTmnt_fake"]);
    const sxf = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "SxF", list });
    expect(sxf.deckName).toBe("SxF");
    expect(catalogueFromTree(sxf.tree, sxf.deckName).id).toBe("sxf");
    expect(listed.filter((id) => PAID_IDS.test(id))).toEqual([]);
  });

  it("takes the shipped name from a shortcut placed straight under the root", async () => {
    const world = beeLine();
    world.fakeRoot0001!.children = ["scutSxf00001", "scutP500001"];
    const { list } = embeddedLister(world);
    const sxf = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "Spy x Family", list });
    expect(sxf.deckName).toBe("SxF");
    expect(catalogueFromTree(sxf.tree, sxf.deckName).id).toBe("sxf");
    const p5 = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "P5", list });
    expect(p5.deckName).toBe("Persona 5");
    expect(catalogueFromTree(p5.tree, p5.deckName).id).toBe("persona-5");
  });

  it("never crawls a folder inside Standard named like a paid edition (DLX, PF, a Cyrillic Deluxe)", async () => {
    const world = beeLine();
    world.dlxInStd001 = { name: "DLX Edition", kind: "folder", children: ["dlxInStdF01"] };
    world.dlxInStdF01 = { name: "Sol Ring 9.png", kind: "file" };
    world.pfInStd0001 = { name: "PF Edition", kind: "folder", children: [] };
    world.cyrInStd001 = { name: "D\u0435luxe PSD", kind: "folder", children: [] };
    world.stdP5_fake!.children!.push("dlxInStd001", "pfInStd0001", "cyrInStd001");
    const { list, listed } = embeddedLister(world);
    const p5 = await buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "Persona 5", list });
    expect(JSON.stringify(p5.tree)).not.toContain("dlxInStdF01");
    expect(listed).not.toContain("dlxInStd001");
    expect(listed).not.toContain("pfInStd0001");
    expect(listed).not.toContain("cyrInStd001");
  });

  it("stops before building when a paid edition sits beside the shortcut", async () => {
    const world = beeLine();
    world.wrapSxf00001!.children!.push("dlxSxf_fake");
    const { list, listed } = embeddedLister(world);
    await expect(buildShippedStandardTree({ rootId: "fakeRoot0001", deckQuery: "SxF", list })).rejects.toThrow(/BeeLine \/ 6_SxF \/ 2_Spy x Family Deluxe Edition/);
    expect(listed).not.toContain("dlxSxf_fake");
  });

  it("lists with retries, says nothing about the id, and gives up after three tries", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls < 3) return new Response("no", { status: 401 });
      return new Response(`<title>BeeLine</title><div class="flip-entry" id="entry-abc123def456"><a href="https://drive.google.com/drive/folders/abc123def456"><div class="flip-entry-title">1_TMNT</div></a></div>`);
    };
    const listed = await listEmbedded("fakeRoot0001", flaky, 0);
    expect(calls).toBe(3);
    expect(listed.entries.map((entry) => entry.name)).toEqual(["1_TMNT"]);
    const urls: string[] = [];
    const down = async (url: string) => {
      urls.push(url);
      return new Response("no", { status: 401 });
    };
    const failure = await listEmbedded("fakeRoot0001", down, 0).catch((error: Error) => error);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe("https://drive.google.com/embeddedfolderview?id=fakeRoot0001");
    expect(failure).toBeInstanceOf(ListingError);
    expect((failure as Error).message).not.toContain("fakeRoot0001");
    const signIn = async () => new Response("<title>Sign in - Google Accounts</title><a href='https://accounts.google.com/'>Sign in</a>");
    await expect(listEmbedded("fakeRoot0001", signIn, 0)).rejects.toThrow(/sign-in/);
  });
});

describe("unlocking from a pasted link", () => {
  const unlock = async (world: World, pasted: string) => {
    const api = driveApi(world);
    const tree = await readDriveTree(pasted, "test-api-key-value", api.fetchImpl);
    return { tree, api };
  };
  const noParents = (requests: string[]) => {
    for (const url of requests) {
      const fields = url.match(/[?&]fields=([^&]*)/)?.[1] ?? "";
      expect(fields).not.toMatch(/parents/);
    }
  };

  it("yields Standard only from a Standard folder or its shortcut, and never touches a paid folder", async () => {
    for (const pasted of ["stdSxf_fake", "scutSxf00001"]) {
      const world = beeLine();
      const { tree, api } = await unlock(world, pasted);
      const catalogue = catalogueFromTree(tree, preferDeckName(tree.name));
      expect(catalogue.name).toBe("Spy x Family");
      expect(catalogue.editions.map((edition) => edition.printType)).toEqual(["standard"]);
      expect(JSON.stringify(tree)).toContain("fileSxf_fake");
      expect([...api.listed, ...api.meta].filter((id) => PAID_IDS.test(id))).toEqual([]);
      noParents(api.requests);
    }
  });

  it("a free paste never opens a folder with a disguised paid name (DLX, PF, a Cyrillic Deluxe), as a folder or a shortcut", async () => {
    const world = beeLine();
    world.dlxInStd001 = { name: "DLX Edition", kind: "folder", children: ["dlxInStdF01"] };
    world.dlxInStdF01 = { name: "Sol Ring 9.png", kind: "file" };
    world.pfInStd0001 = { name: "PF Edition", kind: "folder", children: ["pfInStdF001"] };
    world.pfInStdF001 = { name: "Sol Ring 8.pdf", kind: "file" };
    world.cyrScut0001 = { name: "D\u0435luxe Edition", kind: "shortcut", target: "cyrTarget01" };
    world.cyrTarget01 = { name: "D\u0435luxe Edition", kind: "folder", children: ["cyrFile0001"] };
    world.cyrFile0001 = { name: "Sol Ring 7.png", kind: "file" };
    world.stdSxf_fake!.children!.push("dlxInStd001", "pfInStd0001", "cyrScut0001");
    for (const pasted of ["stdSxf_fake", "wrapSxf00001", "scutSxf00001"]) {
      const { tree, api } = await unlock(world, pasted);
      const flat = JSON.stringify(tree);
      expect(flat).toContain("fileSxf_fake");
      expect(flat).not.toMatch(/dlxInStdF01|pfInStdF001|cyrFile0001/);
      expect(api.listed).not.toContain("dlxInStd001");
      expect(api.listed).not.toContain("pfInStd0001");
      expect(api.listed).not.toContain("cyrTarget01");
      // None of these names is a paid edition to the old edition match, so only looksLikePaidName stops them.
      for (const name of ["DLX Edition", "PF Edition", "D\u0435luxe Edition"]) expect(productEditionKind(name)).toBeNull();
      noParents(api.requests);
    }
  });

  it("yields Standard only from a deck folder or the whole BeeLine folder, even with paid shortcuts inside", async () => {
    const world = beeLine();
    world.scutBonus001 = { name: "Bonus art", kind: "shortcut", target: "dlxSxf_fake" };
    world.scutPaid0001 = { name: "3_Spy x Family Partial Foil Edition", kind: "shortcut", target: "pfSxf_fake" };
    world.wrapSxf00001!.children!.push("scutBonus001", "scutPaid0001");
    const deck = await unlock(world, "wrapSxf00001");
    const flat = JSON.stringify(deck.tree);
    expect(flat).toContain("fileSxf_fake");
    expect(flat).not.toMatch(/dlxFileSxf_fake|pfFileSxf_fake/);
    // The innocently named shortcut's target is looked up (that's how its name is learned), never listed;
    // a shortcut named as a paid edition isn't even looked up.
    expect(deck.api.listed.filter((id) => PAID_IDS.test(id))).toEqual([]);
    expect(deck.api.meta.filter((id) => PAID_IDS.test(id))).toEqual(["dlxSxf_fake"]);
    const catalogue = catalogueFromTree(deck.tree, preferDeckName(deck.tree.name));
    expect(catalogue.editions.every((edition) => edition.printType === "standard")).toBe(true);
    noParents(deck.api.requests);

    const whole = await unlock(world, "fakeRoot0001");
    expect(whole.api.listed.filter((id) => PAID_IDS.test(id))).toEqual([]);
    expect(() => catalogueFromTree(whole.tree, preferDeckName(whole.tree.name))).toThrow(/several decks/);
    noParents(whole.api.requests);
  });

  // The 17 paid folders by the names they had beside Standard in v0.1.32's catalogues.
  const PAID: [string, string, string][] = [
    ["2_P5 Deluxe Edition", "p5", "persona-5"],
    ["3_P5 Partial Foil Edition", "p5", "persona-5"],
    ["2_X-Men Deluxe Edition", "x-men", "x-men"],
    ["2_Silksong Deluxe Edition", "silksong", "silksong"],
    ["3_Silksong Partial Foil Edition", "silksong", "silksong"],
    ["2_Vader Deluxe Edition", "vader", "vader"],
    ["3_Vader Partial Foil Edition", "vader", "vader"],
    ["2_KPDH Deluxe Edition", "kpdh", "kpdh"],
    ["3_KPDH Partial Foil Edition", "kpdh", "kpdh"],
    ["2_Spy x Family Deluxe Edition", "spy-x-family", "sxf"],
    ["3_Spy x Family Partial Foil Edition", "spy-x-family", "sxf"],
    ["2_Floating World Deluxe Edition", "floating-world", "floating-world"],
    ["3_Floating World Partial Foil Edition", "floating-world", "floating-world"],
    ["2_Dr. Eggman Deluxe Edition", "dr-eggman", "dr-eggman"],
    ["3_Dr. Eggman Partial Foil Edition", "dr-eggman", "dr-eggman"],
    ["2_Nier Deluxe Edition", "nier", "nier"],
    ["3_Nier Partial Foil Edition", "nier", "nier"],
  ];
  it("unlocks a pasted paid folder (the Ko-fi link) as its own deck, as v0.1.32 did, without reading its Restricted parent", async () => {
    expect(PAID.filter(([name]) => productEditionKind(name) === "deluxe")).toHaveLength(9);
    expect(PAID.filter(([name]) => productEditionKind(name) === "partial_foil")).toHaveLength(8);
    for (const [name, deckId, splashDeck] of PAID) {
      const world: World = {};
      const kind = productEditionKind(name)!;
      if (kind === "deluxe") deluxeDeck(world, "Kofi", name);
      else partialDeck(world, "Kofi", name);
      world.kofiParent01 = { name: "Deck", kind: "folder", children: [kind === "deluxe" ? "dlxKofi_fake" : "pfKofi_fake"], restricted: true };
      const pasted = kind === "deluxe" ? "dlxKofi_fake" : "pfKofi_fake";
      const { tree, api } = await unlock(world, pasted);
      const catalogue = catalogueFromTree(tree, preferDeckName(tree.name));
      expect([name, catalogue.id]).toEqual([name, deckId]);
      expect([name, catalogue.editions.map((edition) => edition.printType)]).toEqual([name, [kind === "deluxe" ? "standard" : "partial_foil"]]);
      expect(catalogue.editions[0]!.cards.map((card) => card.name)).toEqual(["Sol Ring"]);
      expect(api.listed).not.toContain("kofiParent01");
      expect(api.meta).not.toContain("kofiParent01");
      noParents(api.requests);
      // The splash: the deck's own (P5 → Persona 5, Spy x Family → SxF), never the BeeLine fallback.
      expect([name, canonicalDeckId(catalogue.id)]).toEqual([name, splashDeck]);
      expect(splashFor(canonicalDeckId(catalogue.id), SPLASH_ASSETS, SPLASH_FALLBACK)).toEqual(SPLASH_ASSETS[splashDeck]);
      expect(splashFor(canonicalDeckId(catalogue.id), SPLASH_ASSETS, SPLASH_FALLBACK)).not.toEqual(SPLASH_FALLBACK);
    }
  });

  it("follows a pasted shortcut to a paid folder and unlocks that edition", async () => {
    const world = beeLine();
    world.scutKofi0001 = { name: "My order", kind: "shortcut", target: "dlxSxf_fake" };
    const { tree, api } = await unlock(world, "scutKofi0001");
    const catalogue = catalogueFromTree(tree, preferDeckName(tree.name));
    expect(catalogue.id).toBe("spy-x-family");
    expect(JSON.stringify(tree)).toContain("dlxFileSxf_fake");
    expect(api.listed).not.toContain("parentSxf001");
    expect(api.listed).not.toContain("pfSxf_fake");
    noParents(api.requests);
  });
});

describe("deck aliases", () => {
  it("maps every alias to a shipped deck with a splash of its own, and leaves other names alone", () => {
    for (const [from, to] of Object.entries(DECK_ALIASES)) {
      const deck = shipped.find((item) => item.id === to.id);
      expect([from, deck?.name]).toEqual([from, to.name]);
      expect(SPLASH_ASSETS[to.id]).toBeDefined();
      expect(shipped.some((item) => item.id === from)).toBe(false);
    }
    expect(canonicalDeckId("p5")).toBe("persona-5");
    expect(canonicalDeckId("spy-x-family")).toBe("sxf");
    expect(canonicalDeckId("vader")).toBe("vader");
    expect(canonicalDeckId("toString")).toBe("toString");
    expect(canonicalDeckName("P5")).toBe("Persona 5");
    expect(canonicalDeckName("Spy x Family")).toBe("SxF");
    expect(canonicalDeckName("Spy X Family")).toBe("SxF");
    expect(canonicalDeckName("Vader")).toBe("Vader");
    expect(canonicalDeckName("constructor")).toBe("constructor");
  });

  it("gives every shipped deck's editions, free and paid, that deck's own splash", () => {
    const names: Record<string, string[]> = {
      "persona-5": ["1_P5 Standard Edition", "2_P5 Deluxe Edition", "3_P5 Partial Foil Edition", "10_Persona 5"],
      tmnt: ["TMNT", "1_TMNT"],
      "x-men": ["1_X-Men Standard Edition", "2_X-Men Deluxe Edition"],
      "horror-movie-poster-secret-lair": ["Horror Movie Poster Secret Lair", "3.1_Horror Movie Poster Secret Lair"],
      silksong: ["1_ Silksong Standard Edition", "2_Silksong Deluxe Edition", "3_Silksong Partial Foil Edition"],
      vader: ["1_Vader Standard Edition", "2_Vader Deluxe Edition", "3_Vader Partial Foil Edition"],
      kpdh: ["1_KPDH Standard Edition", "2_KPDH Deluxe Edition", "3_KPDH Partial Foil Edition"],
      sxf: ["1_Spy x Family Standard Edition", "2_Spy x Family Deluxe Edition", "3_Spy x Family Partial Foil Edition", "6_SxF"],
      "floating-world": ["1_Floating World Standard Edition", "2_Floating World Deluxe Edition", "3_Floating World Partial Foil Edition"],
      "dr-eggman": ["1_Dr. Eggman Standard Edition", "2_Dr. Eggman Deluxe Edition", "3_Dr. Eggman Partial Foil Edition"],
      nier: ["1_Nier Standard Edition", "2_Nier Deluxe Edition", "3_Nier Partial Foil Edition"],
    };
    expect(Object.keys(names).sort()).toEqual(shipped.map((deck) => deck.id).sort());
    for (const [deckId, folders] of Object.entries(names)) {
      for (const folder of folders) {
        const id = catalogueFromTree({ id: "x", name: folder, folder: true, children: [{ id: "f", name: "Full Deck", folder: true, children: [{ id: "s", name: "Sol Ring.png", folder: false }] }] }, preferDeckName(folder)).id;
        expect([folder, canonicalDeckId(id)]).toEqual([folder, deckId]);
        expect(splashFor(canonicalDeckId(id), SPLASH_ASSETS, SPLASH_FALLBACK)).toEqual(SPLASH_ASSETS[deckId]);
      }
    }
  });
});

/**
 * Places `parents` shows up outside the `'<id>' in parents` query: a fields= list, a FILE_FIELDS-style
 * constant, or any other string. Comments in source don't count.
 */
export function parentsFieldUses(text: string, source: boolean): string[] {
  const hits: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (source && (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*"))) return;
    for (const match of line.matchAll(/parents/g)) {
      const before = line.slice(Math.max(0, (match.index ?? 0) - 12), match.index);
      if (/'\s+in\s+$/.test(before)) continue;
      hits.push(`${index + 1}: ${line.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + 20).trim()}`);
    }
  });
  return hits;
}

describe("the Drive API is never asked for parents", () => {
  it("finds a parents field in every form it could take", () => {
    expect(parentsFieldUses("url.searchParams.set(\"q\", `'${folderId}' in parents and trashed = false`);", true)).toEqual([]);
    expect(parentsFieldUses("  * never `parents`, so a folder's Restricted deck parent", true)).toEqual([]);
    expect(parentsFieldUses('const FILE_FIELDS = "nextPageToken,files(id,name,mimeType,parents)";', true)).toHaveLength(1);
    expect(parentsFieldUses("?fields=id,name,mimeType,parents&key=", true)).toHaveLength(1);
    expect(parentsFieldUses('fields:"files(parents)"', false)).toHaveLength(1);
    expect(parentsFieldUses('e.searchParams.set("q",`\'${t}\' in parents and trashed = false`)', false)).toEqual([]);
  });

  it("has no parents field in src, scripts or dist", async () => {
    const { execSync } = await import("node:child_process");
    const { existsSync, readdirSync } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return /\.(ts|tsx|js|mjs|cjs|html)$/.test(entry.name) ? [full] : [];
      });
    const sources = [...walk(path.join(root, "src")), ...walk(path.join(root, "scripts"))].filter((file) => !/\.test\.tsx?$/.test(file))
      // The mutation script holds a parents field on purpose: it plants one to check this test fails.
      .filter((file) => path.relative(root, file) !== path.join("scripts", "mutate.ts"));
    const found: string[] = [];
    for (const file of sources) for (const hit of parentsFieldUses(readFileSync(file, "utf8"), true)) found.push(`${path.relative(root, file)}:${hit}`);
    // A build of its own, so another test rebuilding dist/ at the same time can't race it.
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const out = mkdtempSync(path.join(tmpdir(), "beeline-parents-"));
    let built: { file: string; text: string }[] = [];
    try {
      execSync(`npx vite build --outDir "${out}" --emptyOutDir`, { cwd: root, stdio: "pipe", timeout: 60_000 });
      expect(existsSync(path.join(out, "index.html"))).toBe(true);
      built = walk(out).map((file) => ({ file, text: readFileSync(file, "utf8") }));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    let queries = 0;
    for (const { file, text } of built) {
      queries += (text.match(/'\s+in\s+parents/g) ?? []).length;
      for (const hit of parentsFieldUses(text, false)) found.push(`dist/${path.basename(file)}:${hit}`);
    }
    expect(found).toEqual([]);
    // The scan saw the real bundle: the one folder-listing query is in it.
    expect(queries).toBeGreaterThan(0);
    expect(sources.some((file) => file.endsWith(path.join("lib", "drive.ts")))).toBe(true);
  }, 60_000);
});
