import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardKeys,
  decklistLabel,
  decklistNotes,
  defaultDecklist,
  editDistance,
  entryKeys,
  findDecklist,
  isDecklistFile,
  isUnnamedMask,
  listTotal,
  orderDecklists,
  parseDecklist,
  parseEntry,
  printList,
  quantitiesFromDecklist,
  withDecklist,
} from "@/lib/decklist";
import type { DeckCard, Decklist, Edition } from "@/lib/types";

const listDir = path.resolve(import.meta.dirname, "../../decklists");
const read = (file: string) => readFileSync(path.join(listDir, file), "utf8");

function card(id: string, name: string, extra: Partial<DeckCard> = {}): DeckCard {
  return {
    id,
    name,
    role: "main",
    defaultQty: 1,
    faces: [{ id: `${id}:front`, name, defaultArt: { id: `${id}-art`, name: `${name}.jpg`, thumbId: `${id}-art`, label: name }, alternates: [] }],
    ...extra,
  };
}

function edition(cards: DeckCard[], decklists?: Decklist[]): Edition {
  return { id: "standard", name: "Standard", printType: "standard", cards, backs: [], notes: [], ...(decklists ? { decklists } : {}) };
}

describe("deck list file names", () => {
  it("accepts decklist.txt and decklist - <label>.txt sitting in a folder, and nothing else", () => {
    expect(isDecklistFile("decklist.txt")).toBe(true);
    expect(isDecklistFile("Decklist.TXT")).toBe(true);
    expect(isDecklistFile("decklist - Floating World Fish of '97.txt")).toBe(true);
    expect(isDecklistFile("decklist - KPDH - HUNTRX.txt")).toBe(true);
    expect(isDecklistFile("New Drive Link.txt")).toBe(false);
    expect(isDecklistFile("Decklist_Legends.jpg")).toBe(false);
    expect(isDecklistFile("my decklist.txt")).toBe(false);
    expect(isDecklistFile("decklist.txt.pdf")).toBe(false);
  });

  it("labels a list by the text after the dash, keeping later dashes, and falls back for a bare file", () => {
    expect(decklistLabel("decklist - Eggman.txt")).toBe("Eggman");
    expect(decklistLabel("decklist - KPDH - HUNTRX.txt")).toBe("KPDH - HUNTRX");
    expect(decklistLabel("decklist - SxF - Operation Strix.txt")).toBe("SxF - Operation Strix");
    expect(decklistLabel("decklist - Floating World Fish of '97.txt")).toBe("Floating World Fish of '97");
    expect(decklistLabel("decklist.txt", "Rule the Galaxy [Kaervek, the Punisher]")).toBe("Rule the Galaxy");
    expect(decklistLabel("decklist.txt")).toBe("Deck list");
    expect(decklistLabel("decklist.txt", "  ")).toBe("Deck list");
  });
});

describe("deck list lines", () => {
  it("reads 1x Name (SET) n, a line with no collector number, and 1 Name", () => {
    expect(parseEntry("1x Akroma's Will (M3C) 165")).toEqual({ qty: 1, name: "Akroma's Will", set: "M3C", number: "165" });
    expect(parseEntry("18x Island (FRA) 385")).toEqual({ qty: 18, name: "Island", set: "FRA", number: "385" });
    expect(parseEntry("2x Shell of Isle (ARENA)")).toEqual({ qty: 2, name: "Shell of Isle", set: "ARENA" });
    expect(parseEntry("1 Sol Ring")).toEqual({ qty: 1, name: "Sol Ring" });
    expect(parseEntry("4 Lightning Bolt")).toEqual({ qty: 4, name: "Lightning Bolt" });
    expect(parseEntry("1x Commit // Memory (LCC) 147")).toEqual({ qty: 1, name: "Commit // Memory", set: "LCC", number: "147" });
    expect(parseEntry("1x Sol Ring (SLD) 1011 *F*")).toEqual({ qty: 1, name: "Sol Ring", set: "SLD", number: "1011" });
    expect(parseEntry("1x Dion, Bahamut's Dominant (FIN) 16")?.name).toBe("Dion, Bahamut's Dominant");
  });

  it("rejects headers, blank names, and zero quantities", () => {
    expect(parseEntry("Deck")).toBeNull();
    expect(parseEntry("0x Sol Ring")).toBeNull();
    expect(parseEntry("1x ")).toBeNull();
    expect(parseEntry("Name Knights of Silk and Void")).toBeNull();
    expect(parseEntry("x Sol Ring")).toBeNull();
  });

  it("clamps a huge quantity to 99", () => {
    expect(parseEntry("250x Relentless Rats")?.qty).toBe(99);
  });
});

