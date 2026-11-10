import { describe, expect, it } from "vitest";
import { artIdsOf, catalogueFromTree } from "@/lib/group";
import { designedSelection, droppedSavedCardIds, selectionToSlots } from "@/lib/selection";
import { fnvPackHash, forgetUnlocked, importSavedJson, LEGACY_BACKUP_KEY, loadSaved, loadUnlocked, mergeCatalogues, mergeSaved, migrateSavedDecks, packHash, resolveLegacyDeluxe, resolveSavedDeck, restoreLegacyBackup, upsertUnlocked, writeSaved, writeUnlocked, UNLOCK_KEY, type SavedDeck, type UnlockedPack } from "@/lib/storage";
import { buildXml } from "@/lib/xml";
import type { Edition, RawNode } from "@/lib/types";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const deck = {
  id: "deck-1",
  name: "Silksong · Standard",
  deckId: "silksong",
  deckName: "Silksong",
  editionId: "standard",
  editionName: "Standard",
  printType: "standard" as const,
  treatment: null,
  cardbackId: "backimage1234",
  updatedAt: "2026-11-09T00:00:00.000Z",
  cards: [
    { cardId: "sol", qty: 1.8, locked: false, arts: { front: "solringfile1" } },
    { cardId: "empty", qty: 4, locked: false, arts: {} },
    { cardId: "huge", qty: 150, locked: true, arts: { front: "islandfile01" } },
  ],
};

