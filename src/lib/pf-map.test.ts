import { describe, expect, it } from "vitest";
import { readDriveTree } from "@/lib/drive";
import { deckFromEditionFolder, isPartialFoilMapName, MAP_LINK_GENERIC, mapFolderInChain, mapLinkWarning, PartialFoilMapLinkError, purgeMapUnlocks } from "@/lib/pf-map";
import { makeRestoreCode, mergeRestored, readRestoreCode, RESTORE_ERRORS, restoredMessage } from "@/lib/restore-code";
import { packHash, type UnlockedPack } from "@/lib/storage";
import type { DeckCatalogue, Edition } from "@/lib/types";

// Folder ids are made up here. No real Drive id is in this file.
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type FakeItem = { name: string; mimeType?: string; target?: string; children?: string[]; text?: string };
/** A mocked Drive: metadata by id, listings by "'<id>' in parents", and New Drive Link text. Records every listing asked for. */
function fakeDrive(items: Record<string, FakeItem>) {
  const listed: string[] = [];
  const fetchImpl = async (input: string) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    if (url.includes("alt=media")) {
      const id = /\/files\/([^?/]+)/.exec(url)![1]!;
      return new Response(items[id]?.text ?? "");
    }
    const parent = /'([^']+)' in parents/.exec(url)?.[1];
    if (parent) {
      listed.push(parent);
      const files = (items[parent]?.children ?? []).map((id) => ({
        id,
        name: items[id]!.name,
        mimeType: items[id]!.mimeType ?? FOLDER,
        ...(items[id]!.target ? { shortcutDetails: { targetId: items[id]!.target, targetMimeType: FOLDER } } : {}),
      }));
      return json({ files });
    }
    const id = /\/files\/([^?/]+)/.exec(url)?.[1];
    const item = id ? items[id] : undefined;
    if (!item) return json({ error: { message: "missing" } }, 404);
    return json({ id, name: item.name, mimeType: item.mimeType ?? FOLDER, ...(item.target ? { shortcutDetails: { targetId: item.target, targetMimeType: FOLDER } } : {}) });
  };
  return { fetchImpl, listed };
}
const KEY = "test-api-key-value";

async function refusal(promise: Promise<unknown>): Promise<PartialFoilMapLinkError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof PartialFoilMapLinkError) return caught;
    throw caught;
  }
  throw new Error("the paste was accepted");
}

describe("Partial Foil Map folder names (v0.1.38)", () => {
  it("knows both map folders, whatever the case and spacing", () => {
    for (const name of ["Partial Foil Map", "PDF Partial Foil Map", "partial foil map", "PARTIAL FOIL MAP", "pdf partial foil map", "  Partial   Foil  Map ", "PDF\tPartial Foil\u00a0Map", "PartialFoilMap", "pdfPARTIALfoilMAP", "Ｐａｒｔｉａｌ Foil Map"]) {
      expect(isPartialFoilMapName(name), name).toBe(true);
    }
  });

  it("leaves every other folder alone, edition roots and print folders included", () => {
    for (const name of ["3_KPDH Partial Foil Edition", "Partial Foil Edition", "Partial Foil", "Color Partial Foil Map", "Partial Foil Maps", "Partial Foil Map 2", "Partial-Foil-Map", "PDF Print Map", "Partial Foil Templates", "Extras", "Tokens", "Deluxe Edition", ""]) {
      expect(isPartialFoilMapName(name), name).toBe(false);
    }
  });

  it("names the deck from a Partial Foil edition folder only", () => {
    expect(deckFromEditionFolder("3_P5 Partial Foil Edition")).toBe("P5");
    expect(deckFromEditionFolder("Silksong Partial Foil Edition")).toBe("Silksong");
    expect(deckFromEditionFolder("Partial Foil Edition")).toBeNull();
    expect(deckFromEditionFolder("PDF Partial Foil Map")).toBeNull();
    expect(deckFromEditionFolder("2_P5 Deluxe Edition")).toBeNull();
    expect(deckFromEditionFolder("Extras")).toBeNull();
    expect(deckFromEditionFolder(null)).toBeNull();
  });

  it("words the warning with the deck when it is known, and generically when not", () => {
    expect(mapLinkWarning("P5")).toBe("That's the Partial Foil Map folder. Paste the link for the folder labeled P5 Partial Foil Edition instead.");
    expect(mapLinkWarning(null)).toBe(MAP_LINK_GENERIC);
    expect(MAP_LINK_GENERIC).toBe("That's the Partial Foil Map folder. Paste the link for the deck's folder labeled Partial Foil Edition instead.");
    expect(mapLinkWarning("")).toBe(MAP_LINK_GENERIC);
  });

  it("finds a map folder anywhere in the chain a paste went through, and the deck before it", () => {
    expect(mapFolderInChain(["3_P5 Partial Foil Edition"])).toBeNull();
    expect(mapFolderInChain(["Partial Foil Map"])).toEqual({ deck: null });
    expect(mapFolderInChain(["Partial Foil Map", "Extras"])).toEqual({ deck: null });
    expect(mapFolderInChain(["3_P5 Partial Foil Edition", "PDF Partial Foil Map", "Tokens"])).toEqual({ deck: "P5" });
    expect(mapFolderInChain(["Old pack", "Partial Foil Map"])).toEqual({ deck: null });
    // The nearest edition before the map wins.
    expect(mapFolderInChain(["Silksong Partial Foil Edition", "3_P5 Partial Foil Edition", "Partial Foil Map"])).toEqual({ deck: "P5" });
  });
});