describe("Tapped Out exports", () => {
  it("parses About, Name, Commander, Deck, and Sideboard with CRLF and a byte-order mark", () => {
    const text = "\uFEFFAbout\r\nName Rule the Galaxy [Kaervek, the Punisher]\r\n\r\nCommander\r\n1x Kaervek, the Punisher (OTJ) 92\r\n\r\nDeck\r\n1x Sol Ring (C21) 263\r\n2x Swamp (FRA) 388\r\nSideboard\r\n1x Languish (HOC) 187\r\n";
    const list = parseDecklist(text, "decklist - Vader.txt");
    expect(list.label).toBe("Vader");
    expect(list.id).toBe("vader");
    expect(list.title).toBe("Rule the Galaxy [Kaervek, the Punisher]");
    expect(list.commander).toEqual([{ qty: 1, name: "Kaervek, the Punisher", set: "OTJ", number: "92" }]);
    expect(list.main.map((entry) => [entry.qty, entry.name])).toEqual([
      [1, "Sol Ring"],
      [2, "Swamp"],
    ]);
    expect(list.sideboard).toEqual([{ qty: 1, name: "Languish", set: "HOC", number: "187" }]);
    expect(list.plain).toBeUndefined();
    expect(printList(list).map((entry) => entry.name)).toEqual(["Kaervek, the Punisher", "Sol Ring", "Swamp"]);
  });

  it("reads a plain 1 Name list with no headers as the main deck", () => {
    const list = parseDecklist("1 Sol Ring\n2 Island\n\n1 Arcane Signet\n", "decklist.txt");
    expect(list.plain).toBe(true);
    expect(list.label).toBe("Deck list");
    expect(list.main.map((entry) => entry.qty)).toEqual([1, 2, 1]);
    expect(list.commander).toEqual([]);
  });

  it("merges repeated lines of the same card, as Complete Collection writes Dandan", () => {
    const list = parseDecklist(read("decklist - Floating World Complete Collection.txt"), "decklist - Floating World Complete Collection.txt");
    const dandan = list.main.filter((entry) => entry.name === "Dandan");
    expect(dandan).toEqual([{ qty: 10, name: "Dandan", set: "TSB", number: "19" }]);
    expect(list.main.find((entry) => entry.name === "Red Herring")?.qty).toBe(10);
  });

  it("keeps lines it can't read as skipped instead of guessing, and ignores Maybeboard", () => {
    const list = parseDecklist("Deck\n1x Sol Ring\nsomething odd\n// a comment\nMaybeboard\n1x Mana Crypt\n", "decklist - Test.txt");
    expect(list.main).toEqual([{ qty: 1, name: "Sol Ring" }]);
    expect(list.skipped).toEqual(["something odd"]);
    expect(printList(list).some((entry) => entry.name === "Mana Crypt")).toBe(false);
  });

  it("counts both SxF commanders in the print list", () => {
    const list = parseDecklist(read("decklist - SxF - Operation Strix.txt"), "decklist - SxF - Operation Strix.txt");
    expect(list.commander.map((entry) => entry.name)).toEqual(["Donna Noble", "The Second Doctor"]);
    expect(listTotal(printList(list))).toBe(100);
  });

  it("keeps Vader's five sideboard cards apart from the 100", () => {
    const list = parseDecklist(read("decklist - Vader.txt"), "decklist - Vader.txt");
    expect(listTotal(list.sideboard)).toBe(5);
    expect(list.sideboard.map((entry) => entry.name)).toEqual(["Agatha's Soul Cauldron", "Cabal Ritual", "Cabal Stronghold", "Languish", "Ulcerate"]);
    expect(listTotal(printList(list))).toBe(100);
    expect(printList(list).some((entry) => entry.name === "Languish")).toBe(false);
  });

  it("parses all 15 shipped lists with no skipped lines and the expected totals", () => {
    const files = readdirSync(listDir).filter((name) => name.endsWith(".txt")).sort();
    expect(files).toHaveLength(15);
    const totals = Object.fromEntries(files.map((file) => {
      const list = parseDecklist(read(file), file);
      expect(list.skipped).toBeUndefined();
      return [list.label, listTotal(printList(list))];
    }));
    expect(totals).toEqual({
      Eggman: 100,
      "Floating World 25": 80,
      "Floating World Complete Collection": 212,
      "Floating World Fish of '97": 60,
      "Floating World Fish of Heat": 80,
      "Floating World Fish of Legends": 80,
      "Floating World Fish of Lies": 50,
      "KPDH - HUNTRX": 100,
      NieR: 100,
      "Persona 5": 100,
      Silksong: 100,
      "SxF - Operation Strix": 100,
      TMNT: 100,
      Vader: 100,
      "X-Men": 100,
    });
  });

  it("finds no Drive ids, drive paths, or local paths in the list files", () => {
    for (const file of readdirSync(listDir)) {
      const text = read(file);
      expect(text).not.toMatch(/drive\.google|folders\/|[A-Za-z]:\\/i);
      expect(text.toLowerCase()).not.toContain(["the", "monster"].join(""));
      expect(text).not.toMatch(/\b[01][A-Za-z0-9_-]{27,43}\b/);
    }
  });
});

