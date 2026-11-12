import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { treatmentsFor } from "@/data/treatments";
import { freshDraft } from "@/lib/draft";
import { artIdsOf, pdfIdsInEdition } from "@/lib/group";
import { CARD_LOOKUP } from "@/data/card-lookup";
import { factsFor } from "@/lib/card-facts";
import { matchCard, parseQuery } from "@/lib/card-filter";
import { clearCounts } from "@/lib/clear";
import { isBasicCard } from "@/lib/decklist";
import { applyTone, copyCount, hasToneChoice, selectionToSlots } from "@/lib/selection";
import { canShowFoil, foilMapsMissing, foilView } from "@/lib/foil-maps";
import { mergeRestored, readRestoreCode } from "@/lib/restore-code";
import { LAST_SESSION_KEY, loadLastSession, loadSaved, loadUnlocked, packForStorage, resolveSavedDeck, UNLOCK_KEY, writeLastSession, writeSaved, writeUnlocked, type SavedDeck } from "@/lib/storage";
import type { DeckCatalogue, Edition } from "@/lib/types";
import { assertIdsAllowed, splitExportByPrintType } from "@/lib/xml";

/**
 * Saves made and loaded by v0.1.35's own code (fixtures/v0135-saves.json, recorded with
 * logs/golden_v0135.mts in the v0.1.35 source tree, 4a4491e): the seventeen cases of the v0.1.34 golden,
 * plus two made for v0.1.36: KPDH's opening deck with the last deck back and a per-card back, and TMNT
 * mid-build with tokens and an extra raised and a treatment. Each one goes through localStorage the way
 * the app does it, then the builder's Export XML steps. v0.1.36 must store, load and print every one of
 * them exactly as v0.1.35 did, and every shipped deck's opening XML must match too. The "unlocks" part is
 * a Partial Foil unlock (made-up fixture, fake ids) as v0.1.35 stored it, with the restore code v0.1.35
 * made for it: v0.1.36 must read both unchanged, and treat the unlock as one with no foil maps yet.
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
const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/v0135-saves.json"), "utf8")) as { recordedWith: string; cases: Golden[]; fresh: Record<string, string>; unlocks: { stored: string; restoreCode: string; editions: Array<[string, string, number]> } };
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

describe("saves store, load and print exactly as v0.1.35 did", () => {
  it("was recorded with v0.1.35 and covers the v0.1.34 cases plus KPDH with backs and TMNT mid-build", () => {
    expect(golden.recordedWith).toBe("v0.1.35 (4a4491e)");
    expect(golden.cases.map((item) => [item.deck, item.tone])).toEqual([["sxf", "color"], ["sxf", "bw"], ["sxf", "bw"], ["sxf", null], ["tmnt", null], ["persona-5", null], ["x-men", null], ["tmnt", null], ["sxf", "bw"], ["persona-5", null], ["nier", null], ["floating-world", null], ["dr-eggman", null], ["dr-eggman", null], ["dr-eggman", null], ["dr-eggman", null], ["x-men", null], ["kpdh", null], ["tmnt", null]]);
    // KPDH: the opening 100 with one per-card back; TMNT: 100 less one, plus 2 + 3 tokens and one extra.
    expect(golden.cases[17]!.copies).toBe(100);
    expect(Object.keys(golden.cases[17]!.cardBacks ?? {})).toHaveLength(1);
    expect(golden.cases[18]!.copies).toBe(105);
    expect(golden.cases[18]!.save.treatment).not.toBeNull();
    // Recorded with v0.1.34's Dr. Eggman, "every extra" now means all 16 (the two new ones too): 100 main, 16 extras once each, two tokens twice each.
    expect(golden.cases[12]!.copies).toBe(120);
    expect(golden.cases[12]!.save.cards.filter((card) => card.cardId.startsWith("extra-"))).toHaveLength(16);
    expect(JSON.stringify(golden.cases[12]!.save)).toMatch(/extra-cryptothrall-2[\s\S]*extra-scrap-trawler-2/);
    for (const item of golden.cases.slice(13, 15)) expect(JSON.stringify(item.save)).not.toMatch(/extra-cryptothrall-2|extra-scrap-trawler-2/);
    // The new extras: Cryptothrall 2 once, Scrap Trawler 2 twice, and each one the back of a main card.
    const eggman = deck("dr-eggman").editions[0]!;
    const newArt = (id: string) => eggman.cards.find((card) => card.id === id)!.faces[0]!.defaultArt!.id;
    expect(golden.cases[15]!.copies).toBe(103);
    expect(Object.values(golden.cases[15]!.cardBacks ?? {})).toEqual([newArt("extra-cryptothrall-2"), newArt("extra-scrap-trawler-2")]);
    // X-Men mid-build: one card up to 4, one down to 0, from 100.
    expect(golden.cases[16]!.copies).toBe(102);
    expect(Object.keys(golden.cases[16]!.cardBacks ?? {})).toHaveLength(1);
    // NieR: one back on a double-faced card, one on a one-faced card.
    expect(Object.keys(golden.cases[10]!.cardBacks ?? {})).toHaveLength(2);
    // Floating World opens at 188; Clear shown on is:basic took the basics out.
    expect(golden.cases[11]!.copies).toBe(166);
    expect(golden.cases.filter((item) => item.save.cards.some((card) => card.cardId.startsWith("main-hydroelectric-specimen")))).toHaveLength(4);
    // Clear shown on t:creature c:u mv<=3 took Hydroelectric Specimen (a blue 3-mana creature) out of that save.
    expect(golden.cases[8]!.save.cards.some((card) => card.cardId.startsWith("main-hydroelectric-specimen"))).toBe(false);
  });

  for (const item of golden.cases) {
    it(`matches v0.1.35: ${item.name}`, () => {
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

  it("clears the same cards as v0.1.35 did for the Clear shown saves", () => {
    for (const [index, query] of [[8, "t:creature c:u mv<=3"], [9, "is:basic"], [11, "is:basic"], [14, "t:creature"]] as const) {
      const item = golden.cases[index]!;
      const catalogue = deck(item.deck);
      const edition = catalogue.editions[0]!;
      const draft = freshDraft(catalogue, edition, "x", new Date("2026-11-10T12:00:00.000Z"));
      const start = item.tone === "bw" ? applyTone(edition, draft.cards, "bw") : draft.cards;
      const filter = parseQuery(query).filter;
      const byId = new Map(start.map((card) => [card.cardId, card]));
      const shown = new Set(
        edition.cards
          .filter((card) => {
            const { status, facts } = factsFor(card, CARD_LOOKUP);
            const names = [card.name, ...card.faces.map((face) => face.name), ...(facts ? [facts.scryfall] : [])];
            return matchCard({ names, role: card.role, dfc: card.faces.length === 2, basic: isBasicCard(card), copies: copyCount(byId.get(card.id)), status, facts }, filter) === "shown";
          })
          .map((card) => card.id),
      );
      expect(clearCounts(start, shown), query).toEqual(item.save.cards);
    }
  });

  it("prints every shipped deck's opening deck (and SxF's Black and White one) as v0.1.35 did", () => {
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

  it("reopens these saves through Continue exactly as they load from the saved list", () => {
    // Saves from v0.1.35 may have no Continue record: Continue offers the newest of them, unchanged.
    const store = memory();
    const saves = golden.cases.map((item, index) => ({ ...item.save, updatedAt: `2026-11-${String(10 + (index % 7)).padStart(2, "0")}T00:00:${String(index).padStart(2, "0")}.000Z` }));
    writeSaved(store, saves);
    const list = loadSaved(store);
    const newest = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]!;
    expect(loadLastSession(store, list)).toEqual(newest);
    // A deck being built is kept and read back byte for byte, and prints the same XML as its save.
    for (const index of [15, 16, 18]) {
      const item = golden.cases[index]!;
      const catalogue = deck(item.deck);
      const keep = memory();
      writeLastSession(keep, item.save);
      expect(keep.map.get(LAST_SESSION_KEY)).toBe(JSON.stringify(item.save));
      const back = loadLastSession(keep, [])!;
      const loaded = resolveSavedDeck(back, [], [catalogue]);
      expect(sha(JSON.stringify(loaded.deck))).toBe(item.sha256.loaded);
      expect(sha(exportXml(loaded.edition!, loaded.deck))).toBe(item.sha256.xml);
    }
  });

  it("reads a Partial Foil unlock stored by v0.1.35 unchanged, as an unlock with no foil maps yet", () => {
    const store = memory();
    store.setItem(UNLOCK_KEY, golden.unlocks.stored);
    const packs = loadUnlocked(store);
    expect(packs).toHaveLength(1);
    expect(packs[0]!.catalogue.editions.map((edition) => [edition.id, edition.printType, edition.cards.length])).toEqual(golden.unlocks.editions);
    const again = memory();
    writeUnlocked(again, packs);
    expect(again.map.get(UNLOCK_KEY)).toBe(golden.unlocks.stored);
    const partial = packs[0]!.catalogue.editions.find((edition) => edition.printType === "partial_foil")!;
    expect(canShowFoil(partial)).toBe(true);
    expect(foilMapsMissing(partial)).toBe(true);
    expect(foilView(partial)).toBe(partial);
    expect(packs[0]!.refreshedAt).toBeUndefined();
  });

  it("reads v0.1.35's restore code for it, and an older code never replaces a newer read of the same folder", async () => {
    const fromCode = await readRestoreCode(golden.unlocks.restoreCode);
    const store = memory();
    store.setItem(UNLOCK_KEY, golden.unlocks.stored);
    const stored = loadUnlocked(store);
    expect(fromCode.map(packForStorage)).toEqual(stored.map(packForStorage));
    const newer = { ...stored[0]!, refreshedAt: "2026-11-12T09:00:00.000Z", catalogue: { ...stored[0]!.catalogue, name: "Read again" } };
    const merged = mergeRestored([newer], fromCode);
    expect(merged).toMatchObject({ added: 0, refreshed: 0, kept: 1 });
    expect(merged.packs[0]!.catalogue.name).toBe("Read again");
  });
});
