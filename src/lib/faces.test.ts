import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quantitiesFromDecklist } from "@/lib/decklist";
import { pairLooseFaces } from "@/lib/faces";
import { catalogueFromTree, groupPartialFoilEdition } from "@/lib/group";
import { parsePrintName } from "@/lib/names";
import { countCopies, designedSelection, selectionToSlots } from "@/lib/selection";
import { mergeCatalogues, migrateSavedDecks, packHash, resolveSavedDeck, type SavedDeck, type UnlockedPack } from "@/lib/storage";
import type { DeckCard, DeckCatalogue, RawNode } from "@/lib/types";

const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });

const DAGGER = "1_1_Dowsing Dagger (Interdimensional Teleporter).png";
const VALE = "1_2 Lost Vale (Dimension X).png";

const mains = (cards: DeckCard[]) => cards.filter((card) => card.role === "main");
const artNames = (card: DeckCard) => card.faces.map((face) => face.defaultArt?.name);

describe("face prefixes", () => {
  it("reads the exact TMNT file names: 1_1 is the front and 1_2 the back", () => {
    expect(parsePrintName(DAGGER)).toMatchObject({ facePair: "1", face: 1, base: "Dowsing Dagger (Interdimensional Teleporter)" });
    expect(parsePrintName(VALE)).toMatchObject({ facePair: "1", face: 2, base: "Lost Vale (Dimension X)", stem: "Lost Vale (Dimension X)" });
  });

  it("accepts an underscore or a space after the face number", () => {
    for (const name of ["2_1_Front Name.jpg", "2_1 Front Name.jpg"]) expect(parsePrintName(name)).toMatchObject({ facePair: "2", face: 1, base: "Front Name" });
    for (const name of ["2_2_Back Name.jpg", "2_2 Back Name.jpg"]) expect(parsePrintName(name)).toMatchObject({ facePair: "2", face: 2, base: "Back Name" });
  });

  it("does not read a numbered basic or a folder number as a face", () => {
    for (const name of ["1 Island.jpg", "1 Island 4.jpg", "Island 1_2.jpg", "1_3 Island.jpg", "12 Plains.jpg"]) {
      expect(parsePrintName(name).face, name).toBeNull();
    }
  });
});