describe("list order and defaults", () => {
  const make = (fileName: string) => parseDecklist("Deck\n1x Sol Ring\n", fileName);

  it("puts a bare decklist.txt first, then labels in natural order, with unique ids", () => {
    const ordered = orderDecklists([make("decklist - Fish of Lies.txt"), make("decklist - 25.txt"), make("decklist.txt"), make("decklist - 3.txt"), make("decklist - fish of lies.txt")]);
    expect(ordered.map((list) => list.label)).toEqual(["Deck list", "3", "25", "Fish of Lies", "fish of lies"]);
    expect(new Set(ordered.map((list) => list.id)).size).toBe(5);
    expect(ordered[4]!.id).toBe("fish-of-lies-2");
  });

  it("opens Complete Collection when it is there, else the first list, else none", () => {
    const lists = orderDecklists([make("decklist - Floating World 25.txt"), make("decklist - Floating World Complete Collection.txt")]);
    expect(defaultDecklist({ decklists: lists })?.label).toBe("Floating World Complete Collection");
    expect(defaultDecklist({ decklists: [lists[0]!] })?.label).toBe("Floating World 25");
    expect(defaultDecklist({ decklists: [] })).toBeNull();
    expect(defaultDecklist({})).toBeNull();
  });

  it("finds a saved list by id, falls back to the default for an unknown id, and opens none for an empty id", () => {
    const lists = orderDecklists([make("decklist - A.txt"), make("decklist - B.txt")]);
    expect(findDecklist({ decklists: lists }, "b")?.label).toBe("B");
    expect(findDecklist({ decklists: lists }, "gone")?.label).toBe("A");
    expect(findDecklist({ decklists: lists }, undefined)?.label).toBe("A");
    expect(findDecklist({ decklists: lists }, "")).toBeNull();
  });
});