describe("a pasted Partial Foil Map link is refused before it is opened (v0.1.38)", () => {
  it("refuses the Partial Foil Map folder and lists nothing", async () => {
    const drive = fakeDrive({ mapAAAAAAAA01: { name: "Partial Foil Map", children: ["maskAAAAAAA01"] }, maskAAAAAAA01: { name: "Sol Ring.png", mimeType: "image/png" } });
    const error = await refusal(readDriveTree("mapAAAAAAAA01", KEY, drive.fetchImpl));
    expect(error.message).toBe(MAP_LINK_GENERIC);
    expect(error.deck).toBeNull();
    expect(drive.listed).toEqual([]);
  });

  it("refuses the PDF Partial Foil Map folder, and both in any case or spacing", async () => {
    for (const name of ["PDF Partial Foil Map", "pdf  PARTIAL foil map ", " partial foil MAP"]) {
      const drive = fakeDrive({ mapBBBBBBBB01: { name, children: ["pdfBBBBBBBB01"] }, pdfBBBBBBBB01: { name: "Sol Ring.pdf", mimeType: "application/pdf" } });
      const error = await refusal(readDriveTree("mapBBBBBBBB01", KEY, drive.fetchImpl));
      expect(error.message, name).toBe(MAP_LINK_GENERIC);
      expect(drive.listed, name).toEqual([]);
    }
  });

  it("refuses the map's Extras folder reached through a shortcut named for the map", async () => {
    const drive = fakeDrive({ shortCCCCCC01: { name: "Partial Foil Map", mimeType: SHORTCUT, target: "extrasCCCCC01" }, extrasCCCCC01: { name: "Extras", children: [] } });
    const error = await refusal(readDriveTree("shortCCCCCC01", KEY, drive.fetchImpl));
    expect(error.message).toBe(MAP_LINK_GENERIC);
    expect(drive.listed).toEqual([]);
  });

  it("refuses the map's Tokens folder reached from an edition's New Drive Link, naming the deck from that edition", async () => {
    const drive = fakeDrive({
      editionDDDD01: { name: "3_P5 Partial Foil Edition", children: ["linkDDDDDDD01"] },
      linkDDDDDDD01: { name: "New Drive Link.txt", mimeType: "text/plain", text: "https://drive.google.com/drive/folders/shortDDDDDD01" },
      shortDDDDDD01: { name: "PDF Partial Foil Map", mimeType: SHORTCUT, target: "tokensDDDDD01" },
      tokensDDDDD01: { name: "Tokens", children: [] },
    });
    const error = await refusal(readDriveTree("editionDDDD01", KEY, drive.fetchImpl));
    expect(error.deck).toBe("P5");
    expect(error.message).toBe("That's the Partial Foil Map folder. Paste the link for the folder labeled P5 Partial Foil Edition instead.");
    // Only the edition folder was listed (to find its link); the map's folder never was.
    expect(drive.listed).toEqual(["editionDDDD01"]);
  });

  it("falls back to the generic wording when no edition name is known", async () => {
    const drive = fakeDrive({
      oldEEEEEEEE01: { name: "Old pack", children: ["linkEEEEEEE01"] },
      linkEEEEEEE01: { name: "New Drive Link.txt", mimeType: "text/plain", text: "https://drive.google.com/drive/folders/mapEEEEEEEE01" },
      mapEEEEEEEE01: { name: "Partial Foil Map", children: [] },
    });
    const error = await refusal(readDriveTree("oldEEEEEEEE01", KEY, drive.fetchImpl));
    expect(error.deck).toBeNull();
    expect(error.message).toBe(MAP_LINK_GENERIC);
  });

  it("still accepts a real Partial Foil edition root, with both map folders inside it", async () => {
    const drive = fakeDrive({
      rootFFFFFFF01: { name: "3_KPDH Partial Foil Edition", children: ["maskFFFFFFF01", "pdfFFFFFFFF01"] },
      maskFFFFFFF01: { name: "Partial Foil Map", children: ["maskFileFFF01"] },
      maskFileFFF01: { name: "Sol Ring.png", mimeType: "image/png" },
      pdfFFFFFFFF01: { name: "PDF Partial Foil Map", children: ["fullFFFFFFF01"] },
      fullFFFFFFF01: { name: "Full Deck", children: ["solFFFFFFFF01"] },
      solFFFFFFFF01: { name: "Sol Ring.pdf", mimeType: "application/pdf" },
    });
    const tree = await readDriveTree("rootFFFFFFF01", KEY, drive.fetchImpl);
    expect(tree.name).toBe("3_KPDH Partial Foil Edition");
    expect(tree.maskScan).toBe(true);
    expect(drive.listed).toEqual(expect.arrayContaining(["rootFFFFFFF01", "maskFFFFFFF01", "pdfFFFFFFFF01", "fullFFFFFFF01"]));
  });
});

