import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { check } from "../../scripts/card-lookup";
import { CARD_LOOKUP, CARD_LOOKUP_UNMATCHED } from "@/data/card-lookup";
import { factsFor, factsFromScryfall, mergeFacts } from "@/lib/card-facts";
import { normalizeKey } from "@/lib/names";
import { tokenQueryNames } from "@/lib/tokens";
import type { DeckCatalogue } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const decks = readdirSync(path.join(root, "public/decks"))
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => JSON.parse(readFileSync(path.join(root, "public/decks", name), "utf8")) as DeckCatalogue);
const cards = decks.flatMap((deck) => deck.editions.flatMap((edition) => edition.cards));

describe("card facts from Scryfall", () => {
  it("keeps colors, type line, mana value, rarity, rules text and power/toughness, joining a double-faced card's faces", () => {
    expect(
      factsFromScryfall({
        name: "Hydroelectric Specimen // Hydroelectric Laboratory",
        layout: "modal_dfc",
        cmc: 3,
        rarity: "uncommon",
        card_faces: [
          { name: "Hydroelectric Specimen", type_line: "Creature — Weird", colors: ["U"], oracle_text: "Flash", power: "1", toughness: "4" },
          { name: "Hydroelectric Laboratory", type_line: "Land", colors: [], oracle_text: "{T}: Add {U}." },
        ],
      }),
    ).toEqual({ scryfall: "Hydroelectric Specimen // Hydroelectric Laboratory", layout: "modal_dfc", colors: ["U"], typeLine: "Creature — Weird // Land", cmc: 3, rarity: "uncommon", oracle: "Flash\n//\n{T}: Add {U}.", power: "1", toughness: "4" });
    expect(
      factsFromScryfall({ name: "Front // Back", layout: "transform", cmc: 2, rarity: "rare", card_faces: [{ name: "Front", type_line: "Creature", colors: ["G"] }, { name: "Back", type_line: "Creature", colors: ["U"] }] }).colors,
    ).toEqual(["U", "G"]);
    expect(factsFromScryfall({ name: "Boros Charm", layout: "normal", colors: ["W", "R"].reverse(), type_line: "Instant", cmc: 2, rarity: "uncommon", oracle_text: "Choose one" }).colors).toEqual(["W", "R"]);
  });

  it("keeps only the facts that every card sharing a name agrees on, and says which ones differ", () => {
    const one = factsFromScryfall({ name: "Spirit", layout: "token", colors: ["W"], type_line: "Token Creature — Spirit", cmc: 0, rarity: "common", oracle_text: "Flying", power: "1", toughness: "1" });
    const two = factsFromScryfall({ name: "Spirit", layout: "token", colors: ["U"], type_line: "Token Creature — Spirit", cmc: 0, rarity: "common", oracle_text: "Flying", power: "1", toughness: "1" });
    expect(mergeFacts([one])).toBe(one);
    expect(mergeFacts([one, { ...one }])).toEqual(one);
    const merged = mergeFacts([one, two]);
    expect(merged.colors).toBeUndefined();
    expect(merged).toMatchObject({ typeLine: "Token Creature — Spirit", cmc: 0, oracle: "Flying", power: "1", toughness: "1" });
    expect(merged.ambiguous).toContain("differ in colors");
    // One card that differs is enough, wherever it is in the list.
    expect(mergeFacts([one, { ...one }, two]).colors).toBeUndefined();
  });

  it("looks a card up by its front face first, then its name, and prefers a clear entry to an ambiguous one", () => {
    const lookup = { "sol ring": { query: "Sol Ring", scryfall: "Sol Ring", layout: "normal", cmc: 1 }, spirit: { query: "Spirit", scryfall: "Spirit", layout: "token", ambiguous: "2 different" } };
    const face = (name: string) => ({ id: name, name, defaultArt: null, alternates: [] });
    expect(factsFor({ name: "Sol Ring (Bracelet of Hope) 2", faces: [face("Sol Ring (Bracelet of Hope)")] }, lookup)).toEqual({ status: "matched", facts: lookup["sol ring"] });
    expect(factsFor({ name: "Token - Spirit 3", faces: [face("Token - Spirit 3")] }, lookup).status).toBe("ambiguous");
    expect(factsFor({ name: "Turtle Van", faces: [face("Turtle Van")] }, lookup)).toEqual({ status: "unmatched", facts: null });
    // An ambiguous front face gives way to a clear entry for the card's own name.
    expect(factsFor({ name: "Sol Ring", faces: [face("Spirit")] }, lookup)).toEqual({ status: "matched", facts: lookup["sol ring"] });
  });
});

describe("the committed card lookup (src/data/card-lookup.ts)", () => {
  it("has an entry or an unmatched line for every card name in the shipped decks, never both", () => {
    const unmatched = new Set(CARD_LOOKUP_UNMATCHED.map((name) => normalizeKey(name)));
    const missing = cards.flatMap((card) => tokenQueryNames(card)).filter((query) => !CARD_LOOKUP[normalizeKey(query)] && !unmatched.has(normalizeKey(query)));
    expect(missing).toEqual([]);
    expect([...unmatched].filter((key) => CARD_LOOKUP[key])).toEqual([]);
  });

  it("matches the counts in the report: 1241 cards matched, 73 ambiguous, 260 unmatched", () => {
    const count = (status: string, role?: string) => cards.filter((card) => (!role || card.role === role) && factsFor(card, CARD_LOOKUP).status === status).length;
    expect([count("matched"), count("ambiguous"), count("unmatched")]).toEqual([1241, 73, 260]);
    expect([count("matched", "main"), count("ambiguous", "main"), count("unmatched", "main")]).toEqual([1076, 0, 1]);
  });

  it("knows real cards from the decks", () => {
    const sxf = decks.find((deck) => deck.id === "sxf")!.editions[0]!;
    const specimen = sxf.cards.find((card) => card.id === "main-hydroelectric-specimen-melinda-desmond-former-first-lady")!;
    expect(factsFor(specimen, CARD_LOOKUP)).toMatchObject({ status: "matched", facts: { colors: ["U"], typeLine: "Creature — Weird // Land", cmc: 3, power: "1", toughness: "4" } });
    expect(CARD_LOOKUP["sol ring"]).toMatchObject({ colors: [], typeLine: "Artifact", cmc: 1 });
  });

  it("is a static file: the app has no Scryfall address outside comments", () => {
    const files = readdirSync(path.join(root, "src"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const hits = files.filter((file) => readFileSync(file, "utf8").split("\n").some((line) => /api\.scryfall\.com|scryfall\.com\//i.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)));
    expect(hits).toEqual([]);
  });
});

describe("scripts/card-lookup.ts --check", () => {
  it("passes on the committed lookup, and fails when a name has no entry or is both matched and unmatched", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(check()).toBe(0);
      expect(log.mock.calls.at(-1)?.[0]).toBe("Card lookup covers all 1136 card names (1574 cards, 1241 with Scryfall facts).");
      const { ["sol ring"]: _gone, ...without } = CARD_LOOKUP;
      expect(check(without)).toBe(1);
      expect(error.mock.calls.at(-1)?.[0]).toMatch(/^The card lookup has no entry for 1 name\(s\): Sol Ring\./);
      expect(check(CARD_LOOKUP, [...CARD_LOOKUP_UNMATCHED, "Sol Ring"])).toBe(1);
      expect(error.mock.calls.at(-1)?.[0]).toBe("The card lookup lists 1 name(s) as both matched and unmatched: sol ring.");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
