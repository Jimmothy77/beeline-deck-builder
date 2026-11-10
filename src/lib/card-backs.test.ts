import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_LOOKUP, TOKEN_LOOKUP_UNMATCHED } from "@/data/token-lookup";
import { flipPlan } from "@/lib/desktop";
import { backOptions, resolveBackOverride, selectionToSlots, type SavedCard } from "@/lib/selection";
import { exportSavedJson, importSavedJson, loadSaved, writeSaved, SAVED_KEY } from "@/lib/storage";
import { TOKEN_OVERRIDES } from "@/data/token-overrides";
import { heuristicIsToken, isTokenCard, tokenQueryName, tokenVerdict } from "@/lib/tokens";
import type { CardFace, CardRole, DeckCard, DeckCatalogue, Edition } from "@/lib/types";
import { buildXml, type XmlSlot } from "@/lib/xml";

const root = path.resolve(import.meta.dirname, "../..");

// Made-up ids. None of them is shaped like a Drive id.
function face(id: string, name: string, ext = "png"): CardFace {
  return { id: `face-${id}`, name, defaultArt: { id: `art-${id}`, name: `${name}.${ext}`, thumbId: `thumb-${id}`, label: name }, alternates: [] };
}
function card(id: string, name: string, role: CardRole, back?: string, ext = "png"): DeckCard {
  const faces = [face(id, name, ext)];
  if (back) faces.push(face(`${id}-b`, back, ext));
  return { id: `card-${id}`, name: back ? `${name} // ${back}` : name, role, faces, defaultQty: role === "main" ? 1 : 0 };
}
function edition(printType: Edition["printType"] = "standard"): Edition {
  const ext = printType === "partial_foil" ? "pdf" : "png";
  return {
    id: "ed",
    name: "Standard",
    printType,
    cards: [
      card("m1", "Akroma", "main", undefined, ext),
      card("m2", "Dowsing Dagger", "main", "Lost Vale", ext),
      card("t1", "Token - Treasure", "token", undefined, ext),
      card("x1", "Food", "extra", undefined, ext),
      card("x2", "Swan Song", "extra", undefined, ext),
    ],
    backs: [
      { id: "back-a", name: "Card Back 1", thumbId: "thumb-back-a" },
      { id: "back-b", name: "Card Back 2", thumbId: "thumb-back-b" },
    ],
    notes: [],
  };
}
const row = (cardId: string, qty = 1, extra: Partial<SavedCard["pairs"][number]> = {}): SavedCard => ({ cardId, locked: false, pairs: [{ art: "", qty, ...extra }] });
/** Order ids need ten characters, so the made-up ids get a suffix in the XML. */
const pad = (id: string) => `${id}-xmlid`;
const xmlOf = (slots: XmlSlot[], printType: Edition["printType"] = "standard") =>
  buildXml({
    slots: slots.map((slot) => ({ front: { ...slot.front, id: pad(slot.front.id) }, back: slot.back ? { ...slot.back, id: pad(slot.back.id) } : null })),
    cardback: pad("back-a"),
    deck: "Test",
    printType,
    pdfIds: new Set(edition(printType).cards.flatMap((item) => item.faces.map((f) => pad(f.defaultArt!.id)))),
  });

