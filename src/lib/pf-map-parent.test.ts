import { describe, expect, it } from "vitest";
import { isBareExtrasOrTokens, parentFolderName, readDriveTree } from "@/lib/drive";
import { catalogueFromTree } from "@/lib/group";
import { preferDeckName } from "@/lib/names";
import { deckFromMapName, isMapUnlock, isPartialFoilMapName, MAP_LINK_GENERIC, mapLinkWarning, PartialFoilMapLinkError, purgeMapUnlocks } from "@/lib/pf-map";
import type { UnlockedPack } from "@/lib/storage";
import type { RawNode } from "@/lib/types";

// Every folder id here is made up. No real Drive id is in this file.
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const KEY = "made-up-test-key";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Item = { name: string; mimeType?: string; target?: string; children?: string[]; parent?: string };
type Fault = "403" | "429" | "500" | "throw" | "empty" | "two" | "garbage" | "name-403" | "name-throw" | "name-missing";

/**
 * A fake Drive that also answers the one parent request (fields=parents) the way Drive does, or fails it
 * as told. Records every request by kind and id; ids stay made up.
 */
function fakeDrive(items: Record<string, Item>, fault?: Fault) {
  const requests: string[] = [];
  const fetchImpl = async (input: string) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q");
    const listed = q ? /'([^']+)' in parents/.exec(q)?.[1] : undefined;
    if (listed) {
      requests.push(`list ${listed}`);
      return json({ files: (items[listed]?.children ?? []).map((id) => ({ id, name: items[id]!.name, mimeType: items[id]!.mimeType ?? FOLDER })) });
    }
    const id = decodeURIComponent(/\/files\/([^/]+)$/.exec(url.pathname)![1]!);
    const fields = url.searchParams.get("fields");
    if (fields === "parents") {
      requests.push(`up ${id}`);
      if (fault === "throw") throw new TypeError("Failed to fetch");
      if (fault === "403") return json({ error: { code: 403, message: "The user does not have sufficient permissions for this file." } }, 403);
      if (fault === "429") return json({ error: { code: 429, errors: [{ reason: "rateLimitExceeded" }] } }, 429);
      if (fault === "500") return json({ error: { code: 500 } }, 500);
      if (fault === "empty") return json({});
      if (fault === "two") return json({ parents: [items[id]!.parent, "fakeOther0001"] });
      if (fault === "garbage") return new Response("<html>not json</html>");
      return json(items[id]?.parent ? { parents: [items[id]!.parent] } : {});
    }
    if (fields === "name") {
      requests.push(`name ${id}`);
      if (fault === "name-throw") throw new TypeError("Failed to fetch");
      if (fault === "name-403") return json({ error: { code: 403 } }, 403);
      if (fault === "name-missing") return json({});
      return json({ name: items[id]!.name });
    }
    requests.push(`meta ${id}`);
    const item = items[id];
    if (!item) return json({ error: { message: "missing" } }, 404);
    return json({ id, name: item.name, mimeType: item.mimeType ?? FOLDER, ...(item.target ? { shortcutDetails: { targetId: item.target, targetMimeType: FOLDER } } : {}) });
  };
  return { fetchImpl, requests };
}

/** A map folder holding a bare Extras folder (one mask inside), as it sits in Drive. */
const underMap = (mapName: string, sub = "Extras"): Record<string, Item> => ({
  fakeMapFold01: { name: mapName, children: ["fakeSubFold01"] },
  fakeSubFold01: { name: sub, children: ["fakeMaskPng01"], parent: "fakeMapFold01" },
  fakeMaskPng01: { name: "Alela (Hornet).png", mimeType: "image/png" },
});

async function refusal(promise: Promise<unknown>): Promise<PartialFoilMapLinkError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof PartialFoilMapLinkError) return caught;
    throw caught;
  }
  throw new Error("the paste was accepted");
}