describe("pairing double-faced files while grouping", () => {
  const tmntStandard = folder("tmnt", "TMNT Standard Edition", [
    folder("full", "Full Deck", [file("dagger", DAGGER), file("vale", VALE), file("sol", "Sol Ring.png"), file("isl", "Island 1.png")]),
  ]);

  it("pairs Dowsing Dagger with Lost Vale so the back is not its own main card", () => {
    const edition = catalogueFromTree(tmntStandard, "TMNT").editions[0]!;
    const dfc = edition.cards.filter((card) => card.faces.length === 2);
    expect(dfc).toHaveLength(1);
    expect(dfc[0]!.name).toBe("Dowsing Dagger (Interdimensional Teleporter) // Lost Vale (Dimension X)");
    expect(artNames(dfc[0]!)).toEqual([DAGGER, VALE]);
    expect(mains(edition.cards)).toHaveLength(3);
    expect(edition.cards.some((card) => card.faces[0]!.defaultArt?.id === "vale")).toBe(false);
    expect(countCopies(designedSelection(edition))).toBe(3);
    const slot = selectionToSlots(edition, designedSelection(edition)).find((item) => item.front.id === "dagger")!;
    expect(slot.back?.id).toBe("vale");
  });

  it("pairs by the leading number even when the faces have different names, in either separator", () => {
    const edition = catalogueFromTree(
      folder("std", "Fish Standard Edition", [
        folder("full", "Full Deck", [file("a1", "1_1_Alpha.jpg"), file("b2", "2_2 Beta Back.jpg"), file("a2", "1_2 Omega.jpg"), file("b1", "2_1 Beta.jpg")]),
      ]),
      "Fish",
    ).editions[0]!;
    expect(edition.cards.map((card) => [card.name, artNames(card)])).toEqual([
      ["Alpha // Omega", ["1_1_Alpha.jpg", "1_2 Omega.jpg"]],
      ["Beta // Beta Back", ["2_1 Beta.jpg", "2_2 Beta Back.jpg"]],
    ]);
  });

  it("never counts a 1_2 back with no 1_1 front as a main card, and invents no front", () => {
    const edition = catalogueFromTree(folder("std", "Fish Standard Edition", [folder("full", "Full Deck", [file("sol", "Sol Ring.jpg"), file("vale", VALE)])]), "Fish").editions[0]!;
    expect(mains(edition.cards).map((card) => card.name)).toEqual(["Sol Ring"]);
    const orphan = edition.cards.find((card) => card.faces[0]!.defaultArt?.id === "vale")!;
    expect(orphan).toMatchObject({ role: "extra", defaultQty: 0, name: "Lost Vale (Dimension X)" });
    expect(orphan.faces).toHaveLength(1);
    expect(edition.notes.some((note) => /back face \(1_2\)/.test(note.reason))).toBe(true);
  });

  it("pairs the faces in an unlocked Deluxe edition too", () => {
    const pack = folder("pack", "TMNT", [
      folder("dx", "2_TMNT Deluxe Edition", [folder("dfull", "Full Deck", [file("dxdagger", DAGGER), file("dxvale", VALE), file("dxsol", "Sol Ring.png")])]),
    ]);
    const deluxe = catalogueFromTree(pack, "TMNT").editions.find((edition) => edition.name.startsWith("Deluxe"))!;
    expect(mains(deluxe.cards)).toHaveLength(2);
    const dfc = deluxe.cards.find((card) => card.faces.length === 2)!;
    expect(dfc.faces.map((face) => face.defaultArt?.id)).toEqual(["dxdagger", "dxvale"]);
  });

  it("pairs the faces in an unlocked Partial Foil edition, space or underscore", () => {
    const edition = groupPartialFoilEdition(
      folder("pf", "Partial Foil", [
        folder("pdf", "PDF Partial-Foil Map", [
          folder("full", "Full Deck", [
            file("pfdagger", "1_1_Dowsing Dagger (Interdimensional Teleporter).pdf"),
            file("pfvale", "1_2 Lost Vale (Dimension X).pdf"),
            file("pfsol", "Sol Ring.pdf"),
          ]),
        ]),
      ]),
    );
    expect(mains(edition.cards)).toHaveLength(2);
    const dfc = edition.cards.find((card) => card.faces.length === 2)!;
    expect(dfc.role).toBe("main");
    expect(dfc.faces.map((face) => face.defaultArt?.id)).toEqual(["pfdagger", "pfvale"]);
  });
});

describe("pairLooseFaces on an already grouped card list", () => {
  const one = (id: string, name: string, role: DeckCard["role"] = "main"): DeckCard => ({
    id,
    name: parsePrintName(name).stem,
    role,
    defaultQty: role === "main" ? 1 : 0,
    faces: [{ id: `${id}:front`, name: parsePrintName(name).stem, defaultArt: { id: `${id}-art`, name, thumbId: `${id}-art`, label: name }, alternates: [] }],
  });

  it("joins a lone front and lone back into one card that keeps the front's id, and does it once", () => {
    const cards = [one("dagger", DAGGER), one("vale", VALE), one("sol", "Sol Ring.png")];
    const first = pairLooseFaces(cards);
    expect(first.cards.map((card) => card.id)).toEqual(["dagger", "sol"]);
    expect(first.cards[0]!.faces.map((face) => face.id)).toEqual(["dagger:front", "dagger:back"]);
    expect(first.cards[0]!.faces[1]!.defaultArt).toMatchObject({ id: "vale-art", label: "Lost Vale (Dimension X)" });
    const again = pairLooseFaces(first.cards);
    expect(again.cards).toBe(first.cards);
    expect(again.notes).toEqual([]);
  });

  it("pairs within a role only, so a token 1_2 never becomes the back of a main 1_1", () => {
    const cards = [one("front", "1_1_Alpha.jpg"), one("tok", "1_2_Token - Beta.jpg", "token")];
    const result = pairLooseFaces(cards);
    expect(result.cards.map((card) => [card.id, card.faces.length])).toEqual([
      ["front", 1],
      ["tok", 1],
    ]);
  });

  it("adds a lone face to a double-faced card that already has that number", () => {
    const pair: DeckCard = {
      ...one("terra", "1_1_Terra.jpg"),
      faces: [
        { id: "terra:front", name: "Terra", defaultArt: { id: "tf", name: "1_1_Terra.jpg", thumbId: "tf", label: "Terra" }, alternates: [] },
        { id: "terra:back", name: "Esper Terra", defaultArt: { id: "tb", name: "1_2_Esper Terra.jpg", thumbId: "tb", label: "Esper Terra" }, alternates: [] },
      ],
    };
    const result = pairLooseFaces([pair, one("alt", "1_2 Esper Terra 2.jpg")]);
    expect(result.cards.map((card) => card.id)).toEqual(["terra"]);
    expect(result.cards[0]!.faces[1]!.alternates.map((art) => art.id)).toEqual(["alt-art"]);
  });
});

