/**
 * Names that are also Object.prototype members ("constructor", "toString", "__proto__", "hasOwnProperty")
 * are ordinary card names, decklist headers, search words and deck ids. None may read an inherited entry
 * from a lookup table.
 */
import { describe, expect, it } from "vitest";
import { CARD_LOOKUP } from "@/data/card-lookup";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "@/data/splash-assets";
import { TOKEN_LOOKUP } from "@/data/token-lookup";
import { factsFor } from "@/lib/card-facts";
import { matchCard, parseQuery } from "@/lib/card-filter";
import { parseDecklist } from "@/lib/decklist";
import { own } from "@/lib/own";
import { activeBackOverrides } from "@/lib/selection";
import { splashFor } from "@/lib/splash";
import { tokenVerdict } from "@/lib/tokens";
import type { DeckCard, Edition } from "@/lib/types";

const WORDS = ["constructor", "Constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"];

function card(name: string, role: DeckCard["role"] = "extra"): DeckCard {
  return { id: name, name, role, defaultQty: 1, faces: [{ id: `face-${name}`, name, defaultArt: { id: `art-${name}`, name: `${name}.png`, thumbId: `thumb-${name}`, label: name }, alternates: [] }] };
}

describe("names that are Object.prototype members", () => {
  it("own() answers only a record's own entries", () => {
    const record: Record<string, number> = { a: 1 };
    expect(own(record, "a")).toBe(1);
    for (const word of WORDS) expect(own(record, word), word).toBeUndefined();
    expect(own({ constructor: 2 } as Record<string, number>, "constructor")).toBe(2);
  });

  for (const word of WORDS) {
    it(`treats a card named “${word}” as an unknown card everywhere`, () => {
      const item = card(word);
      expect(factsFor(item, CARD_LOOKUP)).toEqual({ status: "unmatched", facts: null });
      const verdict = tokenVerdict(item, TOKEN_LOOKUP);
      expect(verdict.source).toBe("heuristic");
      expect(verdict.entry).toBeUndefined();
      expect(typeof verdict.token).toBe("boolean");
    });

    it(`reads “${word}” in the search box as a name, and as a key, color or rarity not understood`, () => {
      expect(parseQuery(word)).toMatchObject({ unknown: [] });
      expect(parseQuery(word).filter.name).toEqual([word]);
      // A key is letters only, so "__proto__:x" is a name word; the others are keys nobody knows.
      const asKey = /^[a-z]+$/i.test(word) ? [`${word}:x`] : [];
      if (!asKey.length) expect(parseQuery(`${word}:x`)).toMatchObject({ unknown: [], filter: { name: [`${word}:x`] } });
      for (const query of [...asKey, `c:${word}`, `color:${word}`, `r:${word}`, `rarity:${word}`]) {
        const parsed = parseQuery(query);
        expect(parsed.unknown, query).toEqual([query]);
        expect(parsed.filter.colors, query).toEqual([]);
        expect(parsed.filter.rarities, query).toEqual([]);
      }
      if (asKey.length) expect(parseQuery(`(${word}:a or ${word}:b)`).unknown).toEqual([`${word}:a or ${word}:b`]);
      expect(parseQuery(`(c:${word} or c:u)`).unknown).toEqual([`c:${word} or c:u`]);
      const subject = { names: [word], role: "main" as const, dfc: false, basic: false, copies: 1, status: "unmatched" as const, facts: null };
      expect(matchCard(subject, parseQuery(word).filter)).toBe("shown");
      expect(matchCard(subject, parseQuery("sol").filter)).toBe("hidden");
    });

    it(`reads “${word}:” in a decklist as an ordinary line, not a section header`, () => {
      const list = parseDecklist(`Commander:\n1 Sol Ring\nDeck:\n1 Lightning Greaves\n${word}:\n1 Arcane Signet`, "list.txt");
      expect(list.commander.map((entry) => entry.name)).toEqual(["Sol Ring"]);
      // Still in the Deck section: the line is not a header, so the card after it is counted.
      expect(list.main.map((entry) => entry.name)).toEqual(["Lightning Greaves", "Arcane Signet"]);
      expect(list.skipped).toEqual([`${word}:`]);
    });

    it(`gives a deck id “${word}” the fallback splash and a card id “${word}” no back override`, () => {
      expect(splashFor(word, SPLASH_ASSETS, SPLASH_FALLBACK)).toBe(SPLASH_FALLBACK);
      expect(splashFor(word, SPLASH_ASSETS).kind).toBe("generic");
      const edition: Pick<Edition, "cards" | "backs"> = { cards: [card(word, "token")], backs: [{ id: "back-a", name: "card back", thumbId: "thumb-back" }] };
      expect(activeBackOverrides(edition, {}, () => true).size).toBe(0);
    });
  }
});