describe("matching list lines to folder cards", () => {
  it("keys a card by face name without the art theme, a folder prefix, glued numbers, or Basic", () => {
    expect(cardKeys(card("a", "Watery Grave (Trail's End)"))).toContain("watery grave");
    expect(cardKeys(card("b", "Forest1 (Forge Dream)"))).toContain("forest");
    expect(cardKeys(card("c", "Plains3(Starlight Citadel)"))).toContain("plains");
    expect(cardKeys(card("d", "1 Island 4"))).toContain("island");
    expect(cardKeys(card("e", "Basic Island"))).toContain("island");
    expect(cardKeys(card("f", "Arid Archway.psd"))).toContain("arid archway");
    expect(cardKeys(card("g", "The Second Doctor( Loid Forger, Twilight)"))).toContain("second doctor");
    expect(cardKeys(card("h", "Cecil, Dark Knight (Lost Lace) // Cecil, Redeemed Paladin (Lace)"))).toContain("cecil dark knight");
    expect(cardKeys(card("i", "Commit - Memory"))).toContain("commit memory");
  });

  it("keys a list line by its whole name and the front half of a split or double-faced card", () => {
    expect(entryKeys("Commit // Memory")).toEqual(["commit memory", "commit"]);
    expect(entryKeys("Island")).toEqual(["island"]);
    expect(entryKeys("Snow-Covered Island")).toEqual(["snow covered island"]);
  });

  it("measures small spelling slips", () => {
    expect(editDistance("assassin trophy", "assassn trophy")).toBe(1);
    expect(editDistance("starfall invocation", "starfall incovation")).toBe(2);
    expect(editDistance("sol ring", "arcane signet")).toBe(3);
  });

  it("treats Flip 3 masks as unnamed prints, and a 1_2 back face as a face to pair, not a mask", () => {
    expect(isUnnamedMask({ name: "Flip 3" })).toBe(true);
    expect(isUnnamedMask({ name: "1_2 Lost Vale (Dimension X)" })).toBe(false);
    expect(isUnnamedMask({ name: "1_2_Lost Vale" })).toBe(false);
    expect(isUnnamedMask({ name: "Flipside Fiend" })).toBe(false);
    expect(isUnnamedMask({ name: "1_1 Dowsing Dagger" })).toBe(false);
  });
});