describe("shipped TMNT", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const tmnt = JSON.parse(readFileSync(path.join(root, "public/decks/tmnt.json"), "utf8")) as DeckCatalogue;
  const edition = tmnt.editions[0]!;
  const dagger = edition.cards.find((card) => card.faces[0]!.defaultArt?.name === DAGGER)!;
  const valeArt = dagger.faces[1]!.defaultArt!;

  it("ships Dowsing Dagger with Lost Vale as its back, and no main card for any back face", () => {
    expect(dagger.id).toBe("main-dowsing-dagger-interdimensional-teleporter");
    expect(valeArt.name).toBe(VALE);
    for (const card of mains(edition.cards)) expect(parsePrintName(card.faces[0]!.defaultArt!.name).face, card.name).not.toBe(2);
    const list = edition.decklists![0]!;
    expect(quantitiesFromDecklist(edition, list).total).toBe(100);
    expect(quantitiesFromDecklist(edition, list).quantities.get(dagger.id)).toBe(1);
  });

  const saved = (cards: SavedDeck["cards"]): SavedDeck => ({
    id: "s",
    name: "TMNT · Standard",
    deckId: "tmnt",
    deckName: "TMNT",
    editionId: "standard",
    editionName: "Standard",
    printType: "standard",
    treatment: null,
    cardbackId: null,
    cards,
    updatedAt: "2026-11-09T00:00:00.000Z",
  });
  const front = () => dagger.faces[0]!.defaultArt!.id;

  it("loads a deck saved with the old Lost Vale card onto Dowsing Dagger without counting it twice", () => {
    const both = resolveSavedDeck(
      saved([
        { cardId: dagger.id, locked: false, pairs: [{ art: front(), qty: 1 }] },
        { cardId: "main-1-2-lost-vale-dimension-x", locked: true, pairs: [{ art: valeArt.id, qty: 1 }] },
      ]),
      [],
      [tmnt],
    );
    expect(both.edition).not.toBeNull();
    expect(both.deck.cards.map((card) => card.cardId)).toEqual([dagger.id]);
    expect(both.deck.cards[0]).toMatchObject({ locked: true });
    expect(countCopies(both.deck.cards)).toBe(1);

    const valeOnly = resolveSavedDeck(saved([{ cardId: "main-1-2-lost-vale-dimension-x", locked: false, pairs: [{ art: valeArt.id, qty: 2 }] }]), [], [tmnt]);
    expect(valeOnly.deck.cards).toEqual([{ cardId: dagger.id, locked: false, pairs: [{ art: front(), qty: 2, back: valeArt.id }] }]);
  });
});

