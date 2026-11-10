import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPPED_DECKLISTS, withShippedLists } from "../../scripts/attach-decklists";
import { findDecklist, quantitiesFromDecklist, withDecklist } from "@/lib/decklist";
import { freshDraft, openingCopies } from "@/lib/draft";
import { applyTone, countCopies, hasToneChoice, selectionToSlots } from "@/lib/selection";
import type { DeckCatalogue } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const index = JSON.parse(readFileSync(path.join(root, "public/decks/index.json"), "utf8")) as { decks: { id: string; file: string }[] };
const deck = (id: string) => JSON.parse(readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8")) as DeckCatalogue;
const standard = (id: string) => deck(id).editions.find((edition) => edition.id === "standard")!;
const readList = (file: string) => readFileSync(path.join(root, "decklists", file), "utf8");

describe("shipped deck lists", () => {
  it("are exactly the parsed text files, and every shipped deck has an entry", () => {
    expect(Object.keys(SHIPPED_DECKLISTS).sort()).toEqual(index.decks.map((entry) => entry.id).sort());
    for (const entry of index.decks) {
      const shipped = deck(entry.id);
      expect(withShippedLists(shipped, readList)).toEqual(shipped);
    }
  });

  it("label each dropdown entry from its file name", () => {
    const labels = Object.fromEntries(index.decks.map((entry) => [entry.id, (standard(entry.id).decklists ?? []).map((list) => list.label)]));
    expect(labels).toEqual({
      "dr-eggman": ["Eggman"],
      "floating-world": [
        "Floating World 25",
        "Floating World Complete Collection",
        "Floating World Fish of '97",
        "Floating World Fish of Heat",
        "Floating World Fish of Legends",
        "Floating World Fish of Lies",
      ],
      "horror-movie-poster-secret-lair": [],
      kpdh: ["KPDH - HUNTRX"],
      nier: ["NieR"],
      "persona-5": ["Persona 5"],
      silksong: ["Silksong"],
      sxf: ["SxF - Operation Strix"],
      tmnt: ["TMNT"],
      vader: ["Vader"],
      "x-men": ["X-Men"],
    });
  });

  it("do not include a Dandan deck or a Horror list", () => {
    expect(index.decks.some((entry) => /dandan/i.test(entry.id))).toBe(false);
    expect(standard("horror-movie-poster-secret-lair").decklists).toBeUndefined();
  });

  it("open each Standard deck on its list's counts", () => {
    const totals: Record<string, number> = {};
    for (const entry of index.decks) {
      const shipped = deck(entry.id);
      const edition = shipped.editions.find((item) => item.id === "standard")!;
      for (const list of edition.decklists ?? []) totals[`${entry.id} · ${list.label}`] = quantitiesFromDecklist(edition, list).total;
      totals[`${entry.id} · opens`] = countCopies(freshDraft(shipped, edition, "id", new Date(0)).cards);
    }
    expect(totals).toEqual({
      "dr-eggman · Eggman": 100,
      "dr-eggman · opens": 100,
      // Each list's total, less the lines with no file in the Standard folder (see the next test).
      "floating-world · Floating World 25": 70,
      "floating-world · Floating World Complete Collection": 188,
      "floating-world · Floating World Fish of '97": 52,
      "floating-world · Floating World Fish of Heat": 66,
      "floating-world · Floating World Fish of Legends": 70,
      "floating-world · Floating World Fish of Lies": 50,
      "floating-world · opens": 188,
      "horror-movie-poster-secret-lair · opens": 9,
      "kpdh · KPDH - HUNTRX": 100,
      "kpdh · opens": 100,
      "nier · NieR": 100,
      "nier · opens": 100,
      "persona-5 · Persona 5": 100,
      "persona-5 · opens": 100,
      "silksong · Silksong": 100,
      "silksong · opens": 100,
      "sxf · SxF - Operation Strix": 100,
      "sxf · opens": 100,
      "tmnt · TMNT": 100,
      "tmnt · opens": 100,
      "vader · Vader": 100,
      "vader · opens": 100,
      "x-men · X-Men": 100,
      "x-men · opens": 100,
    });
  });

  it("only leave out a list line when the folder has no file for it", () => {
    const missing: Record<string, string[]> = {};
    for (const entry of index.decks) {
      const edition = standard(entry.id);
      for (const list of edition.decklists ?? []) {
        const names = quantitiesFromDecklist(edition, list).missing.map((line) => `${line.qty}x ${line.name}`);
        if (names.length) missing[list.label] = names;
      }
    }
    expect(missing).toEqual({
      "Floating World 25": ["10x Dandan"],
      "Floating World Complete Collection": ["10x Dandan", "2x Filigree Familiar", "10x Red Herring", "2x Slash Panther"],
      "Floating World Fish of '97": ["8x Dandan"],
      "Floating World Fish of Heat": ["2x Filigree Familiar", "10x Red Herring", "2x Slash Panther"],
      "Floating World Fish of Legends": ["10x Dandan"],
    });
  });

  it("open exactly the basic lands each list asks for, and no unlisted basic art", () => {
    const BASIC = /^(?:\d+\s+)?(?:basic\s+)?(?:snow[- ]covered\s+)?(plains|island|swamp|mountain|forest|wastes)\d*\b/i;
    for (const entry of index.decks) {
      const edition = standard(entry.id);
      for (const list of edition.decklists ?? []) {
        const listed = withDecklist(edition, list);
        const opened: Record<string, number> = {};
        for (const card of listed.cards) {
          const type = card.role === "main" ? BASIC.exec(card.name)?.[1]?.toLowerCase() : undefined;
          if (type) opened[type] = (opened[type] ?? 0) + card.defaultQty;
        }
        const asked: Record<string, number> = {};
        for (const line of [...list.commander, ...list.main]) {
          const type = BASIC.exec(line.name)?.[1]?.toLowerCase();
          if (type) asked[type] = (asked[type] ?? 0) + line.qty;
        }
        for (const type of new Set([...Object.keys(opened), ...Object.keys(asked)])) {
          if (!opened[type] && !asked[type]) continue;
          expect(opened[type] ?? 0, `${entry.id} ${list.label} ${type}`).toBe(asked[type] ?? 0);
        }
      }
    }
  });

  it("show the default list's opening total on the homepage, not the number of main cards", () => {
    const totals = Object.fromEntries(index.decks.map((entry) => [entry.id, openingCopies(standard(entry.id))]));
    expect(totals["floating-world"]).toBe(188);
    expect(totals.sxf).toBe(100);
    expect(totals.tmnt).toBe(100);
    expect(totals["horror-movie-poster-secret-lair"]).toBe(9);
    for (const entry of index.decks) {
      const shipped = deck(entry.id);
      const edition = standard(entry.id);
      expect(totals[entry.id], entry.id).toBe(countCopies(freshDraft(shipped, edition, "id", new Date(0)).cards));
    }
  });
});

describe("Horror Movie Poster Secret Lair", () => {
  it("has no list and opens every image at its default count", () => {
    const shipped = deck("horror-movie-poster-secret-lair");
    const edition = shipped.editions[0]!;
    const draft = freshDraft(shipped, edition, "id", new Date(0));
    expect(draft.decklistId).toBeUndefined();
    expect(findDecklist(edition, draft.decklistId)).toBeNull();
    expect(draft.cards.map((row) => row.pairs[0]!.qty)).toEqual(edition.cards.filter((card) => card.role === "main").map((card) => card.defaultQty));
    expect(countCopies(draft.cards)).toBe(9);
  });
});

describe("SxF Color and Black and White", () => {
  const shipped = deck("sxf");
  const edition = shipped.editions[0]!;
  const mains = edition.cards.filter((card) => card.role === "main");

  it("tags 53 option cards and the basics with both files, and leaves the 35 always-color cards untagged", () => {
    const both = mains.filter((card) => card.faces[0]!.defaultArt?.tone === "color" && card.faces[0]!.alternates[0]?.tone === "bw");
    const untagged = mains.filter((card) => !card.faces[0]!.defaultArt?.tone);
    const basic = (name: string) => /^(plains|island|swamp|mountain|forest)\b/i.test(name);
    expect(both.filter((card) => !basic(card.name))).toHaveLength(53);
    expect(untagged.filter((card) => !basic(card.name))).toHaveLength(35);
    expect(hasToneChoice(edition)).toBe(true);
  });

  it("opens on Color and switches the option cards, not the 35, to Black and White and back", () => {
    const draft = freshDraft(shipped, edition, "id", new Date(0));
    expect(draft.tone).toBe("color");
    expect(draft.decklistId).toBe("sxf-operation-strix");
    const bw = applyTone(edition, draft.cards, "bw");
    const changed = bw.filter((row, i) => row.pairs[0]!.art !== draft.cards[i]!.pairs[0]!.art);
    const names = new Map(edition.cards.map((card) => [card.id, card.name]));
    expect(changed.some((row) => names.get(row.cardId) === "Arcbond (Losing Control)")).toBe(true);
    expect(changed.some((row) => names.get(row.cardId)?.startsWith("Aboleth Spawn"))).toBe(false);
    expect(countCopies(bw)).toBe(countCopies(draft.cards));
    const slots = selectionToSlots(edition, bw);
    expect(slots).toHaveLength(100);
    expect(applyTone(edition, bw, "color")).toEqual(draft.cards);
  });

  it("does not offer the switch on a deck without both versions", () => {
    expect(hasToneChoice(standard("silksong"))).toBe(false);
    expect(freshDraft(deck("silksong"), standard("silksong"), "id", new Date(0)).tone).toBeUndefined();
  });
});
