import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectionToSlots } from "@/lib/selection";
import { resolveSavedDeck, type SavedDeck } from "@/lib/storage";
import type { DeckCatalogue } from "@/lib/types";
import { buildXml } from "@/lib/xml";

/**
 * Old saves of double-faced cards with a separate back row, loaded and exported by v0.1.27's own
 * code (fixtures/v0127-reconcile.json). Only SxF's renamed Hydroelectric pair may load differently
 * in v0.1.28; every other deck must give exactly the same cards and XML.
 */
const root = path.resolve(import.meta.dirname, "../..");
type Golden = { name: string; deck: string; save: SavedDeck; loaded: SavedDeck["cards"]; note: string | null; xml: string };
const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/v0127-reconcile.json"), "utf8")) as { cases: Golden[] };
const deck = (id: string) => JSON.parse(readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8")) as DeckCatalogue;

describe("old saves outside SxF load and export exactly as v0.1.27 did", () => {
  it("covers X-Men Joshua, NieR, Persona 5 Terra, Silksong and TMNT", () => {
    expect(golden.cases.map((item) => item.deck)).toEqual(["x-men", "x-men", "nier", "persona-5", "silksong", "silksong", "tmnt"]);
  });

  for (const item of golden.cases) {
    it(`matches v0.1.27: ${item.name}`, () => {
      const loaded = resolveSavedDeck(item.save, [], [deck(item.deck)]);
      expect(loaded.edition).not.toBeNull();
      expect(loaded.deck.cards).toEqual(item.loaded);
      expect(loaded.note).toBe(item.note);
      const slots = selectionToSlots(loaded.edition!, loaded.deck.cards, { printFlipBacksAsFronts: false });
      expect(buildXml({ slots, cardback: item.save.cardbackId!, deck: item.name, printType: "standard" })).toBe(item.xml);
    });
  }
});
