import { describe, expect, it } from "vitest";
import { catalogueFromTree } from "@/lib/group";
import { queryFor } from "@/lib/names";
import { copyCount, designedSelection, droppedSavedCardIds, oversizedDeckWarning, randomizeUnlocked, selectAllCards, selectionToSlots } from "@/lib/selection";
import { buildXml } from "@/lib/xml";
import type { RawNode } from "@/lib/types";

const tree: RawNode = {
  id: "editionroot1",
  name: "1_ Silksong Standard Edition",
  folder: true,
  children: [
    {
      id: "fulldeck0001",
      name: "Full Deck",
      folder: true,
      children: [
        { id: "cardback12345", name: "Card Back", folder: true, children: [{ id: "backimage1234", name: "Card Back 1.jpg", folder: false }] },
        { id: "solringfile1", name: "Sol Ring.jpg", folder: false },
        { id: "islandfile01", name: "Island.jpg", folder: false },
      ],
    },
    {
      id: "extras000001",
      name: "Extras",
      folder: true,
      children: [
        {
          id: "solfolder001",
          name: "Sol Ring",
          folder: true,
          children: [
            { id: "solalt000001", name: "Sol Ring 1.jpg", folder: false },
            { id: "solalt000002", name: "Sol Ring 2.jpg", folder: false },
          ],
        },
        { id: "alelafile001", name: "Alela, Artful Provocateur.jpg", folder: false },
      ],
    },
  ],
};