describe("saved decks", () => {
  it("drops cards with no art, clamps quantity, and fills a missing timestamp", () => {
    const store = memoryStore();
    store.setItem("printabee.savedDecks.v1", JSON.stringify([{ ...deck, updatedAt: undefined }]));
    const loaded = loadSaved(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(loaded[0]!.cards.map((card) => card.cardId)).toEqual(["sol", "huge"]);
    expect(loaded[0]!.cards[0]!.pairs[0]!.qty).toBe(1);
    expect(loaded[0]!.cards[1]!.pairs[0]!.qty).toBe(99);
    const merged = mergeSaved([], [{ ...loaded[0]!, updatedAt: "" }]);
    expect(merged[0]!.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(() => mergeSaved(merged, [{ ...merged[0]!, updatedAt: undefined as unknown as string }])).not.toThrow();
  });

  it("explains a full storage quota instead of throwing the browser error", () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    expect(() => writeSaved(store, [deck as unknown as unknown as SavedDeck])).toThrow(/storage may be full/);
    expect(importSavedJson(JSON.stringify({ decks: [deck] }))[0]!.cards).toHaveLength(2);
  });

  it("drops an unlocked edition that has no card list instead of crashing the home page", () => {
    const store = memoryStore();
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([
        {
          folderId: "folder123456",
          sourceUrl: "https://drive.google.com/drive/folders/folder123456",
          savedAt: "2026-11-09T00:00:00.000Z",
          catalogue: {
            id: "silksong",
            name: "Silksong",
            creator: "Beespair",
            editions: [{ id: "partial-foil", name: "Partial Foil", printType: "partial_foil" }],
          },
        },
      ]),
    );
    expect(loadUnlocked(store)).toEqual([]);
  });

  it("drops a card whose face has no alternates list", () => {
    const store = memoryStore();
    store.setItem(
      "printabee.savedDecks.v1",
      JSON.stringify([
        {
          ...deck,
          cards: [
            {
              id: "broken",
              name: "Broken",
              role: "main",
              defaultQty: 1,
              faces: [{ id: "face", name: "Broken", defaultArt: null, alternates: null }],
            },
          ],
        },
      ]),
    );
    const saved = loadSaved(store);
    expect(saved[0]!.cards).toEqual([]);
  });

  it("keeps both Deluxe editions when a pasted Deluxe pack shares an id with a nested one", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const partial = catalogueFromTree(
      folder("partialpack01", "3_Silksong Partial Foil Edition", [
        folder("pdfmap0000001", "PDF Partial-Foil Map", [folder("pdffull000001", "Full Deck", [file("partialpdf000000000000000001", "Sol Ring.pdf")])]),
        folder("nesteddeluxe1", "Deluxe Edition", [folder("nestedfull001", "Full Deck", [file("nestedjpg000000000000000001", "Island.jpg")])]),
      ]),
    );
    const own = catalogueFromTree(
      folder("owndeluxe0001", "Deluxe Edition", [folder("ownfull000001", "Full Deck", [file("ownjpg00000000000000000001", "Swamp.jpg")])]),
      partial.name,
    );
    expect(partial.editions.some((edition) => edition.id === "deluxe-edition")).toBe(true);
    expect(own.editions.some((edition) => edition.id === "deluxe-edition")).toBe(true);
    const merged = mergeCatalogues([], [partial, own]);
    expect(merged).toHaveLength(1);
    const editions = merged[0]!.editions.filter((edition) => edition.printType === "standard");
    expect(new Set(editions.map((edition) => edition.id)).size).toBe(editions.length);
    expect(editions.length).toBeGreaterThan(1);
    const names = editions.map((edition) => edition.name).join("\n");
    expect(names).toContain("Deluxe Edition");
    const ids = editions.flatMap((edition) => edition.cards.flatMap((card) => card.faces.flatMap((face) => (face.defaultArt ? [face.defaultArt.id] : []))));
    expect(ids).toContain("nestedjpg000000000000000001");
    expect(ids).toContain("ownjpg00000000000000000001");
  });

  it("maps a legacy deluxe id when one Deluxe edition is loaded, and keeps the deck otherwise", () => {
    const legacy = { ...deck, editionId: "deluxe", editionName: "Deluxe", printType: "standard" as const } as unknown as SavedDeck;
    const catalogue = {
      id: "silksong",
      name: "Silksong",
      creator: "Beespair" as const,
      editions: [
        {
          id: "deluxe-edition",
          name: "Deluxe · Deluxe Edition",
          printType: "standard" as const,
          cards: [],
          backs: [],
          notes: [],
        },
      ],
    };
    const mapped = resolveLegacyDeluxe(legacy, [catalogue]);
    expect(mapped.note).toBeNull();
    expect(mapped.deck.editionId).toBe("deluxe-edition");
    expect(mapped.deck.editionName).toContain("Deluxe");
    expect(mapped.deck.id).toBe(legacy.id);

    const two = resolveLegacyDeluxe(legacy, [
      catalogue,
      {
        ...catalogue,
        editions: [
          ...catalogue.editions,
          { ...catalogue.editions[0]!, id: "deluxe-edition-2", name: "Deluxe · Deluxe Edition 2" },
        ],
      },
    ]);
    expect(two.deck).toBe(legacy);
    expect(two.note).toMatch(/Pick the Deluxe edition/);
    expect(() => resolveLegacyDeluxe(legacy, [])).not.toThrow();
    expect(resolveLegacyDeluxe(legacy, []).deck.editionId).toBe("deluxe");
    expect(loadSaved({ getItem: () => JSON.stringify([legacy]), setItem: () => undefined, removeItem: () => undefined })).toHaveLength(1);
  });

  it("does not map a legacy deluxe deck onto another game, and writes nothing", () => {
    const legacy = { ...deck, editionId: "deluxe", editionName: "Deluxe", printType: "standard" as const } as unknown as SavedDeck;
    const silksong = {
      id: "silksong",
      name: "Silksong",
      creator: "Beespair" as const,
      editions: [{ id: "standard", name: "Standard", printType: "standard" as const, cards: [], backs: [], notes: [] }],
    };
    const other = {
      id: "other-game",
      name: "Other Game",
      creator: "Beespair" as const,
      editions: [{ id: "deluxe-edition", name: "Deluxe · Deluxe Edition", printType: "standard" as const, cards: [], backs: [], notes: [] }],
    };
    const resolved = resolveLegacyDeluxe(legacy, [silksong, other]);
    expect(resolved.note).toMatch(/Pick the Deluxe edition/);
    expect(resolved.deck.editionId).toBe("deluxe");
    expect(resolved.deck.deckId).toBe("silksong");
    expect(migrateSavedDecks([legacy], [], [silksong, other])).toBeNull();
  });

  it("keeps a saved deck on the pack it was built from after a later unlock and a re-paste", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const deluxePack = (folderId: string, fileId: string, savedAt: string): UnlockedPack => ({
      packHash: packHash(folderId),
      folderId,
      savedAt,
      catalogue: catalogueFromTree(folder(folderId, "Deluxe Edition", [folder(`${folderId}-full`, "Full Deck", [file(fileId, "Sol Ring.jpg")])]), "Silksong"),
    });
    const partialPack = (folderId: string, fileId: string, savedAt: string): UnlockedPack => ({
      packHash: packHash(folderId),
      folderId,
      savedAt,
      catalogue: catalogueFromTree(
        folder(folderId, "Partial Foil Edition", [folder(`${folderId}-pdf`, "PDF", [file(fileId, "Sol Ring.pdf")])]),
        "Silksong",
      ),
    });
    const pin = (pack: UnlockedPack, artId: string, staleName: string): SavedDeck => {
      const edition = pack.catalogue.editions.find((item) => artIdsOf(item).has(artId))!;
      const card = edition.cards[0]!;
      return {
        id: `saved-${pack.packHash}`,
        name: "Saved",
        deckId: pack.catalogue.id,
        deckName: pack.catalogue.name,
        editionId: edition.id,
        editionName: staleName,
        packHash: pack.packHash,
        printType: edition.printType,
        treatment: null,
        cardbackId: null,
        cards: [{ cardId: card.id, locked: false, pairs: [{ art: artId, qty: 1 }] }],
        updatedAt: "2026-11-09T00:00:00.000Z",
      };
    };
    const unlockSequence = (first: UnlockedPack, second: UnlockedPack) => {
      let packs = upsertUnlocked([], first);
      packs = upsertUnlocked(packs, second);
      packs = upsertUnlocked(packs, { ...first, savedAt: "2026-11-09T09:00:00.000Z" });
      return packs;
    };

    const deluxeA = deluxePack("deluxe-pack-a", "deluxeFileA", "2026-11-09T00:00:00.000Z");
    const deluxeB = deluxePack("deluxe-pack-b", "deluxeFileB", "2026-11-09T01:00:00.000Z");
    const deluxePacks = unlockSequence(deluxeA, deluxeB);
    expect(deluxePacks.map((item) => item.folderId)).toEqual(["deluxe-pack-a", "deluxe-pack-b"]);
    expect(deluxePacks[0]!.savedAt).toBe(deluxeA.savedAt);
    const replaced = upsertUnlocked(deluxePacks, deluxePack("deluxe-pack-a", "deluxeFileA2", "2026-11-09T10:00:00.000Z"));
    expect(replaced.map((item) => item.folderId)).toEqual(["deluxe-pack-a", "deluxe-pack-b"]);
    expect(replaced[0]!.savedAt).toBe(deluxeA.savedAt);
    expect(artIdsOf(replaced[0]!.catalogue.editions[0]!).has("deluxeFileA2")).toBe(true);
    expect(artIdsOf(replaced[0]!.catalogue.editions[0]!).has("deluxeFileA")).toBe(false);
    const deluxeMerged = mergeCatalogues([], [deluxeB, deluxeA]);
    const deluxeSaved = pin(deluxeA, "deluxeFileA", "Deluxe");
    const deluxeResolved = resolveSavedDeck(deluxeSaved, deluxePacks, deluxeMerged);
    expect(deluxeResolved.note).toBeNull();
    expect(artIdsOf(deluxeResolved.edition!).has("deluxeFileA")).toBe(true);
    expect(artIdsOf(deluxeResolved.edition!).has("deluxeFileB")).toBe(false);
    expect(deluxeResolved.deck.cards).toEqual(deluxeSaved.cards);
    expect(deluxeResolved.deck.editionName).toBe(deluxeResolved.edition!.name);
    expect(deluxeResolved.deck.editionName).not.toBe("Deluxe");
    expect(deluxeMerged[0]!.editions.find((edition) => edition.packHash === packHash("deluxe-pack-a"))!.id).toBe("deluxe-edition");
    expect(migrateSavedDecks([deluxeSaved], [], deluxeMerged)).toBeNull();

    const partialA = partialPack("partial-pack-a", "partialFileA", "2026-11-09T00:00:00.000Z");
    const partialB = partialPack("partial-pack-b", "partialFileB", "2026-11-09T01:00:00.000Z");
    const partialPacks = unlockSequence(partialA, partialB);
    const partialMerged = mergeCatalogues([], [partialB, partialA]);
    const partialSaved = pin(partialA, "partialFileA", "Partial Foil");
    const partialResolved = resolveSavedDeck(partialSaved, partialPacks, partialMerged);
    expect(partialResolved.note).toBeNull();
    expect(artIdsOf(partialResolved.edition!).has("partialFileA")).toBe(true);
    expect(artIdsOf(partialResolved.edition!).has("partialFileB")).toBe(false);
    expect(partialResolved.deck.cards).toEqual(partialSaved.cards);
    expect(partialResolved.edition!.printType).toBe("partial_foil");
    expect(partialMerged[0]!.editions.find((edition) => edition.packHash === packHash("partial-pack-a"))!.id).toBe("partial-foil");
    const refreshed = migrateSavedDecks([partialSaved], partialPacks, partialMerged);
    expect(refreshed?.[0]!.editionName).toBe(partialResolved.edition!.name);
    expect(refreshed?.[0]!.cards).toEqual(partialSaved.cards);
  });

  it("keeps a v0.1.2 deluxe deck on pack A after pack B is unlocked and A is pasted again", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const make = (folderId: string, fileId: string, savedAt: string): UnlockedPack => ({
      packHash: packHash(folderId),
      folderId,
      savedAt,
      catalogue: catalogueFromTree(folder(folderId, "Deluxe", [folder(`${folderId}-full`, "Full Deck", [file(fileId, "Sol Ring.jpg")])]), "Silksong"),
    });
    const packA = make("legacy-pack-a", "legacyFileA", "2026-11-09T00:00:00.000Z");
    const packB = make("legacy-pack-b", "legacyFileB", "2026-11-09T01:00:00.000Z");
    const edition = packA.catalogue.editions[0]!;
    const card = edition.cards[0]!;
    let saved: SavedDeck = {
      id: "v012",
      name: "Old deluxe",
      deckId: packA.catalogue.id,
      deckName: packA.catalogue.name,
      editionId: "deluxe",
      editionName: "Deluxe",
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: [{ cardId: card.id, locked: false, pairs: [{ art: "legacyFileA", qty: 1 }] }],
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    let packs = upsertUnlocked([], packA);
    let merged = mergeCatalogues([], packs);
    const pinned = migrateSavedDecks([saved], packs, merged);
    expect(pinned?.[0]!.packHash).toBe(packHash("legacy-pack-a"));
    expect(pinned?.[0]!.cards).toEqual(saved.cards);
    saved = pinned![0]!;
    packs = upsertUnlocked(packs, packB);
    packs = upsertUnlocked(packs, { ...packA, savedAt: "2026-11-09T09:00:00.000Z" });
    merged = mergeCatalogues([], packs);
    const resolved = resolveSavedDeck(saved, packs, merged);
    expect(resolved.note).toBeNull();
    expect(artIdsOf(resolved.edition!).has("legacyFileA")).toBe(true);
    expect(artIdsOf(resolved.edition!).has("legacyFileB")).toBe(false);
    expect(resolved.deck.cards).toEqual(saved.cards);
    expect(resolved.deck.editionId).toBe(resolved.edition!.sourceId ?? resolved.edition!.id);
  });

  it("opens Deluxe Edition 2 by its own id when another pack renumbers the merged ids", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const packA: UnlockedPack = {
      packHash: packHash("two-deluxe-a"),
      folderId: "two-deluxe-a",
      savedAt: "2026-11-09T02:00:00.000Z",
      catalogue: catalogueFromTree(
        folder("two-deluxe-a", "Silksong", [
          folder("plain-deluxe", "Deluxe Edition", [folder("full-plain", "Full Deck", [file("plainFileA", "Island.jpg")])]),
          folder("second-deluxe", "Deluxe Edition 2", [folder("full-second", "Full Deck", [file("secondFileA", "Swamp.jpg")])]),
        ]),
      ),
    };
    const packB: UnlockedPack = {
      packHash: packHash("two-deluxe-b"),
      folderId: "two-deluxe-b",
      savedAt: "2026-11-09T00:00:00.000Z",
      catalogue: catalogueFromTree(folder("two-deluxe-b", "Deluxe Edition", [folder("full-b", "Full Deck", [file("otherFileB", "Plains.jpg")])]), "Silksong"),
    };
    const merged = mergeCatalogues([], [packB, packA]);
    const second = packA.catalogue.editions.find((edition) => artIdsOf(edition).has("secondFileA"))!;
    const saved: SavedDeck = {
      id: "saved-second",
      name: "Second deluxe",
      deckId: packA.catalogue.id,
      deckName: packA.catalogue.name,
      editionId: second.id,
      editionName: second.name,
      packHash: packA.packHash,
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: [{ cardId: second.cards[0]!.id, locked: false, pairs: [{ art: "secondFileA", qty: 1 }] }],
      updatedAt: "2026-11-09T03:00:00.000Z",
    };
    const resolved = resolveSavedDeck(saved, [packA, packB], merged);
    expect(resolved.note).toBeNull();
    expect(artIdsOf(resolved.edition!).has("secondFileA")).toBe(true);
    expect(artIdsOf(resolved.edition!).has("plainFileA")).toBe(false);
    expect(resolved.deck.cards[0]!.pairs[0]!.art).toBe("secondFileA");
  });

  it("does not pin a deck whose picks are not in the resolved edition", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const pack: UnlockedPack = {
      packHash: packHash("wrong-pack"),
      folderId: "wrong-pack",
      savedAt: "2026-11-09T00:00:00.000Z",
      catalogue: catalogueFromTree(folder("wrong-pack", "Deluxe", [folder("wrong-full", "Full Deck", [file("wrongFile", "Sol Ring.jpg")])]), "Silksong"),
    };
    const edition = pack.catalogue.editions[0]!;
    const saved: SavedDeck = {
      id: "v014",
      name: "Wrong picks",
      deckId: pack.catalogue.id,
      deckName: pack.catalogue.name,
      editionId: "deluxe",
      editionName: "Deluxe",
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: [{ cardId: "old-card", locked: false, pairs: [{ art: "art-from-another-pack", qty: 1 }] }],
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    expect(edition.id).toBe("deluxe");
    const merged = mergeCatalogues([], [pack]);
    const opened = resolveSavedDeck(saved, [pack], merged);
    expect(opened.note).toMatch(/isn't in the edition/);
    expect(opened.edition).toBeNull();
    expect(migrateSavedDecks([saved], [pack], merged)).toBeNull();
    const unpinned: SavedDeck = { ...saved, editionId: "deluxe-edition" };
    const renamed = catalogueFromTree(folder("wrong-pack-2", "Deluxe Edition", [folder("wrong-full-2", "Full Deck", [file("wrongFile2", "Island.jpg")])]), "Silksong");
    const other: UnlockedPack = { packHash: packHash("wrong-pack-2"), folderId: "wrong-pack-2", savedAt: pack.savedAt, catalogue: renamed };
    const otherMerged = mergeCatalogues([], [other]);
    const missed = resolveSavedDeck(unpinned, [other], otherMerged);
    expect(missed.note).toMatch(/isn't in the edition/);
    expect(missed.edition).toBeNull();
    expect(migrateSavedDecks([unpinned], [other], otherMerged)).toBeNull();
  });

  it("notes an unknown saved card and does not write that drop", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const standard = catalogueFromTree(folder("sxf-std", "1_SxF Standard Edition", [folder("sxf-full", "Full Deck", [file("island-1", "Island 1.jpg")])]));
    const edition = standard.editions[0]!;
    const saved: SavedDeck = {
      id: "old-basics",
      name: "SxF",
      deckId: standard.id,
      deckName: standard.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: [
        { cardId: edition.cards[0]!.id, locked: false, pairs: [{ art: "island-1", qty: 2 }] },
        { cardId: "gone-card", locked: false, pairs: [{ art: "missing-art", qty: 4 }] },
      ],
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const resolved = resolveSavedDeck(saved, [], [standard]);
    expect(resolved.note).toMatch(/Some saved cards were dropped/);
    expect(resolved.deck.cards.map((card) => card.cardId)).toEqual([edition.cards[0]!.id]);
    expect(droppedSavedCardIds(edition, saved.cards)).toContain("gone-card");
    expect(selectionToSlots(edition, saved.cards)).toHaveLength(2);
    expect(migrateSavedDecks([saved], [], [standard])).toBeNull();
  });

  it("keeps every SxF copy through an edit and a save", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const islands = Array.from({ length: 40 }, (_, index) => file(`sxf-i-${index + 1}`, `Island ${index + 1}.jpg`));
    const spells = Array.from({ length: 80 }, (_, index) => file(`sxf-s-${index}`, `Spell ${index}.jpg`));
    const catalogue = catalogueFromTree(folder("sxf-pack", "1_SxF Standard Edition", [folder("sxf-full", "Full Deck", [...spells, ...islands])]));
    const edition = catalogue.editions[0]!;
    const designed = designedSelection(edition);
    expect(designed).toHaveLength(edition.cards.filter((card) => card.role === "main").length);
    expect(designed.find((card) => card.cardId === edition.cards.find((item) => item.name === "Island 1")?.id)?.pairs[0]?.qty).toBe(1);
    expect(designed.find((card) => card.cardId === edition.cards.find((item) => item.name === "Island 2")?.id)?.pairs[0]?.qty).toBe(1);
    expect(new Set(designed.map((card) => card.cardId)).size).toBe(designed.length);
    const edited = designed.map((card) =>
      card.cardId === edition.cards.find((item) => item.name === "Island 2")?.id ? { ...card, pairs: [{ art: card.pairs[0]?.art ?? "", qty: 4 }] } : card,
    );
    const saved: SavedDeck = {
      id: "sxf-round",
      name: "SxF",
      deckId: catalogue.id,
      deckName: catalogue.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: edited,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const resolved = resolveSavedDeck(saved, [], [catalogue]);
    expect(resolved.note).toBeNull();
    expect(resolved.deck.cards).toHaveLength(edited.length);
    expect(resolved.deck.cards.find((card) => card.cardId === edition.cards.find((item) => item.name === "Island 2")?.id)?.pairs[0]?.qty).toBe(4);
    const slots = selectionToSlots(edition, resolved.deck.cards);
    const island2 = edition.cards.find((card) => card.name === "Island 2")!;
    expect(slots.filter((slot) => slot.front.id === island2.faces[0]!.defaultArt!.id)).toHaveLength(4);
    expect(migrateSavedDecks([saved], [], [catalogue])).toBeNull();
  });

  it("exports every copy of a v0.1.11 Vader deluxe save", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const swamps = Array.from({ length: 16 }, (_, index) => file(`vader-swamp-${index + 1}`, `Swamp ${index + 1}.jpg`));
    const catalogue = catalogueFromTree(
      folder("vader-pack", "3_Vader", [
        folder("vader-wrap", "2_Vader Deluxe Edition", [
          folder("vader-dpi", "Deluxe Edition (1200 DPI)", [
            ...swamps,
            folder("vader-notes", "Notes", [file("vader-readme", "readme.txt")]),
          ]),
        ]),
      ]),
    );
    const edition = catalogue.editions[0]!;
    const mains = edition.cards.filter((card) => card.role === "main");
    expect(mains).toHaveLength(16);
    expect(mains.every((card) => card.defaultQty === 1)).toBe(true);
    const saved: SavedDeck = {
      id: "vader-011",
      name: "Vader",
      deckId: catalogue.id,
      deckName: catalogue.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: mains.map((card) => ({ cardId: card.id, locked: false, pairs: [{ art: card.faces[0]!.defaultArt!.id, qty: 1 }] })),
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const resolved = resolveSavedDeck(saved, [], [catalogue]);
    expect(resolved.note).toBeNull();
    expect(resolved.deck.cards).toHaveLength(16);
    const slots = selectionToSlots(edition, resolved.deck.cards);
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((slot) => slot.front.id)).size).toBe(16);
  });

  it("resolves an unlocked paid deck with a stale row, a duplicate row, and a v0.1.11 P5 extra id", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const catalogue = catalogueFromTree(
      folder("p5pack", "3_P5", [
      folder("p5dx", "2_P5 Deluxe Edition", [
        folder("p5dpi", "Deluxe Edition (1200 DPI)", [
          file("p5-sol", "Sol Ring.jpg"),
          folder("p5std", "Standard Edition (600 DPI)", [file("p5-std-sol", "Sol Ring.jpg")]),
          folder("p5alt", "Alt", [folder("p5lands", "Lands", [folder("p5duals", "True Duals", [file("badlands-file", "Badlands.jpg")])])]),
        ]),
      ]),
      ]),
    );
    const edition = catalogue.editions[0]!;
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!;
    const badlands = edition.cards.find((card) => card.name === "Badlands")!;
    expect(badlands.id).toBe("extra-badlands");
    expect(sol.faces[0]!.defaultArt?.id).toBe("p5-sol");
    expect(sol.faces[0]!.alternates.map((art) => art.id)).not.toContain("p5-std-sol");
    expect(badlands.id).not.toBe("extra-extra-badlands");
    const pack: UnlockedPack = {
      packHash: packHash("p5-folder"),
      folderId: "p5-folder",
      savedAt: "2026-11-09T00:00:00.000Z",
      catalogue,
    };
    const merged = mergeCatalogues([], [pack]);
    const base = {
      id: "p5-save",
      name: "P5 All cards",
      deckId: catalogue.id,
      deckName: catalogue.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard" as const,
      treatment: null,
      cardbackId: null,
      packHash: pack.packHash,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const allCards: SavedDeck = {
      ...base,
      cards: [
        { cardId: sol.id, locked: false, pairs: [{ art: "p5-sol", qty: 1 }] },
        { cardId: "extra-extra-badlands", locked: false, pairs: [{ art: "badlands-file", qty: 1 }] },
      ],
    };
    const recovered = resolveSavedDeck(allCards, [pack], merged);
    expect(recovered.note).toBeNull();
    expect(recovered.edition).not.toBeNull();
    expect(recovered.deck.cards.map((card) => card.cardId).sort()).toEqual([badlands.id, sol.id].sort());
    const slots = selectionToSlots(recovered.edition!, recovered.deck.cards);
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.front.id).sort()).toEqual(["badlands-file", "p5-sol"]);

    const unknown: SavedDeck = {
      ...base,
      cards: [
        { cardId: sol.id, locked: false, pairs: [{ art: "p5-sol", qty: 1 }] },
        { cardId: "not-a-card", locked: false, pairs: [{ art: "missing-file", qty: 3 }] },
      ],
    };
    const dropped = resolveSavedDeck(unknown, [pack], merged);
    expect(dropped.note).toBe("Some saved cards were dropped.");
    expect(dropped.edition?.id).toBe(edition.id);
    expect(dropped.deck.cards).toHaveLength(1);
    expect(selectionToSlots(dropped.edition!, unknown.cards)).toHaveLength(1);
    expect(migrateSavedDecks([unknown], [pack], merged)).toBeNull();

    const summed = resolveSavedDeck(
      {
        ...base,
        cards: [
          { cardId: sol.id, locked: false, pairs: [{ art: "p5-sol", qty: 2 }] },
          { cardId: sol.id, locked: true, pairs: [{ art: "p5-sol", qty: 3 }] },
        ],
      },
      [pack],
      merged,
    );
    expect(summed.note).toBeNull();
    expect(summed.deck.cards).toHaveLength(1);
    expect(summed.deck.cards[0]!.pairs[0]!.qty).toBe(5);
    const split = resolveSavedDeck(
      {
        ...base,
        cards: [
          { cardId: sol.id, locked: false, pairs: [{ art: "p5-sol", qty: 2 }] },
          { cardId: sol.id, locked: false, pairs: [{ art: "badlands-file", qty: 4 }] },
        ],
      },
      [pack],
      merged,
    );
    expect(split.note).toBeNull();
    expect(split.deck.cards).toHaveLength(2);
    expect(split.deck.cards.find((card) => card.cardId === sol.id)?.pairs).toEqual([{ art: "p5-sol", qty: 2 }]);
    expect(split.deck.cards.find((card) => card.cardId === badlands.id)?.pairs).toEqual([{ art: "badlands-file", qty: 4 }]);
    expect(droppedSavedCardIds(edition, split.deck.cards)).toEqual([]);
  });

  it("opens a built-in standard deck with default art when a pick is missing", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const standard = catalogueFromTree(folder("std-root", "1_ Silksong Standard Edition", [folder("std-full", "Full Deck", [file("stdSolRing", "Sol Ring.jpg")])]));
    const edition = standard.editions[0]!;
    const card = edition.cards[0]!;
    const saved: SavedDeck = {
      id: "builtin",
      name: "Silksong · Standard",
      deckId: standard.id,
      deckName: standard.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard",
      treatment: null,
      cardbackId: null,
      cards: [{ cardId: card.id, locked: false, pairs: [{ art: "missing-print", qty: 2 }] }],
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const resolved = resolveSavedDeck(saved, [], [standard]);
    expect(resolved.edition?.id).toBe("standard");
    expect(resolved.deck.cards[0]!.pairs[0]!.qty).toBe(2);
    expect(resolved.deck.cards[0]!.pairs[0]!.art).toBe("stdSolRing");
    expect(resolved.note).toMatch(/missing-print/);
    expect(resolved.note).toMatch(/default art/);
    expect(resolved.note).not.toMatch(/Unlock the folder/);
  });

  it("writes a freshly unlocked pack without its folder id", () => {
    const store = memoryStore();
    const catalogue = catalogueFromTree(
      { id: "fresh-root", name: "Deluxe", folder: true, children: [{ id: "fresh-full", name: "Full Deck", folder: true, children: [{ id: "freshFile", name: "Sol Ring.jpg", folder: false }] }] },
      "Silksong",
    );
    writeUnlocked(store, [
      { packHash: packHash("fresh-folder"), folderId: "fresh-folder", savedAt: "2026-11-09T00:00:00.000Z", catalogue },
    ]);
    const raw = store.getItem(UNLOCK_KEY) ?? "";
    expect(raw).not.toContain("folderId");
    expect(raw).not.toContain("fresh-folder");
    expect(JSON.parse(raw)[0].packHash).toBe(packHash("fresh-folder"));
  });

  it("keeps an unlock record it cannot parse after stripping the folder id and link", () => {
    const store = memoryStore();
    store.setItem("printabee.rememberLink.v1", "1");
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([
        {
          folderId: "gone-folder",
          sourceUrl: "https://drive.google.com/drive/folders/gone-folder",
          rememberLink: true,
          custom: "keep-this-record",
        },
      ]),
    );
    expect(loadUnlocked(store)).toEqual([]);
    const raw = store.getItem(UNLOCK_KEY) ?? "";
    expect(raw).toContain("keep-this-record");
    expect(raw).not.toContain("gone-folder");
    expect(raw).not.toContain("folderId");
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("rememberLink");
    expect(store.getItem("printabee.rememberLink.v1")).toBeNull();
    const catalogue = catalogueFromTree(
      { id: "next-root", name: "Deluxe", folder: true, children: [{ id: "next-full", name: "Full Deck", folder: true, children: [{ id: "nextFile", name: "Sol Ring.jpg", folder: false }] }] },
      "Silksong",
    );
    writeUnlocked(store, upsertUnlocked(loadUnlocked(store), { packHash: packHash("next-folder"), folderId: "next-folder", savedAt: "2026-11-09T01:00:00.000Z", catalogue }));
    const afterUnlock = store.getItem(UNLOCK_KEY) ?? "";
    expect(afterUnlock).toContain("keep-this-record");
    expect(afterUnlock).not.toContain("folderId");
    expect(afterUnlock).not.toContain("gone-folder");
    expect(afterUnlock).not.toContain("next-folder");
    expect(afterUnlock).toContain(packHash("next-folder"));
  });

  it("strips secrets from unreadable records when only writeUnlocked runs", () => {
    const store = memoryStore();
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([
        {
          folderId: "secret-folder",
          sourceUrl: "https://drive.google.com/drive/folders/secret-folder",
          rememberLink: true,
          custom: "still-here",
        },
      ]),
    );
    const catalogue = catalogueFromTree(
      { id: "only-write-root", name: "Deluxe", folder: true, children: [{ id: "only-write-full", name: "Full Deck", folder: true, children: [{ id: "onlyWriteFile", name: "Sol Ring.jpg", folder: false }] }] },
      "Silksong",
    );
    writeUnlocked(store, [{ packHash: packHash("only-write-folder"), folderId: "only-write-folder", savedAt: "2026-11-09T02:00:00.000Z", catalogue }]);
    const raw = store.getItem(UNLOCK_KEY) ?? "";
    expect(raw).toContain("still-here");
    expect(raw).not.toContain("secret-folder");
    expect(raw).not.toContain("folderId");
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("rememberLink");
    expect(raw).not.toContain("only-write-folder");
  });

  it("forgets unlocked folders and leaves no unreadable records", () => {
    const store = memoryStore();
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([{ folderId: "gone-folder", sourceUrl: "https://drive.google.com/drive/folders/gone-folder", custom: "keep-this-record" }]),
    );
    forgetUnlocked(store);
    expect(store.getItem(UNLOCK_KEY)).toBeNull();
  });

  it("stores a truncated SHA-256, still reads a v0.1.5 FNV hash, and does not write the folder id", () => {
    expect(packHash("abc")).toBe("ba7816bf8f01");
    expect(packHash("deluxe-pack-a")).not.toBe(fnvPackHash("deluxe-pack-a"));
    const catalogue = catalogueFromTree(
      { id: "stored-pack", name: "Deluxe", folder: true, children: [{ id: "stored-full", name: "Full Deck", folder: true, children: [{ id: "storedFile", name: "Sol Ring.jpg", folder: false }] }] },
      "Silksong",
    );
    const store = memoryStore();
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([
        {
          folderId: "stored-pack",
          sourceUrl: "https://drive.google.com/drive/folders/stored-pack",
          savedAt: "2026-11-09T00:00:00.000Z",
          catalogue,
        },
      ]),
    );
    const loaded = loadUnlocked(store);
    expect(loaded[0]!.packHash).toBe(packHash("stored-pack"));
    expect(loaded[0]!.legacyHash).toBe(fnvPackHash("stored-pack"));
    expect(loaded[0]!.folderId).toBeUndefined();
    const rewritten = store.getItem(UNLOCK_KEY) ?? "";
    expect(rewritten).not.toContain("folderId");
    expect(rewritten).not.toContain("drive.google.com");
    expect(rewritten).not.toContain("stored-pack");
    const old: SavedDeck = {
      ...deck,
      editionId: loaded[0]!.catalogue.editions[0]!.id,
      packHash: fnvPackHash("stored-pack"),
      cards: [{ cardId: loaded[0]!.catalogue.editions[0]!.cards[0]!.id, locked: false, pairs: [{ art: "storedFile", qty: 1 }] }],
    } as unknown as SavedDeck;
    const resolved = resolveSavedDeck(old, loaded, mergeCatalogues([], loaded));
    expect(resolved.note).toBeNull();
    expect(resolved.deck.packHash).toBe(packHash("stored-pack"));
    store.setItem(
      UNLOCK_KEY,
      JSON.stringify([{ ...JSON.parse(rewritten)[0], rememberLink: true, sourceUrl: "https://drive.google.com/drive/folders/kept-link" }]),
    );
    loadUnlocked(store);
    expect(store.getItem(UNLOCK_KEY) ?? "").not.toContain("kept-link");
    expect(store.getItem(UNLOCK_KEY) ?? "").not.toContain("rememberLink");
  });

  it("keeps a second art of a card the deck already holds, and exports a 65-card SxF deluxe save", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const spells = Array.from({ length: 50 }, (_, index) => file(`spell-${index}`, `Spell ${index}.jpg`));
    const bases = ["Elephant", "Gold", "Radiation", "Treasure", "Foretell", "Ghostly Prison"];
    const altFiles = [
      ["ele-alt", "Elephant.jpg", "Elephant"],
      ["gold-1", "Gold 1.jpg", "Gold"],
      ["gold-2", "Gold 2.jpg", "Gold"],
      ["rad-alt", "Radiation.jpg", "Radiation"],
      ["tre-1", "Treasure 1.jpg", "Treasure"],
      ["tre-2", "Treasure 2.jpg", "Treasure"],
      ["fore-1", "Foretell 1.jpg", "Foretell"],
      ["fore-2", "Foretell 2.jpg", "Foretell"],
      ["ghost-2", "Ghostly Prison 2.jpg", "Ghostly Prison"],
    ] as const;
    const catalogue = catalogueFromTree(
      folder("sxf", "3_SxF", [
        folder("sxfdx", "2_SxF Deluxe Edition", [
          folder("sxfdpi", "Deluxe Edition (1200 DPI)", [
            ...spells,
            ...bases.map((name) => file(`base-${name}`, `${name}.jpg`)),
            folder(
              "sxfalt",
              "Alt",
              bases.map((name) => folder(`alt-${name}`, name, altFiles.filter((item) => item[2] === name).map(([id, filename]) => file(id, filename)))),
            ),
          ]),
        ]),
      ]),
    );
    const edition = catalogue.editions[0]!;
    expect(edition.cards.filter((card) => card.role === "main")).toHaveLength(56);
    for (const [id] of altFiles) {
      expect(edition.cards.some((card) => card.faces.some((face) => face.defaultArt?.id === id || face.alternates.some((art) => art.id === id)))).toBe(true);
    }
    const pack: UnlockedPack = { packHash: packHash("sxf-dx"), folderId: "sxf-dx", savedAt: "2026-11-09T00:00:00.000Z", catalogue };
    const mains = edition.cards.filter((card) => card.role === "main");
    const saved: SavedDeck = {
      id: "sxf-65",
      name: "SxF All cards",
      deckId: catalogue.id,
      deckName: catalogue.name,
      editionId: edition.id,
      editionName: edition.name,
      printType: "standard",
      packHash: pack.packHash,
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
      cards: [
        ...mains.map((card) => ({ cardId: card.id, locked: false, pairs: [{ art: card.faces[0]!.defaultArt!.id, qty: 1 }] })),
        ...altFiles.map(([id, filename]) => ({ cardId: `v011-${filename}`, locked: false, pairs: [{ art: id, qty: 1 }] })),
      ],
    };
    const resolved = resolveSavedDeck(saved, [pack], mergeCatalogues([], [pack]));
    expect(resolved.note).toBeNull();
    expect(selectionToSlots(edition, resolved.deck.cards)).toHaveLength(65);
    const gold = resolved.deck.cards.find((card) => edition.cards.find((item) => item.id === card.cardId)?.name === "Gold");
    expect(gold?.pairs.map((pair) => pair.art).sort()).toEqual(["base-Gold", "gold-1", "gold-2"].sort());
    const edited = resolved.deck.cards.map((card) =>
      card.cardId === gold?.cardId ? { ...card, pairs: card.pairs.map((pair) => (pair.art === "gold-2" ? { ...pair, qty: 3 } : pair)) } : card,
    );
    const again = resolveSavedDeck({ ...saved, cards: edited }, [pack], mergeCatalogues([], [pack]));
    expect(again.deck.cards.find((card) => card.cardId === gold?.cardId)?.pairs).toEqual(edited.find((card) => card.cardId === gold?.cardId)?.pairs);
    const slots = selectionToSlots(edition, again.deck.cards);
    expect(slots.filter((slot) => slot.front.id === "gold-2")).toHaveLength(3);
    expect(slots.filter((slot) => slot.front.id === "gold-1")).toHaveLength(1);
  });

  it("exports all 306 copies of a v0.1.11 P5 deluxe save, including Alt", () => {
    const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
    const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
    const mains = Array.from({ length: 198 }, (_, index) => file(`p5m-${index}`, `Spell ${index}.jpg`));
    const duals = Array.from({ length: 106 }, (_, index) => file(`p5d-${index}`, `Dual Land ${index}.jpg`));
    const catalogue = catalogueFromTree(
      folder("p5", "3_P5", [
        folder("dx", "2_P5 Deluxe Edition", [
          folder("dpi", "Deluxe Edition (1200 DPI)", [
            folder("deck", "Full Deck", [
              file("dx-sol", "Sol Ring.png"),
              ...mains,
              folder("alt", "Alt", [folder("lands", "Lands", [folder("duals", "True Duals", [...duals, file("dx-forest", "Forest 3.jpg")])])]),
            ]),
            folder("std600", "Standard Edition (600 DPI)", [file("pack-forest", "Forest 3.jpg"), file("std600-sol", "Sol Ring.jpg")]),
          ]),
        ]),
      ]),
    );
    expect(catalogue.id).toBe("p5");
    expect(catalogue.name).toBe("P5");
    const persona = {
      id: "persona-5",
      name: "Persona 5",
      creator: "Beespair" as const,
      editions: [
        {
          id: "standard",
          name: "Standard",
          printType: "standard" as const,
          origin: "shipped" as const,
          cards: [
            {
              id: "extra-lands",
              name: "Lands",
              role: "extra" as const,
              defaultQty: 0,
              faces: [{ id: "extra-lands:front", name: "Lands", defaultArt: { id: "std-forest-3", name: "Forest 3.jpg", thumbId: "std-forest-3", label: "Forest 3" }, alternates: [] }],
            },
            {
              id: "main-sol",
              name: "Sol Ring",
              role: "main" as const,
              defaultQty: 1,
              faces: [{ id: "main-sol:front", name: "Sol Ring", defaultArt: { id: "std-sol", name: "Sol Ring.jpg", thumbId: "std-sol", label: "Sol Ring" }, alternates: [] }],
            },
          ],
          backs: [],
          notes: [],
        },
      ],
    };
    const deluxe = catalogue.editions.find((edition) => edition.id.includes("deluxe"))!;
    expect(deluxe.cards.find((card) => card.name === "Sol Ring")!.faces[0]!.defaultArt?.id).toBe("dx-sol");
    const dualCards = duals.map((node) => deluxe.cards.find((card) => card.faces[0]?.defaultArt?.id === node.id)!);
    expect(dualCards.every(Boolean)).toBe(true);
    const pack: UnlockedPack = { packHash: packHash("p5-dx"), folderId: "p5-dx", savedAt: "2026-11-09T00:00:00.000Z", catalogue };
    const catalogues = mergeCatalogues([persona], [pack]);
    const rows = [
      ...deluxe.cards
        .filter((card) => card.faces[0]?.defaultArt && card.faces[0].defaultArt.id !== "dx-forest" && !duals.some((node) => node.id === card.faces[0]?.defaultArt?.id))
        .map((card) => ({ cardId: card.id, locked: false, pairs: [{ art: card.faces[0]!.defaultArt!.id, qty: 1 }] })),
      ...duals.map((node) => ({ cardId: `extra-extra-${node.name}`, locked: false, pairs: [{ art: node.id, qty: 1 }] })),
      { cardId: "extra-lands", locked: false, pairs: [{ art: "pack-forest", qty: 1 }] },
    ];
    const saved: SavedDeck = {
      id: "p5-306",
      name: "P5 All cards",
      deckId: catalogue.id,
      deckName: catalogue.name,
      editionId: deluxe.id,
      editionName: deluxe.name,
      printType: "standard",
      packHash: pack.packHash,
      treatment: null,
      cardbackId: null,
      cards: rows,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    expect(rows).toHaveLength(306);
    expect(deluxe.sourceFiles?.some((file) => file.id === "pack-forest")).toBe(true);
    const resolved = resolveSavedDeck(saved, [pack], [catalogue]);
    expect(resolved.note ?? "").not.toMatch(/dropped/);
    expect(selectionToSlots(deluxe, resolved.deck.cards)).toHaveLength(306);
    const renamed: SavedDeck = {
      ...saved,
      cards: [{ cardId: "old-standard-sol", locked: false, pairs: [{ art: "std-sol", qty: 4 }] }],
    };
    const swapped = resolveSavedDeck(renamed, [pack], catalogues);
    expect(swapped.note).toMatch(/Some saved art picks were updated to this edition's files/);
    expect(swapped.deck.cards[0]!.pairs[0]!.art).toBe("dx-sol");
    expect(selectionToSlots(deluxe, swapped.deck.cards).map((slot) => slot.front.id)).toEqual(["dx-sol", "dx-sol", "dx-sol", "dx-sol"]);
    expect(selectionToSlots(deluxe, resolved.deck.cards).some((slot) => slot.front.id === "dx-forest")).toBe(true);
    expect(resolved.deck.cards.some((card) => card.pairs.some((pair) => pair.art === "dx-forest"))).toBe(true);
    const solCard = deluxe.cards.find((card) => card.name === "Sol Ring")!;
    const sameCard: SavedDeck = { ...saved, cards: [{ cardId: solCard.id, locked: false, pairs: [{ art: "stale-paid-file", qty: 2 }] }] };
    const migrated = migrateSavedDecks([sameCard], [pack], catalogues);
    expect(migrated?.[0]?.cards[0]?.pairs).toEqual([{ art: "dx-sol", qty: 2 }]);
  });

  it("keeps the first owner of a file, a file id used as the old card id, and does not keep another card's art", () => {
    const art = (id: string) => ({ id, name: `${id}.jpg`, thumbId: id, label: id });
    const edition: Edition = {
      id: "deluxe",
      name: "Deluxe",
      printType: "standard",
      origin: "unlocked",
      cards: [
        { id: "first", name: "Alpha", role: "main", defaultQty: 1, faces: [{ id: "first:front", name: "Alpha", defaultArt: art("shared"), alternates: [] }] },
        { id: "second", name: "Beta", role: "extra", defaultQty: 0, faces: [{ id: "second:front", name: "Beta", defaultArt: art("only-second"), alternates: [art("shared")] }] },
      ],
      backs: [],
      notes: [],
    };
    const catalogue = { id: "deck", name: "Deck", creator: "Beespair" as const, editions: [edition] };
    const pack: UnlockedPack = { packHash: packHash("own"), folderId: "own", savedAt: "2026-11-09T00:00:00.000Z", catalogue };
    const base = {
      id: "own",
      name: "Own",
      deckId: "deck",
      deckName: "Deck",
      editionId: "deluxe",
      editionName: "Deluxe",
      printType: "standard" as const,
      packHash: pack.packHash,
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const first = resolveSavedDeck({ ...base, cards: [{ cardId: "stale", locked: false, pairs: [{ art: "shared", qty: 2 }] }] }, [pack], [catalogue]);
    expect(first.deck.cards.map((card) => card.cardId)).toEqual(["first"]);
    const asFile = resolveSavedDeck({ ...base, cards: [{ cardId: "shared", locked: false, pairs: [{ art: "", qty: 1 }] }] }, [pack], [catalogue]);
    expect(asFile.deck.cards[0]?.cardId).toBe("first");
    expect(asFile.deck.cards[0]?.pairs[0]?.art).toBe("shared");
    const mixed = resolveSavedDeck(
      { ...base, cards: [{ cardId: "first", locked: false, pairs: [{ art: "shared", qty: 1 }, { art: "only-second", qty: 1 }] }] },
      [pack],
      [catalogue],
    );
    expect(mixed.deck.cards.find((card) => card.cardId === "first")?.pairs.map((pair) => pair.art)).toEqual(["shared"]);
    expect(mixed.deck.cards.find((card) => card.cardId === "second")?.pairs.map((pair) => pair.art)).toEqual(["only-second"]);
    const legacy = JSON.parse(JSON.stringify({ ...base, cards: [{ cardId: "stale-face", qty: 1, locked: false, arts: { "not-a-face": "shared" } }] })) as SavedDeck;
    const parsed = loadSaved({ getItem: () => JSON.stringify([legacy]), setItem: () => undefined, removeItem: () => undefined });
    const fromKey = resolveSavedDeck(parsed[0]!, [pack], [catalogue]);
    expect(selectionToSlots(edition, fromKey.deck.cards).map((slot) => slot.front.id)).toEqual(["shared"]);
    expect(JSON.stringify(fromKey.deck.cards)).not.toContain("not-a-face");
    const locked = resolveSavedDeck(
      {
        ...base,
        cards: [
          { cardId: "first", locked: true, pairs: [{ art: "shared", qty: 1 }] },
          { cardId: "first", locked: false, pairs: [{ art: "shared", qty: 2 }] },
        ],
      },
      [pack],
      [catalogue],
    );
    expect(locked.deck.cards[0]!.locked).toBe(true);
    expect(locked.deck.cards[0]!.pairs[0]!.qty).toBe(3);
  });

  it("reads both faces of an old save, caps quantity, and does not write while loading", () => {
    const store = memoryStore();
    const writes: string[] = [];
    const watching = {
      getItem: (key: string) => store.getItem(key),
      setItem: (key: string, value: string) => {
        writes.push(key);
        store.setItem(key, value);
      },
      removeItem: (key: string) => store.removeItem(key),
    };
    const legacy = {
      id: "dfc",
      name: "DFC",
      deckId: "deck",
      deckName: "Deck",
      editionId: "standard",
      editionName: "Standard",
      printType: "standard",
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
      cards: [
        { cardId: "terra", qty: 150, locked: false, arts: { "terra:front": "front-file", "terra:back": "back-file", "terra:other": "later-file" } },
        { cardId: "blank", qty: 1, locked: false, pairs: [{ art: "   ", qty: 1 }] },
        { cardId: "empty", qty: 1, locked: false, pairs: [] },
        { cardId: "big", locked: false, pairs: [{ art: "front-file", qty: 150 }] },
      ],
    };
    const original = JSON.stringify([legacy]);
    watching.setItem("printabee.savedDecks.v1", original);
    writes.length = 0;
    const loaded = loadSaved(watching);
    expect(writes).toEqual([]);
    expect(loaded[0]!.cards.map((card) => card.cardId)).toEqual(["terra", "blank", "big"]);
    expect(loaded[0]!.cards[0]!.pairs[0]).toEqual({ art: "front-file", back: "back-file", qty: 99 });
    expect(loaded[0]!.cards[1]!.pairs[0]!.art).toBe("");
    expect(loaded[0]!.cards[2]!.pairs[0]!.qty).toBe(99);
    const firstSave = loaded.map((deck, index) => (index === 0 ? { ...deck, name: "First converted" } : deck));
    const secondSave = loaded.map((deck, index) => (index === 0 ? { ...deck, name: "Second converted" } : deck));
    writeSaved(watching, firstSave);
    expect(store.getItem(LEGACY_BACKUP_KEY)).toBe(original);
    writeSaved(watching, secondSave);
    expect(store.getItem(LEGACY_BACKUP_KEY)).toBe(original);
    expect(store.getItem("printabee.savedDecks.v1")).toContain("Second converted");
    expect(store.getItem("printabee.savedDecks.v1")).not.toContain("First converted");
    const edition: Edition = {
      id: "standard",
      name: "Standard",
      printType: "standard",
      cards: [
        {
          id: "terra",
          name: "Terra, Magical Adept // Esper Terra",
          role: "main",
          defaultQty: 1,
          faces: [
            { id: "terra:front", name: "Terra, Magical Adept", defaultArt: { id: "front-file", name: "front.jpg", thumbId: "front-file", label: "front" }, alternates: [] },
            { id: "terra:back", name: "Esper Terra", defaultArt: { id: "back-default", name: "back.jpg", thumbId: "back-default", label: "back" }, alternates: [{ id: "back-file", name: "Esper Terra 3.jpg", thumbId: "back-file", label: "Esper Terra 3" }] },
          ],
        },
      ],
      backs: [],
      notes: [],
    };
    expect(selectionToSlots(edition, loaded[0]!.cards)[0]?.back?.id).toBe("back-file");
  });

  it("drops a partial-foil art in a deluxe deck and a paid art in a free deck", () => {
    const art = (id: string, name = `${id}.jpg`) => ({ id, name, thumbId: id, label: id });
    const deluxe: Edition = {
      id: "deluxe",
      name: "Deluxe",
      printType: "standard",
      origin: "unlocked",
      packHash: packHash("cross"),
      cards: [{ id: "sol", name: "Sol Ring", role: "main", defaultQty: 1, faces: [{ id: "sol:front", name: "Sol Ring", defaultArt: art("dx-sol", "Sol Ring.jpg"), alternates: [] }] }],
      backs: [],
      notes: [],
    };
    const partial: Edition = {
      id: "partial-foil",
      name: "Partial Foil",
      printType: "partial_foil",
      origin: "unlocked",
      cards: [{ id: "sol-pf", name: "Sol Ring", role: "main", defaultQty: 1, faces: [{ id: "pf:front", name: "Sol Ring", defaultArt: art("pf-sol", "Sol Ring.pdf"), alternates: [] }] }],
      backs: [],
      notes: [],
    };
    const free: Edition = {
      id: "standard",
      name: "Standard",
      printType: "standard",
      origin: "shipped",
      cards: [{ id: "sol-free", name: "Sol Ring", role: "main", defaultQty: 1, faces: [{ id: "free:front", name: "Sol Ring", defaultArt: art("free-sol"), alternates: [] }] }],
      backs: [],
      notes: [],
    };
    const catalogue = { id: "p5", name: "P5", creator: "Beespair" as const, editions: [deluxe, partial, free] };
    const pack: UnlockedPack = { packHash: packHash("cross"), folderId: "cross", savedAt: "2026-11-09T00:00:00.000Z", catalogue };
    const base = {
      id: "cross",
      name: "Cross",
      deckId: "p5",
      deckName: "P5",
      editionName: "Deluxe",
      printType: "standard" as const,
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const pfRow = resolveSavedDeck({ ...base, editionId: "deluxe", packHash: pack.packHash, cards: [{ cardId: "old-pf", locked: false, pairs: [{ art: "pf-sol", qty: 1 }] }] }, [pack], [catalogue]);
    expect(pfRow.note).toMatch(/dropped/);
    expect(pfRow.deck.cards).toEqual([]);
    const paidInFree = resolveSavedDeck({ ...base, editionId: "standard", cards: [{ cardId: "old-paid", locked: false, pairs: [{ art: "dx-sol", qty: 1 }] }] }, [], [catalogue]);
    expect(paidInFree.note).toMatch(/dropped/);
    expect(paidInFree.deck.cards.some((card) => card.pairs.some((pair) => pair.art === "dx-sol" || pair.art === "free-sol"))).toBe(false);
    const named: Edition = {
      ...deluxe,
      id: "deluxe-b",
      origin: "unlocked",
      packHash: packHash("mud"),
      cards: [{ id: "extra-forest-3", name: "Forest 3", role: "extra", defaultQty: 0, faces: [{ id: "fb", name: "Forest 3", defaultArt: art("forest-b", "Forest 3.jpg"), alternates: [] }] }],
    };
    const otherStd: Edition = {
      id: "standard-a",
      name: "Standard",
      printType: "standard",
      cards: [{ id: "std-forest", name: "Forest", role: "main", defaultQty: 1, faces: [{ id: "sf", name: "Forest", defaultArt: art("std-forest-file", "Forest 3.jpg"), alternates: [] }] }],
      backs: [],
      notes: [],
    };
    const other = { id: "p5-a", name: "P5", creator: "Beespair" as const, editions: [otherStd] };
    const target = { id: "p5-b", name: "P5", creator: "Beespair" as const, editions: [named] };
    const mudPack: UnlockedPack = { packHash: packHash("mud"), folderId: "mud", savedAt: "2026-11-09T00:00:00.000Z", catalogue: target };
    const muddy = resolveSavedDeck(
      { ...base, deckId: "p5-b", editionId: "deluxe-b", packHash: mudPack.packHash, cards: [{ cardId: "extra-lands", locked: false, pairs: [{ art: "std-forest-file", qty: 1 }] }] },
      [mudPack],
      [other, target],
    );
    expect(muddy.note).toMatch(/dropped/);
    expect(muddy.deck.cards).toEqual([]);
    const doubled: Edition = {
      ...named,
      cards: [
        named.cards[0]!,
        { id: "forest-c", name: "Forest 3", role: "extra", defaultQty: 0, faces: [{ id: "fc", name: "Forest 3", defaultArt: art("forest-c", "Forest 3.jpg"), alternates: [] }] },
      ],
    };
    const home = { id: "p5-b", name: "P5", creator: "Beespair" as const, editions: [doubled, otherStd] };
    const twoPack: UnlockedPack = { ...mudPack, catalogue: home };
    const two = resolveSavedDeck(
      { ...base, deckId: "p5-b", editionId: "deluxe-b", packHash: twoPack.packHash, cards: [{ cardId: "extra-lands", locked: false, pairs: [{ art: "std-forest-file", qty: 1 }] }] },
      [twoPack],
      [home],
    );
    expect(two.deck.cards).toEqual([]);
    const knownPf = resolveSavedDeck(
      { ...base, editionId: "deluxe", packHash: pack.packHash, cards: [{ cardId: "sol", locked: false, pairs: [{ art: "pf-sol", qty: 1 }] }] },
      [pack],
      [catalogue],
    );
    expect(knownPf.note).toMatch(/dropped/);
    expect(knownPf.deck.cards).toEqual([]);
  });

  it("keeps a free deck at 100 after a stale art is saved and reloaded, including Cecil", () => {
    const art = (id: string) => ({ id, name: `${id}.jpg`, thumbId: id, label: id });
    const cards = Array.from({ length: 100 }, (_, index) => {
      const id = index === 0 ? "main-cecil" : `main-card-${index}`;
      const name = index === 0 ? "Cecil, Dark Knight (Lost Lace) // Cecil, Redeemed Paladin (Lace)" : `Card ${index}`;
      const faces =
        index === 0
          ? [
              { id: "main-cecil:front", name: "Cecil, Dark Knight (Lost Lace)", defaultArt: art("cecil-front"), alternates: [] },
              { id: "main-cecil:back", name: "Cecil, Redeemed Paladin (Lace)", defaultArt: art("cecil-backx"), alternates: [] },
            ]
          : [{ id: `${id}:front`, name, defaultArt: art(`artfile${String(index).padStart(4, "0")}`), alternates: [] }];
      return { id, name, role: "main" as const, defaultQty: 1, faces };
    });
    const edition: Edition = { id: "standard", name: "Standard", printType: "standard", origin: "shipped", cards, backs: [{ id: "card-back01", name: "Back", thumbId: "card-back01" }], notes: [] };
    const catalogue = { id: "silksong", name: "Silksong", creator: "Beespair" as const, editions: [edition] };
    const stale: SavedDeck = {
      id: "v016-stale",
      name: "v0.1.16 stale-art",
      deckId: "silksong",
      deckName: "Silksong",
      editionId: "standard",
      editionName: "Standard",
      printType: "standard",
      treatment: null,
      cardbackId: "card-back01",
      cards: cards.map((card) => ({ cardId: card.id, locked: false, pairs: [{ art: card.id === "main-cecil" ? "stale-cecil" : card.faces[0]!.defaultArt!.id, qty: 1 }] })),
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const opened = resolveSavedDeck(stale, [], [catalogue]);
    expect(opened.note).toMatch(/default art/);
    expect(opened.deck.cards).toHaveLength(100);
    expect(opened.deck.cards.find((card) => card.cardId === "main-cecil")!.pairs[0]!.art).toBe("cecil-front");
    const store = memoryStore();
    writeSaved(store, [opened.deck]);
    const reloaded = resolveSavedDeck(loadSaved(store)[0]!, [], [catalogue]);
    const xml = (deck: SavedDeck) =>
      buildXml({ slots: selectionToSlots(edition, deck.cards), cardback: "card-back01", deck: "Silksong", printType: "standard", treatment: null, foil: false });
    expect(xml(reloaded.deck)).toBe(xml(opened.deck));
    expect(selectionToSlots(edition, reloaded.deck.cards)).toHaveLength(100);
    expect(selectionToSlots(edition, reloaded.deck.cards).some((slot) => slot.front.id === "cecil-front")).toBe(true);
    const blank: SavedDeck = { ...stale, cards: stale.cards.map((card) => (card.cardId === "main-cecil" ? { ...card, pairs: [{ art: "", qty: 1 }] } : card)) };
    const storeBlank = memoryStore();
    storeBlank.setItem("printabee.savedDecks.v1", JSON.stringify([blank]));
    const kept = loadSaved(storeBlank)[0]!;
    expect(kept.cards.find((card) => card.cardId === "main-cecil")!.pairs[0]!.art).toBe("");
    const filled = resolveSavedDeck(kept, [], [catalogue]);
    expect(filled.note).toBeNull();
    expect(filled.deck.cards.find((card) => card.cardId === "main-cecil")!.pairs[0]!.art).toBe("cecil-front");
    expect(selectionToSlots(edition, filled.deck.cards)).toHaveLength(100);
  });

  it("skips a backup that does not fit and still saves the deck", () => {
    const store = memoryStore();
    const legacy = { ...deck, cards: [{ cardId: "sol", qty: 1, locked: false, arts: { front: "solringfile1" } }] };
    store.setItem("printabee.savedDecks.v1", JSON.stringify([legacy]));
    const watching = {
      getItem: (key: string) => store.getItem(key),
      setItem: (key: string, value: string) => {
        if (key === LEGACY_BACKUP_KEY) throw new DOMException("quota", "QuotaExceededError");
        store.setItem(key, value);
      },
      removeItem: (key: string) => store.removeItem(key),
    };
    const loaded = loadSaved(watching);
    const converted = loaded.map((item) => ({ ...item, name: "Converted once" }));
    expect(writeSaved(watching, converted)).toMatch(/could not be backed up/);
    expect(store.getItem(LEGACY_BACKUP_KEY)).toBeNull();
    expect(store.getItem("printabee.savedDecks.v1")).toContain("Converted once");
    expect(writeSaved(watching, converted.map((item) => ({ ...item, name: "Converted twice" })))).toBeNull();
    expect(store.getItem("printabee.savedDecks.v1")).toContain("Converted twice");
  });

  it("restores the original backup without taking the later save", () => {
    const store = memoryStore();
    const legacy = { ...deck, name: "Original v0.1.11", cards: [{ cardId: "sol", qty: 2, locked: false, arts: { front: "solringfile1" } }] };
    store.setItem("printabee.savedDecks.v1", JSON.stringify([legacy]));
    const loaded = loadSaved(store);
    writeSaved(store, loaded.map((item) => ({ ...item, name: "Converted" })));
    const restored = restoreLegacyBackup(store);
    expect(restored?.[0]?.name).toBe("Original v0.1.11");
    expect(store.getItem(LEGACY_BACKUP_KEY)).toContain("Original v0.1.11");
    expect(restored?.[0]?.cards[0]?.pairs[0]?.qty).toBe(2);
  });

  it("does not keep another card's back or merge two backs of the same front", () => {
    const art = (id: string) => ({ id, name: `${id}.jpg`, thumbId: id, label: id });
    const edition: Edition = {
      id: "standard",
      name: "Standard",
      printType: "standard",
      origin: "shipped",
      cards: [
        {
          id: "terra",
          name: "Terra, Magical Adept // Esper Terra",
          role: "main",
          defaultQty: 1,
          faces: [
            { id: "terra:front", name: "Terra, Magical Adept", defaultArt: art("front-file"), alternates: [] },
            { id: "terra:back", name: "Esper Terra", defaultArt: art("back-default"), alternates: [art("back-file"), art("back-other")] },
          ],
        },
        { id: "other", name: "Other", role: "extra", defaultQty: 0, faces: [{ id: "other:front", name: "Other", defaultArt: art("other-back"), alternates: [] }] },
      ],
      backs: [],
      notes: [],
    };
    const catalogue = { id: "deck", name: "Deck", creator: "Beespair" as const, editions: [edition] };
    const base = {
      id: "backs",
      name: "Backs",
      deckId: "deck",
      deckName: "Deck",
      editionId: "standard",
      editionName: "Standard",
      printType: "standard" as const,
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const foreign = resolveSavedDeck(
      { ...base, cards: [{ cardId: "terra", locked: false, pairs: [{ art: "front-file", back: "other-back", qty: 1 }] }] },
      [],
      [catalogue],
    );
    expect(foreign.deck.cards[0]!.pairs[0]!.back).toBeUndefined();
    expect(selectionToSlots(edition, foreign.deck.cards)[0]?.back?.id).toBe("back-default");
    const split = resolveSavedDeck(
      {
        ...base,
        cards: [
          { cardId: "terra", locked: false, pairs: [{ art: "front-file", back: "back-file", qty: 1 }] },
          { cardId: "terra", locked: false, pairs: [{ art: "front-file", back: "back-other", qty: 1 }] },
        ],
      },
      [],
      [catalogue],
    );
    expect(split.deck.cards[0]!.pairs).toEqual([
      { art: "front-file", back: "back-file", qty: 1 },
      { art: "front-file", back: "back-other", qty: 1 },
    ]);
    expect(selectionToSlots(edition, split.deck.cards).map((slot) => slot.back?.id)).toEqual(["back-file", "back-other"]);
  });

  it("does not retarget a file from an unrelated catalogue or an ambiguous name", () => {
    const art = (id: string, name: string) => ({ id, name, thumbId: id, label: id });
    const deluxe: Edition = {
      id: "deluxe",
      name: "Deluxe",
      printType: "standard",
      origin: "unlocked",
      packHash: packHash("rel"),
      cards: [{ id: "extra-forest-3", name: "Forest 3", role: "extra", defaultQty: 0, faces: [{ id: "fb", name: "Forest 3", defaultArt: art("dx-forest", "Forest 3.jpg"), alternates: [] }] }],
      backs: [],
      notes: [],
    };
    const packCatalogue = { id: "p5", name: "P5", creator: "Beespair" as const, editions: [deluxe] };
    const pack: UnlockedPack = { packHash: packHash("rel"), folderId: "rel", savedAt: "2026-11-09T00:00:00.000Z", catalogue: packCatalogue };
    const foreign = {
      id: "silksong",
      name: "Silksong",
      creator: "Beespair" as const,
      editions: [{ id: "standard", name: "Standard", printType: "standard" as const, cards: [{ id: "f", name: "Forest", role: "main" as const, defaultQty: 1, faces: [{ id: "ff", name: "Forest", defaultArt: art("foreign-forest", "Forest 3.jpg"), alternates: [] }] }], backs: [], notes: [] }],
    };
    const base = {
      id: "rel",
      name: "Rel",
      deckId: "p5",
      deckName: "P5",
      editionId: "deluxe",
      editionName: "Deluxe",
      printType: "standard" as const,
      packHash: pack.packHash,
      treatment: null,
      cardbackId: null,
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    const dropped = resolveSavedDeck({ ...base, cards: [{ cardId: "extra-lands", locked: false, pairs: [{ art: "foreign-forest", qty: 1 }] }] }, [pack], [packCatalogue, foreign]);
    expect(dropped.deck.cards).toEqual([]);
    const widgetA = {
      id: "widget-a",
      name: "Widget",
      creator: "Beespair" as const,
      editions: [{ id: "standard", name: "Standard", printType: "standard" as const, cards: [{ id: "w", name: "Forest 3", role: "main" as const, defaultQty: 1, faces: [{ id: "wf", name: "Forest 3", defaultArt: art("widget-forest", "Forest 3.jpg"), alternates: [] }] }], backs: [], notes: [] }],
    };
    const widgetB = { ...widgetA, id: "widget-b" };
    const ambiguous = resolveSavedDeck(
      { ...base, deckId: "missing-deck", deckName: "Widget", cards: [{ cardId: "extra-lands", locked: false, pairs: [{ art: "widget-forest", qty: 1 }] }] },
      [pack],
      [packCatalogue, widgetA, widgetB],
    );
    expect(ambiguous.deck.cards).toEqual([]);
    const island: Edition = {
      ...deluxe,
      cards: [
        deluxe.cards[0]!,
        { id: "extra-island-4", name: "Island 4", role: "extra", defaultQty: 0, faces: [{ id: "ib", name: "Island 4", defaultArt: art("dx-island", "Island 4.jpg"), alternates: [] }] },
      ],
    };
    const keysPack = { ...pack, catalogue: { ...packCatalogue, editions: [island] } };
    const twoNames = {
      id: "persona-5",
      name: "Persona 5",
      creator: "Beespair" as const,
      editions: [
        { id: "standard", name: "Standard", printType: "standard" as const, cards: [{ id: "one", name: "One", role: "main" as const, defaultQty: 1, faces: [{ id: "onef", name: "One", defaultArt: art("shared-art", "Forest 3.jpg"), alternates: [] }] }], backs: [], notes: [] },
        { id: "standard-b", name: "Other", printType: "standard" as const, cards: [{ id: "two", name: "Two", role: "main" as const, defaultQty: 1, faces: [{ id: "twof", name: "Two", defaultArt: art("shared-art", "Island 4.jpg"), alternates: [] }] }], backs: [], notes: [] },
      ],
    };
    const muddyKeys = resolveSavedDeck(
      { ...base, cards: [{ cardId: "extra-lands", locked: false, pairs: [{ art: "shared-art", qty: 1 }] }] },
      [keysPack],
      [keysPack.catalogue, twoNames],
    );
    expect(muddyKeys.deck.cards).toEqual([]);
  });
});
