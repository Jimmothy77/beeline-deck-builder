import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_UNPREFIXED_PAIRS, pairLooseFaces } from "@/lib/faces";
import { catalogueFromTree } from "@/lib/group";
import { applyTone, countCopies, selectionToSlots } from "@/lib/selection";
import { mergeCatalogues, packHash, resolveSavedDeck, type SavedDeck, type UnlockedPack } from "@/lib/storage";
import type { DeckCard, DeckCatalogue, RawNode } from "@/lib/types";
import { buildXml } from "@/lib/xml";

const root = path.resolve(import.meta.dirname, "../..");
const sxf = JSON.parse(readFileSync(path.join(root, "public/decks/sxf.json"), "utf8")) as DeckCatalogue;
const standard = sxf.editions[0]!;
const SPECIMEN_ID = "main-hydroelectric-specimen-melinda-desmond-former-first-lady";
const OLD_LAB_ID = "main-hydroelectric-laboratory-exclusive-circle";
const SPECIMEN = "Hydroelectric Specimen (Melinda Desmond, Former First Lady)";
const LAB = "Hydroelectric Laboratory (Exclusive Circle)";

// Made-up ids. None of them is shaped like a Drive id.
const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
const mains = (cards: DeckCard[]) => cards.filter((card) => card.role === "main");

describe("SxF Standard: Hydroelectric Specimen // Hydroelectric Laboratory", () => {
  const specimen = standard.cards.find((card) => card.id === SPECIMEN_ID)!;

  it("ships one double-faced card on the front's id, with Laboratory as its back in Color and Black and White", () => {
    expect(specimen.name).toBe(`${SPECIMEN} // ${LAB}`);
    expect(specimen.role).toBe("main");
    expect(specimen.faces.map((face) => face.name)).toEqual([SPECIMEN, LAB]);
    expect(specimen.faces[0]!.defaultArt!.name).toBe(`1_1_${SPECIMEN}.jpg`);
    const back = specimen.faces[1]!;
    expect([back.defaultArt, ...back.alternates].map((art) => [art!.name, art!.tone])).toEqual([
      [`1_2_${LAB}.jpg`, "color"],
      [`1_2_${LAB}.jpg`, "bw"],
    ]);
  });

  it("has no Laboratory card of its own anywhere in the edition", () => {
    expect(standard.cards.filter((card) => /hydroelectric laboratory/i.test(card.name)).map((card) => card.id)).toEqual([SPECIMEN_ID]);
    expect(standard.cards.some((card) => card.id === OLD_LAB_ID)).toBe(false);
  });

  it("prints Laboratory on the back of Specimen, in the picked tone", () => {
    const row = { cardId: SPECIMEN_ID, locked: false, pairs: [{ art: specimen.faces[0]!.defaultArt!.id, back: specimen.faces[1]!.defaultArt!.id, qty: 1 }] };
    const [slot] = selectionToSlots(standard, [row]);
    expect(slot!.back?.name).toBe(`1_2_${LAB}.jpg`);
    const [bw] = applyTone(standard, [row], "bw");
    expect(bw!.pairs[0]!.back).toBe(specimen.faces[1]!.alternates[0]!.id);
  });

  const saved = (cards: SavedDeck["cards"]): SavedDeck => ({
    id: "s",
    name: "SxF · Standard",
    deckId: "sxf",
    deckName: "SxF",
    editionId: "standard",
    editionName: "Standard",
    printType: "standard",
    treatment: null,
    cardbackId: null,
    tone: "color",
    cards,
    updatedAt: "2026-11-09T00:00:00.000Z",
  });

  it("loads a deck saved with the old Laboratory card onto Specimen, without counting the card twice", () => {
    const front = specimen.faces[0]!.defaultArt!.id;
    const labArt = specimen.faces[1]!.defaultArt!.id;
    const both = resolveSavedDeck(
      saved([
        { cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1 }] },
        { cardId: OLD_LAB_ID, locked: true, pairs: [{ art: labArt, qty: 1 }] },
      ]),
      [],
      [sxf],
    );
    expect(both.edition).not.toBeNull();
    expect(both.deck.cards.map((card) => card.cardId)).toEqual([SPECIMEN_ID]);
    expect(both.deck.cards[0]).toMatchObject({ locked: true });
    expect(countCopies(both.deck.cards)).toBe(1);
    const labOnly = resolveSavedDeck(saved([{ cardId: OLD_LAB_ID, locked: false, pairs: [{ art: labArt, qty: 1 }] }]), [], [sxf]);
    expect(labOnly.deck.cards).toEqual([{ cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1, back: labArt }] }]);
  });
});

