import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyListQuantities, newPair, randomizeUnlocked, selectAllCards, toneBackId, toneCardBacks } from "@/lib/selection";
import type { DeckCatalogue } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const sxf = JSON.parse(readFileSync(path.join(root, "public/decks/sxf.json"), "utf8")) as DeckCatalogue;
const standard = sxf.editions[0]!;
const specimen = standard.cards.find((card) => card.id === "main-hydroelectric-specimen-melinda-desmond-former-first-lady")!;
const labColor = specimen.faces[1]!.defaultArt!.id;
const labBw = specimen.faces[1]!.alternates[0]!.id;
const gold = standard.cards.find((card) => card.name === "Token - Gold 1")!;
const goldColor = gold.faces[0]!.defaultArt!.id;
const goldBw = gold.faces[0]!.alternates[0]!.id;
const treasure3 = standard.cards.find((card) => card.name === "Black and White")!.faces[0]!.defaultArt!.id;

describe("new rows start on the back face in the deck's tone", () => {
  it("picks the back face file in the tone, and the default file without one", () => {
    expect(toneBackId(specimen, "bw")).toBe(labBw);
    expect(toneBackId(specimen, "color")).toBe(labColor);
    expect(toneBackId(specimen, null)).toBe(labColor);
    expect(toneBackId(gold, "bw")).toBe("");
    expect(newPair(specimen, 1, "bw")).toEqual({ art: specimen.faces[0]!.defaultArt!.id, qty: 1, back: labBw });
    expect(newPair(gold, 2, "bw")).toEqual({ art: goldColor, qty: 2 });
  });

  it("uses it in All cards, in a new deck list, and in Random", () => {
    const all = selectAllCards(standard, [], "bw").find((row) => row.cardId === specimen.id)!;
    expect(all.pairs[0]!.back).toBe(labBw);
    const listed = applyListQuantities(standard, [], "bw").find((row) => row.cardId === specimen.id)!;
    expect(listed.pairs[0]!.back).toBe(labBw);
    expect(applyListQuantities(standard, []).find((row) => row.cardId === specimen.id)!.pairs[0]!.back).toBe(labColor);
    const random = randomizeUnlocked(standard, [], () => 0, "bw").find((row) => row.cardId === specimen.id)!;
    expect(random.pairs[0]!.back).toBe(labBw);
  });
});

describe("a per-card back pick follows a tone switch", () => {
  it("moves a Color token pick to the same token's Black and White file and back", () => {
    const bw = toneCardBacks(standard, { [specimen.id]: goldColor }, "bw");
    expect(bw).toEqual({ [specimen.id]: goldBw });
    expect(toneCardBacks(standard, bw, "color")).toEqual({ [specimen.id]: goldColor });
  });

  it("keeps card backs, files with no version in the new tone, and decks without picks as they are", () => {
    const backs = { [specimen.id]: standard.backs[0]!.id, [gold.id]: treasure3 };
    expect(toneCardBacks(standard, backs, "color")).toBe(backs);
    expect(toneCardBacks(standard, backs, "bw")).toBe(backs);
    expect(toneCardBacks(standard, undefined, "bw")).toBeUndefined();
  });
});