describe("list quantities", () => {
  const list = (text: string, file = "decklist - Test.txt") => parseDecklist(text, file);

  it("follows the list and opens a main card the list leaves out at 0", () => {
    const ed = edition([card("sol", "Sol Ring"), card("bolt", "Lightning Bolt (Zap)"), card("extra", "Mana Crypt")]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Sol Ring\n3x Lightning Bolt\n"));
    expect(Object.fromEntries(result.quantities)).toEqual({ sol: 1, bolt: 3, extra: 0 });
    expect(result.unlisted).toEqual(["Mana Crypt"]);
    expect(result.total).toBe(4);
    expect(result.listTotal).toBe(4);
  });

  it("keeps only the basics a list asks for, spread over that basic's arts", () => {
    const islands = Array.from({ length: 3 }, (_, index) => card(`is${index + 1}`, `Island ${index + 1}`));
    const swamps = [card("sw1", "Swamp 1"), card("sw2", "Swamp 2")];
    const ed = edition([...islands, ...swamps, card("forest", "Basic Forest")]);
    // One listed Island: the first art gets it, the leftover arts and every unlisted basic open at 0.
    const few = quantitiesFromDecklist(ed, list("Deck\n1x Island\n"));
    expect(Object.fromEntries(few.quantities)).toEqual({ is1: 1, is2: 0, is3: 0, sw1: 0, sw2: 0, forest: 0 });
    expect(few.total).toBe(1);
    expect(few.idleBasics).toEqual(["Island 2", "Island 3", "Swamp 1", "Swamp 2", "Basic Forest"]);
    expect(few.unlisted).toEqual([]);
    // More copies than arts: one each in turn, and the listed count is kept exactly.
    const many = quantitiesFromDecklist(ed, list("Deck\n7x Island\n4x Forest\n"));
    expect([...many.quantities.entries()].filter(([id]) => id.startsWith("is")).map(([, qty]) => qty)).toEqual([3, 2, 2]);
    expect(many.quantities.get("forest")).toBe(4);
    expect(many.quantities.get("sw1")).toBe(0);
    expect(many.quantities.get("sw2")).toBe(0);
    expect(many.total).toBe(11);
    expect(many.total).toBe(many.listTotal);
  });

  it("keeps a listed basic's copy count when it has more arts than copies", () => {
    const islands = Array.from({ length: 61 }, (_, index) => card(`is${index + 1}`, `Island ${index + 1}`));
    const result = quantitiesFromDecklist(edition([card("sol", "Sol Ring"), ...islands]), list("Deck\n1x Sol Ring\n13x Island\n"));
    const islandQty = islands.map((item) => result.quantities.get(item.id)!);
    expect(islandQty.reduce((sum, qty) => sum + qty, 0)).toBe(13);
    expect(islandQty.filter((qty) => qty === 1)).toHaveLength(13);
    expect(islandQty.filter((qty) => qty === 0)).toHaveLength(48);
    expect(result.total).toBe(14);
  });

  it("still never opens a basic land at 0 when there is no list", () => {
    const ed = edition([card("sol", "Sol Ring"), card("is1", "Island 1"), card("sw1", "Swamp 1")]);
    expect(withDecklist(ed, null)).toBe(ed);
    expect(withDecklist(ed, null).cards.every((item) => item.defaultQty >= 1)).toBe(true);
  });

  it("keeps a token that sits in the main deck folder in the main deck, even past 100", () => {
    const mains = Array.from({ length: 100 }, (_, index) => card(`c${index}`, `Card ${index}`));
    const ed = edition([...mains, card("tok", "Token - Treasure 1")]);
    const text = `Deck\n${mains.map((item) => `1x ${item.name}`).join("\n")}\n`;
    const result = quantitiesFromDecklist(ed, list(text));
    expect(result.quantities.get("tok")).toBe(1);
    expect(result.total).toBe(101);
    expect(result.keptTokens).toEqual(["Token - Treasure 1"]);
  });

  it("keeps unnamed partial-foil masks at their folder count", () => {
    const ed = edition([card("sol", "Sol Ring"), card("flip", "Flip 1"), card("zero", "Flip 2", { defaultQty: 0 })]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Sol Ring\n"));
    expect(Object.fromEntries(result.quantities)).toEqual({ sol: 1, flip: 1, zero: 0 });
    expect(result.keptMasks).toEqual(["Flip 1"]);
  });

  it("spreads a quantity over cards with the same name so each art keeps its own count", () => {
    const ed = edition([card("a1", "Arid Archway"), card("a2", "Arid Archway.psd"), card("b1", "Boomerang (One)"), card("b2", "Boomerang (Two)")]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Arid Archway\n5x Boomerang\n"));
    expect(Object.fromEntries(result.quantities)).toEqual({ a1: 1, a2: 0, b1: 3, b2: 2 });
  });

  it("reports list lines with no card in the folder and never invents one", () => {
    const ed = edition([card("isl", "Island 1")]);
    const result = quantitiesFromDecklist(ed, list("Deck\n10x Dandan\n2x Island\n"));
    expect(result.missing).toEqual([{ qty: 10, name: "Dandan" }]);
    expect([...result.quantities.keys()]).toEqual(["isl"]);
    expect(result.quantities.get("isl")).toBe(2);
  });

  it("matches near-miss file names one to one: a typo, a shortened name, or the same first two words", () => {
    const ed = edition([
      card("assassin", "Assassn's Trophy"),
      card("reki", "Reki, the History (Moira)"),
      card("thopter", "Thopter Spy Factory (Eggperial City)"),
      card("meat", "Meathook Massacre II"),
      card("sol", "Sol Ring"),
    ]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Assassin's Trophy\n1x Reki, the History of Kamigawa\n1x Thopter Spy Network\n1x Meathook Massacre 2\n"));
    expect(Object.fromEntries(result.quantities)).toEqual({ assassin: 1, reki: 1, thopter: 1, meat: 1, sol: 0 });
    expect(result.nearMisses.map((item) => item.card)).toEqual(["Assassn's Trophy", "Meathook Massacre II", "Reki, the History (Moira)", "Thopter Spy Factory (Eggperial City)"]);
    expect(result.missing).toEqual([]);
  });

  it("does not pair a near miss when two leftover files could be the card", () => {
    const ed = edition([card("a", "Thopter Spy Factory"), card("b", "Thopter Spy Tower")]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Thopter Spy Network\n"));
    expect(result.missing.map((entry) => entry.name)).toEqual(["Thopter Spy Network"]);
    expect(result.quantities.get("a")).toBe(0);
    expect(result.quantities.get("b")).toBe(0);
  });

  it("does not near-match a basic land or a token to a missing line", () => {
    const ed = edition([card("tok", "Token - Treasure 1"), card("isl", "Island 1")]);
    const result = quantitiesFromDecklist(ed, list("Deck\n1x Token - Treasure\n1x Islands\n"));
    expect(result.nearMisses).toEqual([]);
  });

  it("matches a double-faced card by its front name and leaves tokens and extras alone", () => {
    const dfc = card("cecil", "Cecil, Dark Knight (Lost Lace) // Cecil, Redeemed Paladin (Lace)");
    const extra = card("x", "Sol Ring", { role: "extra", defaultQty: 0 });
    const ed = edition([dfc, extra]);
    const result = quantitiesFromDecklist(ed, list("Commander\n1x Cecil, Dark Knight (FIN) 91\nDeck\n1x Sol Ring\n"));
    expect(Object.fromEntries(result.quantities)).toEqual({ cecil: 1 });
    expect(result.missing.map((entry) => entry.name)).toEqual(["Sol Ring"]);
  });

  it("applies a list without changing card ids, roles, arts, or non-main cards", () => {
    const tok = card("t", "Treasure", { role: "token", defaultQty: 0 });
    const ed = edition([card("sol", "Sol Ring"), card("cut", "Cut Card"), tok]);
    const listed = withDecklist(ed, list("Deck\n2x Sol Ring\n"));
    expect(listed.cards.map((item) => [item.id, item.role, item.defaultQty])).toEqual([
      ["sol", "main", 2],
      ["cut", "main", 0],
      ["t", "token", 0],
    ]);
    expect(listed.cards[0]!.faces).toBe(ed.cards[0]!.faces);
    expect(ed.cards[0]!.defaultQty).toBe(1);
    expect(withDecklist(ed, null)).toBe(ed);
  });

  it("explains the list in plain notes: missing lines, spelling, cut cards, basics, tokens, masks, and the sideboard", () => {
    const ed = edition([card("sol", "Sol Ring"), card("cut", "Cut Card"), card("isl", "Island 1"), card("isl2", "Island 2"), card("tok", "Token - Gold"), card("flip", "Flip 1"), card("typo", "Assassn's Trophy")]);
    const notes = decklistNotes(ed, list("Deck\n1x Sol Ring\n1x Dandan\n1x Assassin's Trophy\nSideboard\n1x Languish\n", "decklist - Vader.txt"));
    const byName = Object.fromEntries(notes.map((item) => [item.name, item]));
    expect(byName["Vader list"]?.level).toBe("ambiguous");
    expect(byName["Vader list"]?.reason).toContain("1x Dandan");
    expect(byName.Spelling?.reason).toContain("Assassin's Trophy → Assassn's Trophy");
    expect(byName["Not in this list"]?.reason).toContain("Cut Card");
    expect(byName["Basic lands"]?.reason).toMatch(/2 basic land art\(s\) it doesn't need open at 0/);
    expect(byName.Tokens?.reason).toContain("Token - Gold");
    expect(byName["Unnamed prints"]?.reason).toContain("Flip 1");
    expect(byName.Sideboard?.reason).toContain("1-card sideboard");
    expect(notes.every((item) => item.path === "decklist - Vader.txt")).toBe(true);
    expect(decklistNotes(edition([card("sol", "Sol Ring")]), list("Deck\n1x Sol Ring\n"))).toEqual([]);
  });
});
