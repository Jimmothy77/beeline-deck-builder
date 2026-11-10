import { describe, expect, it } from "vitest";
import type { CardFacts } from "@/lib/card-facts";
import { EMPTY_FILTER, attributeFilters, formatQuery, isFilterActive, matchCard, normalizeFilter, parseQuery, type CardFilter, type FilterSubject } from "@/lib/card-filter";

const facts = (patch: Partial<CardFacts>): CardFacts => ({ query: "x", scryfall: "X", layout: "normal", ...patch });
const subject = (patch: Partial<FilterSubject> = {}): FilterSubject => ({ names: ["Llanowar Elves"], role: "main", dfc: false, basic: false, copies: 1, status: "matched", facts: facts({ colors: ["G"], typeLine: "Creature — Elf Druid", cmc: 1, rarity: "common", oracle: "{T}: Add {G}.", power: "1", toughness: "1" }), ...patch });
const f = (patch: Partial<CardFilter>): CardFilter => ({ ...structuredClone(EMPTY_FILTER), ...patch });
const run = (query: string, s: FilterSubject = subject()) => matchCard(s, parseQuery(query).filter);

describe("the deck filter's query box", () => {
  it("reads the Scryfall-style terms into the filter model", () => {
    expect(parseQuery("t:creature c:g mv<=3")).toEqual({ filter: f({ types: ["creature"], colors: ["G"], mv: { op: "<=", value: 3 } }), unknown: [] });
    expect(parseQuery("c=wu").filter).toEqual(f({ colors: ["W", "U"], colorMode: "exact" }));
    expect(parseQuery("c:wu").filter).toEqual(f({ colors: ["W", "U"], colorMode: "all" }));
    expect(parseQuery("c>=ub").filter).toEqual(f({ colors: ["U", "B"], colorMode: "all" }));
    expect(parseQuery("(c:w or c:u)").filter).toEqual(f({ colors: ["W", "U"], colorMode: "any" }));
    expect(parseQuery("c:w or c:c").filter).toEqual(f({ colors: ["W"], colorless: true }));
    expect(parseQuery("(c:wu or c:c)").filter).toEqual(f({ colors: ["W", "U"], colorMode: "all", colorless: true }));
    expect(parseQuery("c:c c:m").filter).toEqual(f({ colorless: true, multicolor: true }));
    expect(parseQuery("color:izzet").filter).toEqual(f({ colors: ["U", "R"], colorMode: "all" }));
    expect(parseQuery("t:creature t:artifact").filter).toEqual(f({ types: ["creature", "artifact"], typeMode: "all" }));
    expect(parseQuery("(t:creature or t:instant)").filter).toEqual(f({ types: ["creature", "instant"], typeMode: "any" }));
    expect(parseQuery('t:goblin type:"legendary creature"').filter).toEqual(f({ typeText: ["goblin", "legendary creature"] }));
    expect(parseQuery("mv>=2 mv<=4").filter).toEqual(f({ mv: { op: "range", min: 2, max: 4 } }));
    expect(parseQuery("cmc=0").filter).toEqual(f({ mv: { op: "=", value: 0 } }));
    expect(parseQuery("mv>1 mv<4").filter).toEqual(f({ mv: { op: "range", min: 2, max: 3 } }));
    expect(parseQuery("mv>5").filter).toEqual(f({ mv: { op: ">", value: 5 } }));
    expect(parseQuery("mv!=2").filter).toEqual(f({ mv: { op: "!=", value: 2 } }));
    expect(parseQuery("r:m").filter).toEqual(f({ rarities: ["mythic"] }));
    expect(parseQuery("(r:rare or r:mythic)").filter).toEqual(f({ rarities: ["rare", "mythic"] }));
    expect(parseQuery('o:"draw a card" oracle:flying').filter).toEqual(f({ oracle: ["draw a card", "flying"] }));
    expect(parseQuery("pow>=3 tou<2").filter).toEqual(f({ power: { op: ">=", value: 3 }, toughness: { op: "<", value: 2 } }));
    expect(parseQuery("power>=1 power<=2 toughness=4").filter).toEqual(f({ power: { op: "range", min: 1, max: 2 }, toughness: { op: "=", value: 4 } }));
    expect(parseQuery("qty>0 is:dfc is:token is:basic").filter).toEqual(f({ inDeck: true, dfc: true, tokenExtra: true, basics: true }));
    expect(parseQuery("is:indeck is:extra").filter).toEqual(f({ inDeck: true, tokenExtra: true }));
  });

  it("reads plain words, quoted names and words around 'or' as a name search, as the search box always did", () => {
    expect(parseQuery("sol ring").filter).toEqual(f({ name: ["sol", "ring"] }));
    expect(parseQuery('"Sol Ring" name:signet').filter).toEqual(f({ name: ["Sol Ring", "signet"] }));
    expect(parseQuery("Fight or Flight").filter).toEqual(f({ name: ["Fight", "or", "Flight"] }));
    expect(parseQuery("").filter).toEqual(EMPTY_FILTER);
    expect(isFilterActive(parseQuery("  ").filter)).toBe(false);
  });

  it("lists what it doesn't understand and leaves it out", () => {
    expect(parseQuery("foo:bar t:creature mv<=x c:purple is:commander (t:creature or c:w)").unknown).toEqual(["foo:bar", "mv<=x", "c:purple", "is:commander", "t:creature or c:w"]);
    // An "or" group needs one kind of term and plain ":" or "=".
    expect(parseQuery("(t:creature or o:creature)")).toEqual({ filter: EMPTY_FILTER, unknown: ["t:creature or o:creature"] });
    expect(parseQuery("(t!=creature or t:instant)")).toEqual({ filter: EMPTY_FILTER, unknown: ["t!=creature or t:instant"] });
    expect(parseQuery("foo:bar t:creature").filter).toEqual(f({ types: ["creature"] }));
  });

  it("writes every filter back as a query that reads the same", () => {
    const filters: CardFilter[] = [
      f({ name: ["sol", "Sol Ring"] }),
      f({ colors: ["G"] }),
      f({ colors: ["G"], colorMode: "exact" }),
      f({ colors: ["W", "U"] }),
      f({ colors: ["W", "U"], colorMode: "all" }),
      f({ colors: ["W", "U", "B"], colorMode: "exact" }),
      f({ colors: ["R"], colorless: true }),
      f({ colors: ["W", "U"], colorless: true }),
      f({ colors: ["W", "U"], colorMode: "all", colorless: true }),
      f({ colors: ["B", "G"], colorMode: "exact", colorless: true }),
      f({ colorless: true }),
      f({ multicolor: true, colors: ["R"] }),
      f({ types: ["creature"] }),
      f({ types: ["creature", "instant"] }),
      f({ types: ["artifact", "creature"], typeMode: "all" }),
      f({ typeText: ["legendary creature", "goblin"] }),
      f({ mv: { op: "=", value: 3 } }),
      f({ mv: { op: "<", value: 3 } }),
      f({ mv: { op: ">", value: 3 } }),
      f({ mv: { op: "range", min: 2, max: 5 } }),
      f({ rarities: ["rare"] }),
      f({ rarities: ["rare", "mythic", "special"] }),
      f({ oracle: ["draw a card", "flying"] }),
      f({ power: { op: ">=", value: 4 }, toughness: { op: "range", min: 1, max: 3 } }),
      f({ inDeck: true, dfc: true, tokenExtra: true, basics: true }),
      f({ name: ["or"], oracle: ['say "hi"'] }),
    ];
    for (const filter of filters) {
      const text = formatQuery(filter);
      const back = parseQuery(text);
      expect(back.unknown, text).toEqual([]);
      expect(back.filter, text).toEqual(normalizeFilter({ ...filter, oracle: filter.oracle.map((item) => item.replace(/"/g, "")) }));
    }
    expect(formatQuery(f({ types: ["creature"], colors: ["G"], mv: { op: "<=", value: 3 } }))).toBe("c:g t:creature mv<=3");
    expect(formatQuery(EMPTY_FILTER)).toBe("");
  });
});

describe("the deck filter's matching", () => {
  it("matches colors by any, all and exact, with colorless and multicolor", () => {
    const gw = subject({ facts: facts({ colors: ["W", "G"] }) });
    const colorless = subject({ facts: facts({ colors: [] }) });
    expect(run("c:g", gw)).toBe("shown");
    expect(run("(c:u or c:g)", gw)).toBe("shown");
    expect(run("(c:u or c:b)", gw)).toBe("hidden");
    expect(run("c:wg", gw)).toBe("shown");
    expect(run("c:wu", gw)).toBe("hidden");
    expect(run("c=g", gw)).toBe("hidden");
    expect(run("c=gw", gw)).toBe("shown");
    expect(run("c:m", gw)).toBe("shown");
    expect(run("c:m", subject())).toBe("hidden");
    expect(run("c:c", colorless)).toBe("shown");
    expect(run("c:c", gw)).toBe("hidden");
    expect(run("(c:u or c:c)", colorless)).toBe("shown");
    expect(run("c:u", colorless)).toBe("hidden");
  });

  it("matches types, type line text, mana value, rarity, rules text, power and toughness", () => {
    const s = subject();
    expect(run("t:creature", s)).toBe("shown");
    expect(run("t:instant", s)).toBe("hidden");
    expect(run("(t:instant or t:creature)", s)).toBe("shown");
    expect(run("t:creature t:artifact", s)).toBe("hidden");
    expect(run("t:elf", s)).toBe("shown");
    expect(run("t:goblin", s)).toBe("hidden");
    for (const [query, result] of [["mv=1", "shown"], ["mv<1", "hidden"], ["mv>0", "shown"], ["mv<=1", "shown"], ["mv>=2", "hidden"], ["mv!=1", "hidden"], ["mv>=0 mv<=1", "shown"], ["mv>=2 mv<=4", "hidden"], ["mv>=1 mv<=3", "shown"], ["mv>=0 mv<=0", "hidden"]] as const) expect(run(query, s), query).toBe(result);
    expect(run("r:common", s)).toBe("shown");
    expect(run("(r:rare or r:mythic)", s)).toBe("hidden");
    expect(run("o:add", s)).toBe("shown");
    expect(run('o:"draw a card"', s)).toBe("hidden");
    expect(run("pow=1 tou>=1", s)).toBe("shown");
    expect(run("pow>1", s)).toBe("hidden");
    expect(run("tou>1", s)).toBe("hidden");
    expect(run("pow>=0", subject({ facts: facts({ power: "*", toughness: "*" }) }))).toBe("hidden");
  });

  it("checks the quick toggles without Scryfall facts", () => {
    const unmatched = subject({ status: "unmatched", facts: null });
    expect(run("qty>0", subject({ copies: 0 }))).toBe("hidden");
    expect(run("qty>0", unmatched)).toBe("shown");
    expect(run("is:dfc", subject({ dfc: true }))).toBe("shown");
    expect(run("is:dfc", subject())).toBe("hidden");
    expect(run("is:token", subject({ role: "token" }))).toBe("shown");
    expect(run("is:token", subject({ role: "extra" }))).toBe("shown");
    expect(run("is:token", subject())).toBe("hidden");
    expect(run("is:basic", subject({ basic: true }))).toBe("shown");
    expect(run("is:basic", subject())).toBe("hidden");
  });

  it("finds unmatched cards by name, and leaves them out of the attribute filters as unknown, not as a mismatch", () => {
    const unmatched = subject({ names: ["Token - Turtle Van"], status: "unmatched", facts: null });
    expect(run("turtle", unmatched)).toBe("shown");
    expect(run("t:creature", unmatched)).toBe("unknown");
    expect(run("c:g", unmatched)).toBe("unknown");
    expect(run("mv<3", unmatched)).toBe("unknown");
    expect(run("r:common", unmatched)).toBe("unknown");
    expect(run("o:add", unmatched)).toBe("unknown");
    expect(run("pow>1", unmatched)).toBe("unknown");
    // A check that needs no facts still rules it out first.
    expect(run("dragon t:creature", unmatched)).toBe("hidden");
    // An ambiguous name keeps the facts its matches agree on.
    const ambiguous = subject({ status: "ambiguous", facts: facts({ typeLine: "Token Creature — Spirit", cmc: 0 }) });
    expect(run("t:spirit mv=0", ambiguous)).toBe("shown");
    expect(run("t:spirit c:w", ambiguous)).toBe("unknown");
    expect(run("t:goblin c:w", ambiguous)).toBe("hidden");
  });

  it("names the filters that need facts", () => {
    expect(attributeFilters(parseQuery("sol qty>0 is:dfc is:token is:basic").filter)).toEqual([]);
    expect(attributeFilters(parseQuery("c:g t:elf mv=1 r:c o:add pow=1 tou=1").filter)).toEqual(["color", "type", "mana value", "rarity", "rules text", "power", "toughness"]);
  });
});