describe("selection", () => {
  const edition = catalogueFromTree(tree).editions[0]!;

  it("keeps locked cards still while random rerolls the others", () => {
    const designed = designedSelection(edition);
    const sol = designed.find((card) => edition.cards.find((item) => item.id === card.cardId)?.name === "Sol Ring")!;
    sol.locked = true;
    sol.pairs = [{ art: "solringfile1", qty: sol.pairs[0]?.qty ?? 1 }];
    const rolled = randomizeUnlocked(edition, designed, () => 0.99);
    const solAfter = rolled.find((card) => card.cardId === sol.cardId)!;
    const island = edition.cards.find((card) => card.name === "Island")!;
    const islandAfter = rolled.find((card) => card.cardId === island.id)!;
    expect(solAfter.pairs[0]?.art).toBe("solringfile1");
    expect(islandAfter.locked).toBe(false);
    expect(rolled.find((card) => card.cardId === sol.cardId)!.locked).toBe(true);
  });

  it("uses the card name for the query and leaves the art theme out", () => {
    expect(queryFor("Marsh Flats (Greymoor)")).toBe("marsh flats");
    expect(queryFor("Teferi's Protection (Bench) 1.jpg")).toBe("teferi protection");
  });

  it("warns when the designed main deck is over 100 cards and stays quiet at 86", () => {
    const many = {
      ...edition,
      cards: Array.from({ length: 101 }, (_, index) => ({ ...edition.cards[0]!, id: `card-${index}`, role: "main" as const })),
    };
    expect(oversizedDeckWarning(many)).toMatch(/101 main cards/);
    const exact = {
      ...edition,
      cards: Array.from({ length: 100 }, (_, index) => ({ ...edition.cards[0]!, id: `card-${index}`, role: "main" as const, defaultQty: 1 })),
    };
    expect(oversizedDeckWarning(exact)).toBeNull();
    const zeroed = {
      ...edition,
      cards: [
        { ...edition.cards[0]!, id: "keep", role: "main" as const, defaultQty: 1 },
        ...Array.from({ length: 120 }, (_, index) => ({ ...edition.cards[0]!, id: `zero-${index}`, role: "main" as const, defaultQty: 0 })),
      ],
    };
    expect(zeroed.cards.length).toBeGreaterThan(100);
    expect(oversizedDeckWarning(zeroed)).toBeNull();
    expect(oversizedDeckWarning({ ...edition, cards: edition.cards.slice(0, 1) })).toBeNull();
  });

  it("all cards adds extras, and the designed export stays on the main deck", () => {
    const all = selectAllCards(edition, designedSelection(edition));
    expect(all).toHaveLength(edition.cards.length);
    expect(all.every((card) => card.pairs.length >= 1)).toBe(true);
    const hand = designedSelection(edition).map((card, index) => (index === 0 ? { ...card, pairs: [{ art: card.pairs[0]!.art, qty: 4 }, { art: "second-art", qty: 2 }] } : card));
    const kept = selectAllCards(edition, hand);
    expect(kept[0]!.pairs).toEqual(hand[0]!.pairs);
    const locked = randomizeUnlocked(edition, hand.map((card, index) => (index === 0 ? { ...card, locked: true } : card)), () => 0.99);
    expect(locked[0]!.pairs).toEqual(hand[0]!.pairs);
    expect(locked[0]!.locked).toBe(true);
    const rerolled = randomizeUnlocked(edition, hand, () => 0);
    expect(copyCount(rerolled[0])).toBe(6);
    expect(copyCount({ cardId: "x", locked: false, pairs: [{ art: "a", qty: 2 }, { art: "b", qty: 3 }, { art: "c", qty: 0 }] })).toBe(5);
    expect(copyCount({ cardId: "x", locked: false, pairs: [{ art: "a", qty: 2 }, { art: "b", qty: -4 }] })).toBe(2);
    const bw = {
      ...edition,
      cards: edition.cards.map((card, index) => (index === 0 ? { ...card, bwOnly: true, role: "main" as const } : card)),
    };
    const skipped = randomizeUnlocked(bw, [], () => 0.99);
    expect(skipped[0]!.pairs[0]!.qty).toBe(0);
    const keptBw = randomizeUnlocked(bw, [{ cardId: bw.cards[0]!.id, locked: false, pairs: [{ art: "picked-bw", qty: 2 }] }], () => 0.99);
    expect(keptBw[0]!.pairs).toEqual([{ art: "picked-bw", qty: 2 }]);
    const slots = selectionToSlots(edition, designedSelection(edition));
    const xml = buildXml({
      slots,
      cardback: "backimage1234",
      deck: "Silksong",
      printType: "standard",
      treatment: "Standard Holo Galaxy",
      foil: true,
    });
    expect(xml).toContain("<quantity>2</quantity>");
    expect(xml).toContain("solringfile1");
    expect(xml).not.toContain("alelafile001");
    expect(xml).toContain("<treatment>Standard Holo Galaxy</treatment>");
  });

  it("exports in edition order and keeps a stored quantity of zero", () => {
    const [first, second] = edition.cards.filter((card) => card.role === "main");
    const designed = designedSelection({ ...edition, cards: [{ ...second!, defaultQty: 0 }, first!] });
    expect(designed.map((card) => card.pairs[0]!.qty)).toEqual([0, 1]);
    const saved = [
      { cardId: second!.id, locked: false, pairs: [{ art: "", qty: 1 }] },
      { cardId: first!.id, locked: false, pairs: [{ art: "", qty: 2 }] },
    ];
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!;
    const island = edition.cards.find((card) => card.name === "Island")!;
    const slots = selectionToSlots(edition, [
      { cardId: island.id, locked: false, pairs: [{ art: "", qty: 1 }] },
      { cardId: sol.id, locked: false, pairs: [{ art: sol.faces[0]!.defaultArt!.id, qty: 1 }, { art: "solalt000002", qty: 1 }] },
    ]);
    expect(slots.map((slot) => slot.front.id)).toEqual([sol.faces[0]!.defaultArt!.id, "solalt000002", island.faces[0]!.defaultArt!.id]);
    const stale = [...saved, { cardId: "missing-row", locked: false, pairs: [{ art: "", qty: 4 }] }];
    expect(droppedSavedCardIds(edition, stale)).toContain("missing-row");
    expect(selectionToSlots(edition, stale)).toHaveLength(slots.length);
    const duplicate = [
      { cardId: first!.id, locked: false, pairs: [{ art: first!.faces[0]!.defaultArt!.id, qty: 2 }] },
      { cardId: first!.id, locked: false, pairs: [{ art: "other-art", qty: 9 }] },
    ];
    expect(droppedSavedCardIds(edition, duplicate)).toEqual([]);
    expect(selectionToSlots(edition, duplicate).length).toBeGreaterThan(2);
  });

  it("stores the default back on a double-faced pair and prints a chosen back", () => {
    const dfc = catalogueFromTree({
      id: "dfc-root",
      name: "1_Example Standard Edition",
      folder: true,
      children: [
        {
          id: "dfc-full",
          name: "Full Deck",
          folder: true,
          children: [
            { id: "dfc-front-1", name: "1_1_Terra, Magical Adept.jpg", folder: false },
            { id: "dfc-back-01", name: "1_2_Esper Terra.jpg", folder: false },
          ],
        },
      ],
    }).editions[0]!;
    const card = dfc.cards.find((item) => item.name.includes("Terra"))!;
    const designed = designedSelection(dfc).find((item) => item.cardId === card.id)!;
    expect(designed.pairs[0]!.back).toBe("dfc-back-01");
    const picked = [{ cardId: card.id, locked: false, pairs: [{ art: "dfc-front-1", back: "dfc-back-01", qty: 1 }] }];
    expect(selectionToSlots(dfc, picked)[0]?.back?.id).toBe("dfc-back-01");
  });
});
