import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { treatmentsFor } from "@/data/treatments";
import { freshDraft } from "@/lib/draft";
import { artIdsOf, pdfIdsInEdition } from "@/lib/group";
import { applyTone, hasToneChoice, selectionToSlots } from "@/lib/selection";
import { loadSaved, resolveSavedDeck, writeSaved, type SavedDeck } from "@/lib/storage";
import type { DeckCatalogue, Edition } from "@/lib/types";
import { assertIdsAllowed, splitExportByPrintType } from "@/lib/xml";

/**
 * Saves made and loaded by v0.1.28's own code (fixtures/v0128-saves.json, recorded with
 * logs/golden_v0128.mts in the v0.1.28 source tree). Each one goes through localStorage the way the
 * app does it, then the builder's Export XML steps. v0.1.29 must store, load and print every one of
 * them exactly as v0.1.28 did: real SxF Color and Black and White decks (Hydroelectric included),
 * per-card backs, treatments, an empty deck, and every shipped deck's opening XML.
 */
const root = path.resolve(import.meta.dirname, "../..");
type Golden = {
  name: string;
  deck: string;
  save: SavedDeck;
  note: string | null;
  copies: number;
  tone: string | null;
  cardBacks: Record<string, string> | null;
  sha256: { stored: string; loaded: string; restored: string; xml: string };
  xmlLength: number;
};
const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/v0128-saves.json"), "utf8")) as { recordedWith: string; cases: Golden[]; fresh: Record<string, string> };
const deck = (id: string) => JSON.parse(readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8")) as DeckCatalogue;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const KEY = "printabee.savedDecks.v1";
const memory = () => {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
};

/** The builder's Export XML, step for step. */
function exportXml(edition: Edition, draft: SavedDeck): string {
  const cardback = draft.cardbackId || edition.backs[0]?.id || "";
  const slots = selectionToSlots(edition, draft.cards, { printFlipBacksAsFronts: draft.printFlipBacksAsFronts === true, cardBacks: draft.cardBacks, cardback });
  assertIdsAllowed(slots, cardback, artIdsOf(edition));
  const treatment = treatmentsFor(edition.printType).some((item) => item.name === draft.treatment) ? draft.treatment : null;
  const [xml] = splitExportByPrintType({ slots: slots.map((slot) => ({ ...slot, printType: edition.printType })), cardback, deck: draft.deckName, treatment, foil: Boolean(treatment), stock: "(S30) Standard Smooth", pdfIds: pdfIdsInEdition(edition) });
  return xml ?? "";
}

describe("saves store, load and print exactly as v0.1.28 did", () => {
  it("was recorded with v0.1.28 and covers SxF Color and Black and White, TMNT, Persona 5 and an empty deck", () => {
    expect(golden.recordedWith).toBe("v0.1.28 (1c0a15a)");
    expect(golden.cases.map((item) => [item.deck, item.tone])).toEqual([["sxf", "color"], ["sxf", "bw"], ["sxf", "bw"], ["sxf", null], ["tmnt", null], ["persona-5", null], ["x-men", null]]);
    expect(golden.cases.filter((item) => item.save.cards.some((card) => card.cardId.startsWith("main-hydroelectric-specimen")))).toHaveLength(4);
  });

  for (const item of golden.cases) {
    it(`matches v0.1.28: ${item.name}`, () => {
      const catalogue = deck(item.deck);
      const store = memory();
      writeSaved(store, [item.save]);
      expect(sha(store.map.get(KEY)!)).toBe(item.sha256.stored);
      const [read] = loadSaved(store);
      const loaded = resolveSavedDeck(read!, [], [catalogue]);
      expect(loaded.note).toBe(item.note);
      expect(loaded.deck.tone ?? null).toBe(item.tone);
      expect(loaded.deck.cardBacks ?? null).toEqual(item.cardBacks);
      expect(loaded.deck.cards.reduce((sum, card) => sum + card.pairs.reduce((n, pair) => n + pair.qty, 0), 0)).toBe(item.copies);
      expect(sha(JSON.stringify(loaded.deck))).toBe(item.sha256.loaded);
      const again = memory();
      writeSaved(again, [loaded.deck]);
      expect(sha(again.map.get(KEY)!)).toBe(item.sha256.restored);
      const xml = exportXml(loaded.edition!, loaded.deck);
      expect(xml.length).toBe(item.xmlLength);
      expect(sha(xml)).toBe(item.sha256.xml);
    });
  }

  it("prints every shipped deck's opening deck (and SxF's Black and White one) as v0.1.28 did", () => {
    expect(Object.keys(golden.fresh)).toHaveLength(12);
    const now: Record<string, string> = {};
    for (const key of Object.keys(golden.fresh)) {
      const [id, editionId, bw] = key.split("/");
      const catalogue = deck(id!);
      const edition = catalogue.editions.find((item) => item.id === editionId)!;
      const draft = freshDraft(catalogue, edition, `golden-${id}`, new Date("2026-11-10T12:00:00.000Z"));
      const toned = bw ? { ...draft, tone: "bw" as const, cards: applyTone(edition, draft.cards, "bw") } : draft;
      if (bw) expect(hasToneChoice(edition)).toBe(true);
      try {
        now[key] = sha(exportXml(edition, toned));
      } catch (error) {
        now[key] = `error: ${(error as Error).message}`;
      }
    }
    expect(now).toEqual(golden.fresh);
  });
});