describe("Hydroelectric files without the 1_1_/1_2_ prefix (a paid folder named before the rename)", () => {
  const deluxe = (files: RawNode[]) =>
    catalogueFromTree(folder("sx", "3_SxF", [folder("dx", "2_SxF Deluxe Edition", [folder("dpi", "Deluxe Edition (1200 DPI)", files)])])).editions[0]!;

  it("pairs them into one double-faced card in Deluxe", () => {
    const edition = deluxe([file("dx-spec", `${SPECIMEN}.png`), file("dx-lab", `${LAB}.png`), file("dx-sol", "Sol Ring.png")]);
    const pair = edition.cards.find((card) => card.faces.length === 2)!;
    expect(pair.name).toBe(`${SPECIMEN} // ${LAB}`);
    expect(pair.faces.map((face) => face.defaultArt?.id)).toEqual(["dx-spec", "dx-lab"]);
    expect(mains(edition.cards).map((card) => card.name)).toEqual([pair.name, "Sol Ring"]);
    expect(edition.notes.some((note) => note.reason.includes("known double-faced card"))).toBe(true);
  });

  it("pairs them in Partial Foil too", () => {
    const edition = catalogueFromTree(
      folder("pf", "3_SxF Partial Foil Edition", [folder("pdf", "PDF Partial Foil Map", [folder("full", "Full Deck", [file("pf-spec", `${SPECIMEN}.pdf`), file("pf-lab", `${LAB}.pdf`), file("pf-sol", "Sol Ring.pdf")])])]),
    ).editions[0]!;
    const pair = edition.cards.find((card) => card.faces.length === 2)!;
    expect(pair.faces.map((face) => face.defaultArt?.id)).toEqual(["pf-spec", "pf-lab"]);
    expect(mains(edition.cards)).toHaveLength(2);
  });

  it("leaves a Laboratory with no Specimen as it is, and does not touch other unprefixed cards", () => {
    const alone = deluxe([file("dx-lab", `${LAB}.png`), file("dx-sol", "Sol Ring.png")]);
    expect(mains(alone.cards).map((card) => [card.name, card.faces.length])).toEqual([
      [LAB, 1],
      ["Sol Ring", 1],
    ]);
    expect(KNOWN_UNPREFIXED_PAIRS).toEqual([["hydroelectric specimen", "hydroelectric laboratory"]]);
  });

  it("re-pairs a pack that was unlocked and stored before the rename", () => {
    const one = (id: string, name: string): DeckCard => ({ id, name, role: "main", defaultQty: 1, faces: [{ id: `${id}:front`, name, defaultArt: { id: `${id}-art`, name: `${name}.png`, thumbId: `${id}-art`, label: name }, alternates: [] }] });
    const pack: UnlockedPack = {
      packHash: packHash("made-up-folder"),
      savedAt: "2026-11-01T00:00:00.000Z",
      catalogue: { id: "sxf", name: "SxF", creator: "Beespair", editions: [{ id: "deluxe", name: "Deluxe", printType: "standard", cards: [one("main-spec", SPECIMEN), one("main-lab", LAB)], backs: [], notes: [] }] },
    };
    const merged = mergeCatalogues([], [pack]);
    const cards = merged[0]!.editions[0]!.cards;
    expect(cards.map((card) => [card.id, card.faces.length])).toEqual([["main-spec", 2]]);
    expect(pairLooseFaces(cards).cards).toBe(cards);
  });
});