describe("the shipped-list script", () => {
  it("pairs the faces an older TMNT catalogue left apart", async () => {
    const { withShippedLists } = await import("../../scripts/attach-decklists");
    const root = path.resolve(import.meta.dirname, "../..");
    const tmnt = JSON.parse(readFileSync(path.join(root, "public/decks/tmnt.json"), "utf8")) as DeckCatalogue;
    const edition = tmnt.editions[0]!;
    const paired = edition.cards.find((card) => card.faces[0]!.defaultArt?.name === DAGGER)!;
    const [front, back] = paired.faces;
    const older: DeckCard[] = edition.cards.flatMap((card) =>
      card === paired
        ? [
            { ...card, name: front!.name, faces: [front!] },
            { id: "main-1-2-lost-vale-dimension-x", name: "1_2 Lost Vale (Dimension X)", role: "main" as const, defaultQty: 1, faces: [{ ...back!, id: "main-1-2-lost-vale-dimension-x:front", name: "1_2 Lost Vale (Dimension X)" }] },
          ]
        : [card],
    );
    const before = { ...tmnt, editions: [{ ...edition, cards: older, notes: edition.notes.filter((note) => !note.reason.startsWith("Paired face")) }] };
    const readList = (name: string) => readFileSync(path.join(root, "decklists", name), "utf8");
    expect(withShippedLists(before, readList)).toEqual(tmnt);
  });
});