describe("a pasted bare Extras or Tokens folder inside a Partial Foil Map is refused by its parent's name (v0.1.39)", () => {
  it("knows a bare Extras or Tokens folder name, and nothing else", () => {
    for (const name of ["Extras", "extras", " EXTRA ", "Tokens", "Token", "tokens\u200b"]) expect(isBareExtrasOrTokens(name), name).toBe(true);
    for (const name of ["Full Deck + Tokens Folder", "Extras 2", "Tokens and Extras", "Partial Foil Map", "3_P5 Partial Foil Edition", ""]) expect(isBareExtrasOrTokens(name), name).toBe(false);
  });

  it("refuses a bare Extras folder whose parent is the Partial Foil Map, asking one folder up and nothing more", async () => {
    const drive = fakeDrive(underMap("Partial Foil Map"));
    const error = await refusal(readDriveTree("fakeSubFold01", KEY, drive.fetchImpl));
    expect(error.message).toBe(MAP_LINK_GENERIC);
    // Its own metadata, its one parent, that parent's name. Never the parent's parent; nothing listed.
    expect(drive.requests).toEqual(["meta fakeSubFold01", "up fakeSubFold01", "name fakeMapFold01"]);
  });

  it("refuses a bare Tokens folder under a fuzzy-named map, naming the deck the map's name carries", async () => {
    const tokens = await refusal(readDriveTree("fakeSubFold01", KEY, fakeDrive(underMap("P5 Partial Foil Map", "Tokens")).fetchImpl));
    expect(tokens.deck).toBe("P5");
    expect(tokens.message).toBe(mapLinkWarning("P5"));
    for (const map of ["PDF Partial Foil Map", "PDF - Partial Foil Map", "Partial_Foil_Map", "partial  foil  maps"]) {
      const drive = fakeDrive(underMap(map));
      expect((await refusal(readDriveTree("fakeSubFold01", KEY, drive.fetchImpl))).message, map).toBe(MAP_LINK_GENERIC);
      expect(drive.requests.filter((request) => request.startsWith("list"))).toEqual([]);
    }
  });

  it("follows a pasted shortcut named Tokens to its target and asks for the target's parent", async () => {
    const drive = fakeDrive({ ...underMap("Partial Foil Map", "Tokens"), fakeShortc001: { name: "Tokens", mimeType: SHORTCUT, target: "fakeSubFold01" } });
    await refusal(readDriveTree("fakeShortc001", KEY, drive.fetchImpl));
    expect(drive.requests).toEqual(["meta fakeShortc001", "meta fakeSubFold01", "up fakeSubFold01", "name fakeMapFold01"]);
  });

  for (const fault of ["403", "429", "500", "throw", "empty", "two", "garbage", "name-403", "name-throw", "name-missing"] as const) {
    it(`fails open when the parent lookup fails (${fault}): the link is accepted and read as before`, async () => {
      const drive = fakeDrive(underMap("Partial Foil Map"), fault);
      const tree = await readDriveTree("fakeSubFold01", KEY, drive.fetchImpl);
      expect(tree.name).toBe("Extras");
      expect(tree.children?.map((child) => child.name)).toEqual(["Alela (Hornet).png"]);
      expect(drive.requests).toContain("list fakeSubFold01");
      expect(drive.requests).not.toContain("list fakeMapFold01");
      expect(await parentFolderName("fakeSubFold01", KEY, drive.fetchImpl)).toBeNull();
    });
  }

  it("accepts a bare Extras folder whose parent is not a map folder", async () => {
    const drive = fakeDrive({
      fakeEdition01: { name: "2_P5 Deluxe Edition", children: ["fakeSubFold01"] },
      fakeSubFold01: { name: "Extras", children: ["fakeMaskPng01"], parent: "fakeEdition01" },
      fakeMaskPng01: { name: "Alela (Hornet).png", mimeType: "image/png" },
    });
    const tree = await readDriveTree("fakeSubFold01", KEY, drive.fetchImpl);
    expect(tree.children).toHaveLength(1);
    expect(drive.requests).toEqual(["meta fakeSubFold01", "up fakeSubFold01", "name fakeEdition01", "list fakeSubFold01"]);
  });

  it("never asks for a parent for any other pasted folder, nor for an Extras or Tokens folder inside the crawl", async () => {
    const drive = fakeDrive({
      fakeEdition01: { name: "3_P5 Partial Foil Edition", children: ["fakeMapFold01", "fakePdfMap001"] },
      fakeMapFold01: { name: "Partial Foil Map", children: ["fakeSubFold01", "fakeSubFold02"], parent: "fakeEdition01" },
      fakeSubFold01: { name: "Extras", children: [], parent: "fakeMapFold01" },
      fakeSubFold02: { name: "Tokens", children: [], parent: "fakeMapFold01" },
      fakePdfMap001: { name: "PDF Partial Foil Map", children: ["fakeFullDk001"], parent: "fakeEdition01" },
      fakeFullDk001: { name: "Full Deck + Tokens Folder", children: ["fakePdfFile01"], parent: "fakePdfMap001" },
      fakePdfFile01: { name: "Sol Ring.pdf", mimeType: "application/pdf" },
    });
    const tree = await readDriveTree("fakeEdition01", KEY, drive.fetchImpl);
    expect(tree.children?.map((child) => child.name).sort()).toEqual(["PDF Partial Foil Map", "Partial Foil Map"]);
    expect(drive.requests.filter((request) => request.startsWith("up") || request.startsWith("name"))).toEqual([]);
    for (const listed of ["fakeMapFold01", "fakeSubFold01", "fakeSubFold02", "fakePdfMap001", "fakeFullDk001"]) expect(drive.requests).toContain(`list ${listed}`);
  });
});