describe("Black and White SxF decks saved in v0.1.27 keep a Black and White Laboratory", () => {
  const specimen = standard.cards.find((card) => card.id === SPECIMEN_ID)!;
  const front = specimen.faces[0]!.defaultArt!.id;
  const labColor = specimen.faces[1]!.defaultArt!.id;
  const labBw = specimen.faces[1]!.alternates[0]!.id;
  const v0127 = (tone: "color" | "bw", cards: SavedDeck["cards"]): SavedDeck => ({
    id: "s",
    name: "SxF · Standard",
    deckId: "sxf",
    deckName: "SxF",
    editionId: "standard",
    editionName: "Standard",
    printType: "standard",
    treatment: null,
    cardbackId: standard.backs[0]!.id,
    tone,
    cards,
    updatedAt: "2026-11-09T00:00:00.000Z",
  });
  const exported = (deck: SavedDeck, edition = standard) =>
    buildXml({ slots: selectionToSlots(edition, deck.cards), cardback: deck.cardbackId ?? standard.backs[0]!.id, deck: "SxF", printType: "standard" });

  it("puts the saved Black and White Laboratory on Specimen's copies, and exports it", () => {
    const loaded = resolveSavedDeck(
      v0127("bw", [
        { cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 2 }] },
        { cardId: OLD_LAB_ID, locked: false, pairs: [{ art: labBw, qty: 1 }] },
      ]),
      [],
      [sxf],
    );
    expect(loaded.deck.cards).toEqual([{ cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 2, back: labBw }] }]);
    const xml = exported(loaded.deck);
    expect(xml).toContain(labBw);
    expect(xml).not.toContain(labColor);
  });

  it("swaps a back of the other tone on Specimen for the saved Black and White Laboratory", () => {
    const loaded = resolveSavedDeck(
      v0127("bw", [
        { cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1, back: labColor }] },
        { cardId: OLD_LAB_ID, locked: false, pairs: [{ art: labBw, qty: 1 }] },
      ]),
      [],
      [sxf],
    );
    expect(loaded.deck.cards[0]!.pairs).toEqual([{ art: front, qty: 1, back: labBw }]);
  });

  it("moves a Laboratory row saved on the Color file onto the Black and White one in a Black and White deck", () => {
    const loaded = resolveSavedDeck(v0127("bw", [{ cardId: OLD_LAB_ID, locked: false, pairs: [{ art: labColor, qty: 1 }] }]), [], [sxf]);
    expect(loaded.deck.cards).toEqual([{ cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1, back: labBw }] }]);
    expect(exported(loaded.deck)).not.toContain(labColor);
  });

  it("gives Specimen the Black and White Laboratory in a Black and White deck saved without a Laboratory row", () => {
    const loaded = resolveSavedDeck(v0127("bw", [{ cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1 }] }]), [], [sxf]);
    expect(loaded.deck.cards[0]!.pairs).toEqual([{ art: front, qty: 1, back: labBw }]);
    expect(exported(loaded.deck)).not.toContain(labColor);
  });

  it("leaves a Color deck's Specimen as it was saved, with the Color Laboratory", () => {
    const loaded = resolveSavedDeck(v0127("color", [{ cardId: SPECIMEN_ID, locked: false, pairs: [{ art: front, qty: 1 }] }]), [], [sxf]);
    expect(loaded.deck.cards[0]!.pairs).toEqual([{ art: front, qty: 1 }]);
    expect(exported(loaded.deck)).toContain(labColor);
    expect(exported(loaded.deck)).not.toContain(labBw);
  });

  it("does the same in a Deluxe pack stored before the rename", () => {
    const art = (id: string, name: string, tone?: "color" | "bw") => ({ id, name: `${name}.png`, thumbId: id, label: name, ...(tone ? { tone } : {}) });
    const pack: UnlockedPack = {
      packHash: packHash("made-up-folder"),
      savedAt: "2026-11-01T00:00:00.000Z",
      catalogue: {
        id: "sxf",
        name: "SxF",
        creator: "Beespair",
        editions: [
          {
            id: "deluxe-1200",
            name: "Deluxe Edition (1200 DPI)",
            printType: "standard",
            cards: [
              { id: "main-spec", name: SPECIMEN, role: "main", defaultQty: 1, faces: [{ id: "main-spec:front", name: SPECIMEN, defaultArt: art("dx-spec-front", SPECIMEN), alternates: [] }] },
              { id: "main-lab", name: LAB, role: "main", defaultQty: 1, faces: [{ id: "main-lab:front", name: LAB, defaultArt: art("dx-lab-color", LAB, "color"), alternates: [art("dx-lab-bwbw", LAB, "bw")] }] },
            ],
            backs: [{ id: "dx-cardback", name: "Card Back", thumbId: "dx-cardback" }],
            notes: [],
          },
        ],
      },
    };
    const merged = mergeCatalogues([], [pack]);
    const edition = merged[0]!.editions.find((item) => (item.sourceId ?? item.id) === "deluxe-1200")!;
    const draft: SavedDeck = {
      ...v0127("bw", [
        { cardId: "main-spec", locked: false, pairs: [{ art: "dx-spec-front", qty: 1 }] },
        { cardId: "main-lab", locked: false, pairs: [{ art: "dx-lab-bwbw", qty: 1 }] },
      ]),
      editionId: "deluxe-1200",
      editionName: "Deluxe Edition (1200 DPI)",
      packHash: pack.packHash,
      cardbackId: "dx-cardback",
    };
    const loaded = resolveSavedDeck(draft, [pack], merged);
    expect(loaded.edition?.cards.find((card) => card.id === "main-spec")?.faces).toHaveLength(2);
    expect(loaded.deck.cards).toEqual([{ cardId: "main-spec", locked: false, pairs: [{ art: "dx-spec-front", qty: 1, back: "dx-lab-bwbw" }] }]);
    const xml = exported(loaded.deck, loaded.edition ?? edition);
    expect(xml).toContain("dx-lab-bwbw");
    expect(xml).not.toContain("dx-lab-color");
  });
});