describe("token lookup (one-time Scryfall cross-reference, committed)", () => {
  it("names a Scryfall token a token even when the old rule said extra, and keeps the old rule for names Scryfall has no clear answer for", () => {
    expect(TOKEN_LOOKUP.food).toMatchObject({ token: true, layout: "token" });
    expect(isTokenCard(card("x", "Food 2", "extra"))).toBe(true);
    expect(heuristicIsToken(card("x", "Food 2", "extra"))).toBe(false);
    expect(isTokenCard(card("x", "Swan Song", "extra"))).toBe(false);
    expect(tokenVerdict(card("x", "Rhystic Study", "token"))).toMatchObject({ token: false, source: "scryfall" });
    // Unmatched: the heuristic decides.
    expect(tokenVerdict(card("x", "Kaine", "token"))).toMatchObject({ token: true, source: "heuristic" });
    expect(tokenVerdict(card("x", "Life Counter", "extra"))).toMatchObject({ token: false, source: "heuristic" });
    // A token and a game card share the name: the heuristic decides.
    expect(TOKEN_LOOKUP.shapeshifter?.ambiguous).toBeTruthy();
    expect(tokenVerdict(card("x", "Shapeshifter 3", "token"))).toMatchObject({ token: true, source: "heuristic" });
    expect(tokenVerdict(card("x", "Shapeshifter 3", "extra"))).toMatchObject({ token: false, source: "heuristic" });
  });

  it("looks names up without labels, face prefixes, themes or art numbers", () => {
    expect(tokenQueryName("Token - Treasure 2")).toBe("Treasure");
    expect(tokenQueryName("1_The Ring Tempts You (The Prophecy Advances)")).toBe("The Ring Tempts You");
    expect(tokenQueryName("Token - The Ring // Token - The Ring Tempts You")).toBe("The Ring // The Ring Tempts You");
    expect(tokenQueryName("Teferi Emblem (The Radiance Emblem)")).toBe("Teferi Emblem");
  });

  it("covers every extra and token name in the shipped decks, and the app never calls Scryfall", () => {
    const listed = new Set(TOKEN_LOOKUP_UNMATCHED);
    expect(Object.keys(TOKEN_LOOKUP).length + listed.size).toBeGreaterThan(300);
    for (const name of readdirSync(path.join(root, "src"), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      expect(readFileSync(path.join(root, "src", name), "utf8"), name).not.toMatch(/api\.scryfall\.com/);
    }
    const decks = readdirSync(path.join(root, "public/decks")).filter((name) => name.endsWith(".json") && name !== "index.json");
    let tokens = 0;
    for (const name of decks) {
      const deck = JSON.parse(readFileSync(path.join(root, "public/decks", name), "utf8")) as DeckCatalogue;
      for (const item of deck.editions.flatMap((ed) => ed.cards)) if (item.role !== "main" && isTokenCard(item)) tokens += 1;
    }
    expect(tokens).toBe(327);
  });
});

describe("back options in the card editor", () => {
  it("offers the card backs, the extras that are not tokens, and the tokens, never the card itself", () => {
    const ed = edition();
    const options = backOptions(ed, "card-m1");
    expect(options.cardback.map((item) => item.id)).toEqual(["back-a", "back-b"]);
    expect(options.alt.map((item) => item.cardId)).toEqual(["card-x2"]);
    expect(options.token.map((item) => item.cardId)).toEqual(["card-t1", "card-x1"]);
    expect(backOptions(ed, "card-x2").alt).toEqual([]);
  });

  it("leaves out files of the other tone", () => {
    const ed = edition();
    const token = ed.cards.find((item) => item.id === "card-t1")!;
    token.faces[0] = { ...token.faces[0]!, defaultArt: { ...token.faces[0]!.defaultArt!, tone: "color" }, alternates: [{ id: "art-t1-bw", name: "x.png", thumbId: "thumb-t1-bw", label: "Treasure", tone: "bw" }] };
    expect(backOptions(ed, "card-m1", "bw").token.map((item) => item.id)).toEqual(["art-t1-bw", "art-x1"]);
    expect(resolveBackOverride(ed, "card-m1", "art-t1")).toMatchObject({ kind: "token" });
    expect(resolveBackOverride(ed, "card-m1", "art-m2")).toBeNull();
    expect(resolveBackOverride(ed, "card-x2", "art-x2")).toBeNull();
  });
});

describe("per-card back in the export", () => {
  const ed = edition();
  const cards = [row("card-m1", 2), row("card-m2", 1), row("card-x2", 1)];

  it("leaves an order without picks byte for byte as before", () => {
    const before = xmlOf(selectionToSlots(ed, cards));
    expect(xmlOf(selectionToSlots(ed, cards, { cardBacks: undefined, cardback: "back-a" }))).toBe(before);
    expect(xmlOf(selectionToSlots(ed, cards, { cardBacks: {}, cardback: "back-a" }))).toBe(before);
    // A pick that isn't in this edition is ignored.
    expect(xmlOf(selectionToSlots(ed, cards, { cardBacks: { "card-m1": "not-here" }, cardback: "back-a" }))).toBe(before);
    // Only the double-faced card has a back of its own.
    expect(before.split("<backs>")[1]!.split("</backs>")[0]!.match(/<id>[^<]+<\/id>/g)).toEqual([`<id>${pad("art-m2-b")}</id>`]);
  });

  it("prints a picked card back, alt back or token back on every copy of that card only", () => {
    for (const [pick, kind] of [
      ["back-b", "cardback"],
      ["art-x2", "alt"],
      ["art-t1", "token"],
    ] as const) {
      expect(resolveBackOverride(ed, "card-m1", pick)?.kind).toBe(kind);
      const slots = selectionToSlots(ed, cards, { cardBacks: { "card-m1": pick }, cardback: "back-a" });
      expect(slots.map((slot) => slot.back?.id ?? null)).toEqual([pick, pick, "art-m2-b", null]);
      const xml = xmlOf(slots);
      expect(xml).toContain("<backs>");
      expect(xml).toContain(`<id>${pad(pick)}</id>`);
      expect(xml).toContain("<slots>0,1</slots>");
      expect(xml).toContain(`<cardback>${pad("back-a")}</cardback>`);
      expect(xml).toContain("<printabee>");
    }
  });

  it("prints a one-faced card whose pick is the deck back exactly as without a pick", () => {
    expect(selectionToSlots(ed, cards, { cardBacks: { "card-m1": "back-a" }, cardback: "back-a" })).toEqual(selectionToSlots(ed, cards));
  });

  it("keeps a double-faced card's own back unless it has a pick, and a pick replaces that face", () => {
    expect(selectionToSlots(ed, [row("card-m2")])[0]!.back?.id).toBe("art-m2-b");
    expect(selectionToSlots(ed, [row("card-m2")], { cardBacks: { "card-m1": "back-b" } })[0]!.back?.id).toBe("art-m2-b");
    expect(selectionToSlots(ed, [row("card-m2")], { cardBacks: { "card-m2": "back-a" }, cardback: "back-a" })[0]!.back?.id).toBe("back-a");
    expect(selectionToSlots(ed, [row("card-m2")], { cardBacks: { "card-m2": "art-t1" } })[0]!.back?.id).toBe("art-t1");
  });

  it("never prints a picked back as an extra front in partial foil", () => {
    const pf = edition("partial_foil");
    const promoted = selectionToSlots(pf, [row("card-m2")], { printFlipBacksAsFronts: true });
    expect(promoted.map((slot) => [slot.front.id, slot.back?.id ?? null])).toEqual([
      ["art-m2", null],
      ["art-m2-b", null],
    ]);
    const picked = selectionToSlots(pf, [row("card-m2")], { printFlipBacksAsFronts: true, cardBacks: { "card-m2": "art-x2" } });
    expect(picked.map((slot) => [slot.front.id, slot.back?.id ?? null])).toEqual([["art-m2", "art-x2"]]);
    expect(xmlOf(picked, "partial_foil")).toContain(`<id>${pad("art-x2")}</id>`);
  });
});

describe("per-card back in saved decks", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
  };
  const old = {
    id: "d1",
    name: "Deck",
    deckId: "test",
    deckName: "Test",
    editionId: "ed",
    editionName: "Standard",
    printType: "standard",
    treatment: null,
    cardbackId: "back-a",
    printFlipBacksAsFronts: false,
    cards: [{ cardId: "card-m1", locked: false, pairs: [{ art: "art-m1", qty: 1 }] }],
    updatedAt: "2026-11-09T00:00:00.000Z",
  };

  it("loads and saves a deck from before v0.1.28 unchanged, with no cardBacks key", () => {
    const s = store();
    s.setItem(SAVED_KEY, JSON.stringify([old]));
    const loaded = loadSaved(s);
    expect(loaded).toEqual([old]);
    expect("cardBacks" in loaded[0]!).toBe(false);
    writeSaved(s, loaded);
    expect(s.getItem(SAVED_KEY)).toBe(JSON.stringify([old]));
    // An empty or broken map loads as no map at all.
    for (const cardBacks of [{}, { "card-m1": 5 }, { "card-m1": "  " }]) {
      s.setItem(SAVED_KEY, JSON.stringify([{ ...old, cardBacks }]));
      expect(loadSaved(s)).toEqual([old]);
    }
  });

  it("keeps picks through save, load, and JSON export and import, and drops broken entries", () => {
    const s = store();
    const deck = { ...old, cardBacks: { "card-m1": "back-b", "card-m2": " art-t1 ", "": "x", "card-x": 5 } };
    // A "__proto__" key in the stored JSON is never taken as the map's prototype.
    s.setItem(SAVED_KEY, JSON.stringify([deck]).replace('"card-x":5', '"card-x":5,"__proto__":"y"'));
    const [loaded] = loadSaved(s);
    expect(loaded!.cardBacks).toEqual({ "card-m1": "back-b", "card-m2": "art-t1" });
    expect(Object.getPrototypeOf(loaded!.cardBacks)).toBe(Object.prototype);
    writeSaved(s, [loaded!]);
    expect(loadSaved(s)[0]!.cardBacks).toEqual({ "card-m1": "back-b", "card-m2": "art-t1" });
    expect(importSavedJson(exportSavedJson([loaded!]))[0]!.cardBacks).toEqual({ "card-m1": "back-b", "card-m2": "art-t1" });
    s.setItem(SAVED_KEY, JSON.stringify([{ ...old, cardBacks: ["back-b"] }]));
    expect("cardBacks" in loadSaved(s)[0]!).toBe(false);
  });
});

