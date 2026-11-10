import { describe, expect, it } from "vitest";
import { parseDecklist, withDecklist } from "@/lib/decklist";
import { catalogueFromTree } from "@/lib/group";
import { applyListQuantities, countCopies, randomizeUnlocked } from "@/lib/selection";
import { exportSavedJson, importSavedJson, loadSaved, parseDecklists, type SavedDeck } from "@/lib/storage";
import type { RawNode } from "@/lib/types";

const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });

const tree = folder("std", "Fish Standard Edition", [
  folder("full", "Full Deck", [file("sol", "Sol Ring.jpg"), file("signet", "Arcane Signet.jpg"), file("crop", "Command Tower.jpg"), file("is1", "Island 1.jpg"), file("is2", "Island 2.jpg")]),
  folder("extras", "Extras", [folder("sigf", "Arcane Signet", [file("sig2", "Arcane Signet 1.jpg")])]),
]);
const edition = catalogueFromTree(tree, "Fish").editions[0]!;
const id = (name: string) => edition.cards.find((card) => card.name === name)!.id;
const qtyOf = (rows: ReturnType<typeof applyListQuantities>, name: string) => rows.find((row) => row.cardId === id(name))?.pairs.reduce((sum, pair) => sum + pair.qty, 0);

describe("switching deck lists", () => {
  const big = parseDecklist("Deck\n3x Sol Ring\n1x Command Tower\n5x Island\n", "decklist - Big.txt");
  const small = parseDecklist("Deck\n1x Arcane Signet\n", "decklist - Small.txt");

  it("moves counts to the new list, keeps chosen art, and drops basics the new list doesn't ask for", () => {
    const start = applyListQuantities(withDecklist(edition, big), []);
    expect(qtyOf(start, "Sol Ring")).toBe(3);
    expect(qtyOf(start, "Arcane Signet")).toBe(0);
    expect(qtyOf(start, "Island 1")! + qtyOf(start, "Island 2")!).toBe(5);
    const custom = start.map((row) => (row.cardId === id("Sol Ring") ? { ...row, pairs: [{ ...row.pairs[0]!, art: "custom-art" }] } : row));
    const next = applyListQuantities(withDecklist(edition, small), custom);
    expect(qtyOf(next, "Sol Ring")).toBe(0);
    expect(next.find((row) => row.cardId === id("Sol Ring"))!.pairs[0]!.art).toBe("custom-art");
    expect(qtyOf(next, "Arcane Signet")).toBe(1);
    expect(qtyOf(next, "Island 1")).toBe(0);
    expect(qtyOf(next, "Island 2")).toBe(0);
    expect(countCopies(next)).toBe(1);
  });

  it("leaves a locked card exactly as it was", () => {
    const start = applyListQuantities(withDecklist(edition, big), []).map((row) => (row.cardId === id("Sol Ring") ? { ...row, locked: true } : row));
    const next = applyListQuantities(withDecklist(edition, small), start);
    expect(next.find((row) => row.cardId === id("Sol Ring"))).toEqual(start.find((row) => row.cardId === id("Sol Ring")));
  });

  it("keeps two arts of one card as separate rows of counts, trimming from the last", () => {
    const signet = edition.cards.find((card) => card.name === "Arcane Signet")!;
    const arts = [signet.faces[0]!.defaultArt!.id, signet.faces[0]!.alternates[0]!.id];
    const start = [{ cardId: signet.id, locked: false, pairs: [{ art: arts[0]!, qty: 2 }, { art: arts[1]!, qty: 2 }] }];
    const three = applyListQuantities(withDecklist(edition, parseDecklist("Deck\n3x Arcane Signet\n", "decklist.txt")), start);
    expect(three.find((row) => row.cardId === signet.id)!.pairs).toEqual([{ art: arts[0], qty: 2 }, { art: arts[1], qty: 1 }]);
    const six = applyListQuantities(withDecklist(edition, parseDecklist("Deck\n6x Arcane Signet\n", "decklist.txt")), start);
    expect(six.find((row) => row.cardId === signet.id)!.pairs).toEqual([{ art: arts[0], qty: 4 }, { art: arts[1], qty: 2 }]);
  });

  it("Random keeps the list's zeros at zero and its counts", () => {
    const listed = withDecklist(edition, big);
    const rows = randomizeUnlocked(listed, [], () => 0.5);
    expect(qtyOf(rows, "Arcane Signet")).toBe(0);
    expect(qtyOf(rows, "Sol Ring")).toBe(3);
    expect(countCopies(rows)).toBe(countCopies(applyListQuantities(listed, [])));
  });
});

describe("saved decks remember the list and print set", () => {
  const base: SavedDeck = {
    id: "a",
    name: "Mine",
    deckId: "sxf",
    deckName: "SxF",
    editionId: "standard",
    editionName: "Standard",
    printType: "standard",
    treatment: null,
    cardbackId: null,
    printFlipBacksAsFronts: false,
    cards: [{ cardId: "c", locked: false, pairs: [{ art: "x", qty: 1 }] }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("round-trips the chosen list and print set through export and import", () => {
    const saved = { ...base, decklistId: "sxf-operation-strix", tone: "bw" as const };
    expect(importSavedJson(exportSavedJson([saved]))).toEqual([saved]);
  });

  it("still reads a deck saved before lists existed, and drops a bad list id or print set", () => {
    const store = new Map<string, string>([["printabee.savedDecks.v1", JSON.stringify([base, { ...base, id: "b", decklistId: "../../etc", tone: "sepia" }])]]);
    const loaded = loadSaved({ getItem: (key) => store.get(key) ?? null, setItem: () => {}, removeItem: () => {} });
    expect(loaded).toHaveLength(2);
    for (const deck of loaded) {
      expect(deck.decklistId).toBeUndefined();
      expect(deck.tone).toBeUndefined();
    }
  });

  it("names the right app when an import is the wrong kind of file", () => {
    expect(() => importSavedJson(JSON.stringify({ kind: "other" }))).toThrow(/BeeLine saved-deck export/);
  });

  it("keeps stored deck lists, sideboard included, and rejects junk", () => {
    const vader = parseDecklist("Commander\n1x Vader\nDeck\n1x Sol Ring\nSideboard\n1x Rakdos Signet\n", "decklist - Vader.txt");
    expect(parseDecklists(JSON.parse(JSON.stringify([vader, { id: 3 }, null])))).toEqual([vader]);
    expect(parseDecklists("nope")).toEqual([]);
  });
});