describe("a folder with both the renamed 1_1_/1_2_ files and the old unprefixed ones", () => {
  it("makes one Hydroelectric card from the renamed files and leaves the old files alone", () => {
    const edition = catalogueFromTree(
      folder("sx", "3_SxF", [
        folder("dx", "2_SxF Deluxe Edition", [
          folder("dpi", "Deluxe Edition (1200 DPI)", [file("new-spec", `1_1_${SPECIMEN}.png`), file("new-lab", `1_2_${LAB}.png`), file("old-spec", `${SPECIMEN}.png`), file("old-lab", `${LAB}.png`)]),
        ]),
      ]),
    ).editions[0]!;
    const doubles = edition.cards.filter((card) => card.faces.length === 2);
    expect(doubles.map((card) => card.faces.map((face) => face.defaultArt?.id))).toEqual([["new-spec", "new-lab"]]);
  });
});

describe("the old unprefixed Hydroelectric files beside the renamed ones", () => {
  const SPEC = "Hydroelectric Specimen (Melinda Desmond, Former First Lady)";
  const LABN = "Hydroelectric Laboratory (Exclusive Circle)";
  it("fold into the renamed card as more arts of the same faces, so there is one Hydroelectric main card", () => {
    const edition = catalogueFromTree(
      folder("sx", "3_SxF", [
        folder("dx", "2_SxF Deluxe Edition", [
          folder("dpi", "Deluxe Edition (1200 DPI)", [file("new-spec", `1_1_${SPEC}.png`), file("new-lab", `1_2_${LABN}.png`), file("old-spec", `${SPEC}.png`), file("old-lab", `${LABN}.png`), file("dx-sol", "Sol Ring.png")]),
        ]),
      ]),
    ).editions[0]!;
    const hydro = mains(edition.cards).filter((card) => /hydroelectric/i.test(card.name));
    expect(hydro).toHaveLength(1);
    expect(hydro[0]!.faces.map((face) => [face.defaultArt?.id, ...face.alternates.map((art) => art.id)])).toEqual([
      ["new-spec", "old-spec"],
      ["new-lab", "old-lab"],
    ]);
    expect(mains(edition.cards)).toHaveLength(2);
  });

  it("fold in too when the renamed faces were still two loose cards, and folding twice changes nothing", () => {
    const one = (id: string, name: string): DeckCard => ({ id, name, role: "main", defaultQty: 1, faces: [{ id: `${id}:front`, name, defaultArt: { id, name, thumbId: id, label: name }, alternates: [] }] });
    const cards = [one("new-spec", `1_1_${SPEC}.png`), one("new-lab", `1_2_${LABN}.png`), one("old-spec", `${SPEC}.png`), one("old-lab", `${LABN}.png`)];
    const paired = pairLooseFaces(cards).cards;
    expect(paired).toHaveLength(1);
    expect(paired[0]!.faces.map((face) => [face.defaultArt?.id, ...face.alternates.map((art) => art.id)])).toEqual([
      ["new-spec", "old-spec"],
      ["new-lab", "old-lab"],
    ]);
    expect(pairLooseFaces(paired).cards).toBe(paired);
  });

  it("fold in from a Color and a Black and White folder too, keeping each file's print set and the fold note", () => {
    const edition = catalogueFromTree(
      folder("sx", "3_SxF", [
        folder("std", "1_SxF Standard Edition", [
          folder("fd", "Full Deck", [
            file("new-spec", `1_1_${SPEC}.jpg`),
            file("old-spec", `${SPEC}.jpg`),
            file("std-sol", "Sol Ring.jpg"),
            folder("opt", "IMPORTANT OPTIONS", [
              folder("bw", "Black and White", [file("new-lab-bw", `1_2_${LABN}.jpg`), file("old-lab-bw", `${LABN}.jpg`)]),
              folder("co", "Color", [file("new-lab-co", `1_2_${LABN}.jpg`), file("old-lab-co", `${LABN}.jpg`)]),
            ]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const hydro = mains(edition.cards).filter((card) => /hydroelectric/i.test(card.name));
    expect(hydro).toHaveLength(1);
    const [front, back] = hydro[0]!.faces;
    expect([front!.defaultArt, ...front!.alternates].map((art) => art!.id)).toEqual(["new-spec", "old-spec"]);
    const backs = [back!.defaultArt, ...back!.alternates].map((art) => [art!.id, art!.tone]);
    expect(backs).toEqual(expect.arrayContaining([["new-lab-bw", "bw"], ["old-lab-co", "color"], ["old-lab-bw", "bw"]]));
    expect(backs.map(([id]) => id).sort()).toEqual(["new-lab-bw", "new-lab-co", "old-lab-bw", "old-lab-co"]);
    expect(mains(edition.cards)).toHaveLength(2);
    expect(edition.notes.some((note) => note.level === "info" && note.reason.startsWith("Added the files without the 1_1_/1_2_ prefix"))).toBe(true);
  });
});