describe("flyout with a picked back", () => {
  it("shows the picked back over a double-faced card's own back and over the deck back", () => {
    expect(flipPlan({ customBack: "pick", dfcBack: "own", cardback: "deck", reducedMotion: false })).toMatchObject({ mode: "custom", backImage: "pick" });
    expect(flipPlan({ customBack: null, dfcBack: "own", cardback: "deck", reducedMotion: false })).toMatchObject({ mode: "dfc", backImage: "own" });
    expect(flipPlan({ customBack: "pick", reducedMotion: true })).toMatchObject({ mode: "fade", backImage: null });
  });
});

describe("hand token overrides (src/data/token-overrides.ts)", () => {
  const decks = readdirSync(path.join(root, "public/decks"))
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .map((name) => JSON.parse(readFileSync(path.join(root, "public/decks", name), "utf8")) as DeckCatalogue)
    .filter((deck) => Array.isArray(deck.editions));
  const deckById = (id: string) => decks.find((deck) => deck.id === id)!;
  const listOf = (deckId: string, cardName: string) => {
    const ed = deckById(deckId).editions[0]!;
    const main = ed.cards.find((item) => item.role === "main")!;
    const options = backOptions(ed, main.id, null, (item) => isTokenCard(item, deckId));
    const target = ed.cards.find((item) => item.name === cardName)!;
    const arts = new Set([target.faces[0]!.defaultArt!.id, ...target.faces[0]!.alternates.map((art) => art.id)]);
    return (["token", "alt"] as const).filter((kind) => options[kind].some((option) => arts.has(option.id)));
  };

  it("matches exactly one token or extra by deck id and exact card name", () => {
    expect(TOKEN_OVERRIDES).toHaveLength(14);
    for (const item of TOKEN_OVERRIDES) {
      const hits = deckById(item.deck).editions.flatMap((ed) => ed.cards).filter((card) => card.role !== "main" && card.name === item.card);
      expect(hits, `${item.deck}: ${item.card}`).toHaveLength(1);
    }
  });

  it("puts Raphael, Thor, Titania, Blood (Infection) and Shapeshifter 1-9 under Token Backs, and Lands (Forest 3) under Alt Back", () => {
    for (const name of ["Raphael", "Thor", "Titania"]) expect(listOf("persona-5", name), name).toEqual(["token"]);
    expect(listOf("silksong", "Blood (Infection)")).toEqual(["token"]);
    for (let i = 1; i <= 9; i += 1) expect(listOf("vader", `Shapeshifter ${i}`), `Shapeshifter ${i}`).toEqual(["token"]);
    expect(listOf("persona-5", "Lands")).toEqual(["alt"]);
    expect(deckById("persona-5").editions[0]!.cards.find((item) => item.name === "Lands")!.faces[0]!.defaultArt!.name).toBe("Forest 3.jpg");
    const lands = deckById("persona-5").editions[0]!.cards.find((item) => item.name === "Lands")!;
    expect(tokenVerdict(lands, undefined, "persona-5")).toMatchObject({ token: false, source: "override" });
  });

  it("wins over Scryfall and the heuristic, only in its own deck", () => {
    // A made-up token named Lands in Persona 5 is still not a token; in another deck the heuristic decides.
    expect(tokenVerdict(card("x", "Lands", "token"), undefined, "persona-5")).toMatchObject({ token: false, source: "override" });
    expect(tokenVerdict(card("x", "Lands", "token"), undefined, "tmnt")).toMatchObject({ token: true, source: "heuristic" });
    expect(tokenVerdict(card("x", "Lands", "token"))).toMatchObject({ token: true, source: "heuristic" });
    // Scryfall says Food is a token; a hand decision says no.
    expect(tokenVerdict(card("x", "Food 2", "extra"), undefined, "made-up", [{ deck: "made-up", card: "Food 2", token: false }])).toMatchObject({ token: false, source: "override" });
    expect(tokenVerdict(card("x", "Food 2", "extra"), undefined, "made-up", [])).toMatchObject({ token: true, source: "scryfall" });
  });
});