describe("map folder names are matched the way the crawl reads them (v0.1.39)", () => {
  const fuzzy = ["Partial Foil Map", "PDF Partial Foil Map", "Partial_Foil_Map", "Partial Foil Maps", "P5 Partial Foil Map", "PDF - Partial Foil Map", "Partial\u200bFoil Map", "PDF\u200b Partial Foil Map", "PARTIAL-FOIL-MAP", "  partial   foil   map  ", "Color Partial Foil Map", "Ｐａｒｔｉａｌ Ｆｏｉｌ Ｍａｐ", "ＰＤＦ Partial Foil Map"];

  it("counts fuzzy map names, mask or print, and never an edition or other folder", () => {
    for (const name of fuzzy) expect(isPartialFoilMapName(name), name).toBe(true);
    for (const name of ["3_P5 Partial Foil Edition", "Treasure Map Partial Foil Edition", "treasure map partial foil edition", "Treasure_Map_Partial_Foil_EDITION", "Partial Foil Edition", "Partial Foil", "PDF Print Map", "Map", "Extras", "Tokens", "Full Deck + Tokens Folder", "2_P5 Deluxe Edition", ""]) expect(isPartialFoilMapName(name), name).toBe(false);
  });

  it("takes the deck from a map's own name when it has one", () => {
    expect(deckFromMapName("P5 Partial Foil Map")).toBe("P5");
    expect(deckFromMapName("Silksong PDF Partial Foil Map")).toBe("Silksong");
    expect(deckFromMapName("\u200bP5\u200b Partial Foil Map")).toBe("P5");
    for (const name of ["Partial Foil Map", "PDF Partial Foil Map", "PDF - Partial Foil Map", "Partial_Foil_Map", "Partial\u200bFoil Map", "PDF\u200b Partial Foil Map"]) expect(deckFromMapName(name), name).toBeNull();
  });

  it("refuses a pasted fuzzy-named map folder before listing it", async () => {
    for (const name of fuzzy) {
      const drive = fakeDrive({ fakeMapFold01: { name, children: [] } });
      const error = await refusal(readDriveTree("fakeMapFold01", KEY, drive.fetchImpl));
      expect(error.message, name).toBe(mapLinkWarning(deckFromMapName(name)));
      expect(drive.requests, name).toEqual(["meta fakeMapFold01"]);
    }
  });

  it("purges unlocks an older BeeLine stored from a pasted fuzzy-named map folder, and keeps real editions", () => {
    // A pasted map folder as v0.1.38 built and stored it: named after the folder (preferDeckName), notes at its root.
    const tree = (name: string, pdf: boolean): RawNode => ({
      id: "fakeMapFold01",
      name,
      folder: true,
      maskScan: true,
      children: pdf
        ? [{ id: "fakeFullDk001", name: "Full Deck + Tokens Folder", folder: true, children: [{ id: "fakePdfFile01", name: "Sol Ring.pdf", folder: false }] }]
        : [{ id: "fakeMaskPng01", name: "Sol Ring.png", folder: false }, { id: "fakeNotes001", name: "Notes.txt", folder: false }],
    });
    const pack = (catalogue: UnlockedPack["catalogue"]): UnlockedPack => ({ packHash: "000000000000", savedAt: "2026-11-18T00:00:00.000Z", catalogue });
    // (A full-width name made no unlock at all in v0.1.38: "No printable cards found".)
    for (const name of fuzzy.filter((item) => item !== "Color Partial Foil Map" && !item.startsWith("Ｐ"))) {
      const stored = pack(catalogueFromTree(tree(name, false), preferDeckName(name)));
      expect(isMapUnlock(stored), `${name} as ${JSON.stringify(stored.catalogue.name)}`).toBe(true);
    }
    const real = pack(catalogueFromTree({ id: "fakeEdition01", name: "3_P5 Partial Foil Edition", folder: true, maskScan: true, children: [tree("PDF Partial Foil Map", true), { id: "fakeReadme01", name: "Readme.txt", folder: false }] }, "P5"));
    expect(real.catalogue.editions.some((edition) => edition.cards.length > 0)).toBe(true);
    expect(isMapUnlock(real)).toBe(false);
    expect(purgeMapUnlocks([real, pack(catalogueFromTree(tree("P5 Partial Foil Map", false), "P5"))])).toEqual({ packs: [real], dropped: 1 });
    // A pasted print map with cards, stored under what preferDeckName left of its name ("-", a zero-width name).
    for (const name of ["PDF - Partial Foil Map", "PDF\u200b Partial Foil Map"]) {
      const stored = pack(catalogueFromTree(tree(name, true), preferDeckName(name)));
      expect(stored.catalogue.editions.some((edition) => edition.cards.length > 0), name).toBe(true);
      expect(/[\p{L}\p{N}]/u.test(stored.catalogue.name), name).toBe(false);
      expect(isMapUnlock(stored), name).toBe(true);
      // Stripped of any root note, it is still told by its empty Partial Foil deck name.
      expect(isMapUnlock(pack({ ...stored.catalogue, editions: stored.catalogue.editions.map((edition) => ({ ...edition, notes: [] })) })), name).toBe(true);
    }
    // A map name with no notes at all is still dropped by its name.
    expect(isMapUnlock(pack({ ...real.catalogue, name: "Partial_Foil_Map", editions: real.catalogue.editions.map((edition) => ({ ...edition, notes: [] })) }))).toBe(true);
    // An empty deck name drops only a Partial Foil unlock, never another kind.
    expect(isMapUnlock(pack({ ...real.catalogue, name: "-", editions: real.catalogue.editions.map((edition) => ({ ...edition, printType: "standard" as const })) }))).toBe(false);
  });
});