describe("a v0.1.11 P5 Deluxe All-cards save that names The Ring Tempts You by its Standard file", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const persona = JSON.parse(readFileSync(path.join(root, "public/decks/persona-5.json"), "utf8")) as DeckCatalogue;
  const ring = persona.editions[0]!.cards.find((card) => card.faces[0]?.defaultArt?.name === "1_1_Token - The Ring.jpg")!;
  const mains = Array.from({ length: 196 }, (_, index) => file(`p5m-${index}`, `Spell ${index}.jpg`));
  const duals = Array.from({ length: 106 }, (_, index) => file(`p5d-${index}`, `Dual Land ${index}.jpg`));
  const catalogue = catalogueFromTree(
    folder("p5", "3_P5", [
      folder("dx", "2_P5 Deluxe Edition", [
        folder("dpi", "Deluxe Edition (1200 DPI)", [
          file("dx-sol", "Sol Ring.png"),
          ...mains,
          folder("alt", "Alt", [folder("lands", "Lands", [folder("duals", "True Duals", [...duals, file("dx-forest", "Forest 3.jpg")])])]),
          folder("tokens", "Tokens", [file("dx-ring", "1_1_Token - The Ring.png"), file("dx-tempts", "1_2_Token - The Ring Tempts You.png")]),
          folder("std600", "Standard Edition (600 DPI)", [file("pack-forest", "Forest 3.jpg"), file("std600-sol", "Sol Ring.jpg")]),
        ]),
      ]),
    ]),
  );
  const deluxe = catalogue.editions.find((edition) => edition.id.includes("deluxe"))!;
  const dxRing = deluxe.cards.find((card) => card.faces[0]?.defaultArt?.id === "dx-ring")!;
  const pack: UnlockedPack = { packHash: packHash("p5-dx-ring"), folderId: "p5-dx-ring", savedAt: "2026-11-09T00:00:00.000Z", catalogue };
  const withBuiltIns = mergeCatalogues([persona], [pack]);
  /** The two rows v0.1.11 wrote for The Ring: each face was its own token card, holding the Standard file. */
  const ringRow = { cardId: "token-token-ring", locked: false, pairs: [{ art: ring.faces[0]!.defaultArt!.id, qty: 1 }] };
  const temptsRow = (qty: number, locked = false) => ({ cardId: "token-token-ring-tempts-you", locked, pairs: [{ art: ring.faces[1]!.defaultArt!.id, qty }] });
  const saved = (cards: SavedDeck["cards"]): SavedDeck => ({
    id: "p5-all-ring",
    name: "P5 All cards",
    deckId: catalogue.id,
    deckName: catalogue.name,
    editionId: deluxe.id,
    editionName: deluxe.name,
    printType: "standard",
    packHash: pack.packHash,
    treatment: null,
    cardbackId: null,
    cards,
    updatedAt: "2026-11-09T00:00:00.000Z",
  });
  const allRows = [
    { cardId: "old-sol", locked: false, pairs: [{ art: "dx-sol", qty: 1 }] },
    ...mains.map((node) => ({ cardId: `old-${node.id}`, locked: false, pairs: [{ art: node.id, qty: 1 }] })),
    ...duals.map((node) => ({ cardId: `extra-extra-${node.name}`, locked: false, pairs: [{ art: node.id, qty: 1 }] })),
    { cardId: "extra-lands", locked: false, pairs: [{ art: "pack-forest", qty: 1 }] },
    ringRow,
    temptsRow(1),
  ];

  it("is paired in the shipped Standard JSON and in the unlocked Deluxe edition", () => {
    expect(ring.name).toBe("Token - The Ring // Token - The Ring Tempts You");
    expect(ring.faces[1]!.defaultArt!.name).toBe("1_2_Token - The Ring Tempts You.jpg");
    expect(dxRing.faces.map((face) => face.defaultArt?.id)).toEqual(["dx-ring", "dx-tempts"]);
    expect(deluxe.cards.some((card) => card.faces[0]?.defaultArt?.id === "dx-tempts")).toBe(false);
  });

  it("opens at 305 with built-ins loaded and no drop note (v0.1.24 opened 306, counting The Ring twice)", () => {
    expect(allRows).toHaveLength(306);
    const resolved = resolveSavedDeck(saved(allRows), [pack], withBuiltIns);
    expect(resolved.edition?.id).toBe(deluxe.id);
    expect(resolved.note ?? "").not.toMatch(/dropped/);
    const slots = selectionToSlots(deluxe, resolved.deck.cards);
    expect(slots).toHaveLength(305);
    const ringSlots = slots.filter((slot) => slot.front.id === "dx-ring");
    expect(ringSlots).toHaveLength(1);
    expect(ringSlots[0]!.back?.id).toBe("dx-tempts");
    expect(slots.some((slot) => slot.front.id === "dx-tempts")).toBe(false);
    expect(migrateSavedDecks([saved(allRows)], [pack], withBuiltIns)).not.toBeNull();
  });

  it("moves the copies of a save holding only The Ring Tempts You onto The Ring, and keeps its lock", () => {
    const resolved = resolveSavedDeck(saved([temptsRow(2, true)]), [pack], withBuiltIns);
    expect(resolved.note ?? "").not.toMatch(/dropped/);
    expect(resolved.deck.cards).toEqual([{ cardId: dxRing.id, locked: true, pairs: [{ art: "dx-ring", qty: 2, back: "dx-tempts" }] }]);
    expect(selectionToSlots(deluxe, resolved.deck.cards).map((slot) => [slot.front.id, slot.back?.id])).toEqual([
      ["dx-ring", "dx-tempts"],
      ["dx-ring", "dx-tempts"],
    ]);
  });

  it("does not take a 1_2 file as the front of a card, or a 1_1 file as a back", () => {
    const flipped: DeckCatalogue = {
      ...persona,
      editions: [
        {
          ...persona.editions[0]!,
          cards: [
            {
              ...ring,
              faces: [
                { ...ring.faces[0]!, defaultArt: { ...ring.faces[0]!.defaultArt!, name: "1_2_Token - The Ring.jpg" } },
                { ...ring.faces[1]!, defaultArt: { ...ring.faces[1]!.defaultArt!, name: "1_1_Token - The Ring Tempts You.jpg" } },
              ],
            },
          ],
        },
      ],
    };
    const merged = mergeCatalogues([flipped], [pack]);
    const front = resolveSavedDeck(saved([{ ...ringRow, cardId: "gone-ring" }]), [pack], merged);
    expect(front.note).toMatch(/dropped/);
    const back = resolveSavedDeck(saved([temptsRow(1)]), [pack], merged);
    expect(back.note).toMatch(/dropped/);
  });
});