const edition = (name: string, cards = 1): Edition => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  printType: "partial_foil",
  backs: [],
  notes: [],
  cards: Array.from({ length: cards }, (_, n) => ({ id: `c${n}`, name: `Card ${n}`, role: "main" as const, defaultQty: 1, faces: [{ id: `c${n}:f`, name: `Card ${n}`, defaultArt: { id: `art-${name}-${n}`, name: `Card ${n}.pdf`, thumbId: `art-${name}-${n}`, label: "" }, alternates: [] }] })),
});
const pack = (n: number, deck: string, editions: Edition[]): UnlockedPack => ({
  packHash: packHash(["made", "up", String(n)].join("-")),
  savedAt: `2026-11-0${n}T00:00:00.000Z`,
  catalogue: { id: deck.toLowerCase().replace(/\W+/g, "-"), name: deck, creator: "Beespair", editions } as DeckCatalogue,
});
const pdfMap = pack(1, "PDF Partial Foil Map", [edition("Partial Foil", 100)]);
const maskMap = pack(2, "Partial Foil Map", [edition("Partial Foil", 0)]);
const real = pack(3, "KPDH", [edition("Partial Foil", 3)]);
const spaced = pack(4, "  pdf partial   FOIL map", [edition("Partial Foil", 2)]);

describe("saved Partial Foil Map unlocks are dropped (v0.1.38)", () => {
  it("drops unlocks named for a map folder, in any case or spacing, and keeps real ones in order", () => {
    const silksong = pack(5, "Silksong", [edition("Partial Foil", 2)]);
    const out = purgeMapUnlocks([pdfMap, real, maskMap, spaced, silksong]);
    expect(out.dropped).toBe(3);
    expect(out.packs).toEqual([real, silksong]);
    expect(purgeMapUnlocks([real])).toEqual({ packs: [real], dropped: 0 });
    expect(purgeMapUnlocks([])).toEqual({ packs: [], dropped: 0 });
  });

  it("never carries a map unlock in a restore code", async () => {
    const code = await makeRestoreCode([pdfMap, real, maskMap]);
    const back = await readRestoreCode(code);
    expect(back.map((item) => item.catalogue.name)).toEqual(["KPDH"]);
    await expect(makeRestoreCode([pdfMap, maskMap])).rejects.toThrow(RESTORE_ERRORS.nothing);
  });

  it("leaves map unlocks in an older code out of a restore, and says so", () => {
    const out = mergeRestored([], [pdfMap, real, maskMap]);
    expect(out.packs.map((item) => item.catalogue.name)).toEqual(["KPDH"]);
    expect(out.maps).toBe(2);
    expect(out.added).toBe(1);
    expect(restoredMessage(out.added, out.refreshed, out.kept, out.empty, out.maps)).toBe("Restored 1 unlocked folder on this device. 2 Partial Foil Map folders in the code were left out.");
    const only = mergeRestored([real], [maskMap]);
    expect(only.packs).toEqual([real]);
    expect(only.maps).toBe(1);
    expect(restoredMessage(only.added, only.refreshed, only.kept, only.empty, only.maps)).toBe(MAP_LINK_GENERIC);
    expect(restoredMessage(1, 0, 0, 0, 1)).toBe("Restored 1 unlocked folder on this device. 1 Partial Foil Map folder in the code was left out.");
    expect(restoredMessage(1, 0)).toBe("Restored 1 unlocked folder on this device.");
  });
});
