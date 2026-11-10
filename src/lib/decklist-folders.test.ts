import { describe, expect, it } from "vitest";
import { parseDecklist, quantitiesFromDecklist, withDecklist } from "@/lib/decklist";
import { freshDraft } from "@/lib/draft";
import { readDecklistTexts, MAX_DECKLIST_FILES } from "@/lib/drive";
import { catalogueFromTree, decklistsInFolder } from "@/lib/group";
import { applyTone, countCopies, hasToneChoice, randomizeUnlocked, selectAllCards } from "@/lib/selection";
import type { RawNode } from "@/lib/types";

const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });

const LIST_A = "About\nName Fish A\n\nDeck\n2x Sol Ring\n1x Island\n";
const LIST_B = "Deck\n1x Arcane Signet\n";

describe("deck lists in an edition folder", () => {
  it("reads lists sitting directly in the edition folder, ignores subfolders, and orders them", () => {
    const node = folder("ed", "Standard Edition", [
      file("lb", "decklist - Fish B.txt"),
      file("la", "decklist - Fish A.txt"),
      file("notes", "readme.txt"),
      folder("full", "Full Deck", [file("deep", "decklist - Deep.txt"), file("sol", "Sol Ring.jpg")]),
    ]);
    const texts = new Map([
      ["la", LIST_A],
      ["lb", LIST_B],
      ["deep", LIST_B],
    ]);
    const { decklists, notes } = decklistsInFolder(node, { decklistTexts: texts });
    expect(decklists.map((list) => list.label)).toEqual(["Fish A", "Fish B"]);
    expect(decklists[0]!.title).toBe("Fish A");
    expect(notes).toEqual([]);
  });

  it("uses the shipped copy with the same file name when a folder list can't be read, and says so", () => {
    const node = folder("ed", "Deluxe Edition", [file("lx", "decklist - Vader.txt")]);
    const bundled = [parseDecklist("Deck\n1x Sol Ring\n", "decklist - Vader.txt")];
    const { decklists, notes } = decklistsInFolder(node, { decklistTexts: new Map(), bundledDecklists: bundled });
    expect(decklists).toEqual(bundled);
    expect(notes).toEqual([expect.objectContaining({ level: "info", name: "decklist - Vader.txt" })]);
  });

  it("opens folder counts with a visible note when a list can't be read and nothing is shipped for it", () => {
    const node = folder("ed", "Deluxe Edition", [file("lx", "decklist - Unknown.txt")]);
    const { decklists, notes } = decklistsInFolder(node, { decklistTexts: new Map([["lx", "   "]]) });
    expect(decklists).toEqual([]);
    expect(notes[0]).toMatchObject({ level: "ambiguous", name: "decklist - Unknown.txt" });
  });

  it("attaches each edition's own list in a pack, and leaves an edition with no list on folder counts", () => {
    const tree = folder("pack", "3_Fish", [
      folder("std", "1_Fish Standard Edition", [file("lstd", "decklist.txt"), folder("sfull", "Full Deck", [file("s1", "Sol Ring.jpg"), file("s2", "Island 1.jpg"), file("s3", "Island 2.jpg"), file("s4", "Arcane Signet.jpg")])]),
      folder("dx", "2_Fish Deluxe Edition", [folder("dfull", "Full Deck", [file("d1", "Sol Ring.jpg"), file("d4", "Arcane Signet.jpg")])]),
    ]);
    const catalogue = catalogueFromTree(tree, "Fish", [], { decklistTexts: new Map([["lstd", LIST_A]]) });
    const std = catalogue.editions.find((edition) => edition.name === "Standard")!;
    const dx = catalogue.editions.find((edition) => edition.name.startsWith("Deluxe"))!;
    expect(std.decklists?.map((list) => list.label)).toEqual(["Fish A"]);
    expect(dx.decklists).toBeUndefined();
    const draft = freshDraft(catalogue, std, "d", new Date(0));
    expect(draft.decklistId).toBe("fish-a");
    // 2x Sol Ring and 1x Island: the one listed Island goes to the first art, and Island 2 and the unlisted Arcane Signet open at 0.
    expect(countCopies(draft.cards)).toBe(3);
    expect(countCopies(freshDraft(catalogue, dx, "d", new Date(0)).cards)).toBe(2);
  });

  it("reads a partial foil edition's own list and a nested Deluxe's own list, and never the Standard one", () => {
    const tree = folder("pf", "3_Fish Partial Foil Edition", [
      file("lpf", "decklist - Fish.txt"),
      folder("pdf", "PDF Partial Foil Map", [folder("pfull", "Full Deck", [file("p1", "Sol Ring.pdf"), file("p2", "Arcane Signet.pdf"), file("p3", "Island 1.pdf")])]),
      folder("dx", "Deluxe Edition", [file("ldx", "decklist - Fish Deluxe.txt"), folder("dfull", "Full Deck", [file("d1", "Sol Ring.jpg"), file("d2", "Arcane Signet.jpg")])]),
      folder("std", "Standard Edition", [file("lstd", "decklist - Fish Standard.txt"), folder("sfull", "Full Deck", [file("s1", "Sol Ring.jpg")])]),
    ]);
    const catalogue = catalogueFromTree(tree, "Fish", [], {
      decklistTexts: new Map([
        ["lpf", LIST_B],
        ["ldx", LIST_A],
        ["lstd", LIST_A],
      ]),
    });
    expect(catalogue.editions.flatMap((edition) => edition.decklists ?? []).some((list) => list.label === "Fish Standard")).toBe(false);
    const pf = catalogue.editions.find((edition) => edition.printType === "partial_foil")!;
    const dx = catalogue.editions.find((edition) => edition.printType === "standard")!;
    expect(pf.decklists?.map((list) => list.label)).toEqual(["Fish"]);
    expect(dx.decklists?.map((list) => list.label)).toEqual(["Fish Deluxe"]);
    const pfQty = quantitiesFromDecklist(pf, pf.decklists![0]!);
    expect(pfQty.total).toBe(1);
    expect(pfQty.idleBasics).toEqual(["Island 1"]);
  });

  it("keeps a list file out of the cards and the skipped-file notes as a print", () => {
    const tree = folder("std", "Silksong Standard Edition", [file("l", "decklist - Silksong.txt"), folder("full", "Full Deck", [file("s", "Sol Ring.jpg")])]);
    const edition = catalogueFromTree(tree, "Silksong", [], { decklistTexts: new Map([["l", "Deck\n1x Sol Ring\n"]]) }).editions[0]!;
    expect(edition.cards.map((card) => card.name)).toEqual(["Sol Ring"]);
    expect(JSON.stringify(edition.decklists)).not.toContain('"l"');
  });
});

describe("reading list files during unlock", () => {
  const tree = folder("root", "Pack", [
    file("list1", "decklist - One.txt"),
    folder("ed", "Deluxe Edition", [file("list2", "decklist.txt"), file("img", "Sol Ring.jpg"), file("link", "New Drive Link.txt")]),
    file("list1", "decklist - One.txt"),
  ]);

  it("downloads only deck list files, once each, and skips one that fails", async () => {
    const asked: string[] = [];
    const fetchImpl = async (input: string) => {
      const url = String(input);
      asked.push(url.match(/files\/([^?]+)/)?.[1] ?? url);
      if (url.includes("list2")) return new Response("nope", { status: 403 });
      return new Response("Deck\n1x Sol Ring\n");
    };
    const texts = await readDecklistTexts(tree, "test-key", fetchImpl);
    expect(asked).toEqual(["list1", "list2"]);
    expect([...texts.keys()]).toEqual(["list1"]);
    expect(texts.get("list1")).toContain("Sol Ring");
  });

  it("stops after a fixed number of list files", async () => {
    const many = folder("root", "Pack", Array.from({ length: MAX_DECKLIST_FILES + 5 }, (_, index) => file(`l${index}`, `decklist - ${index}.txt`)));
    let calls = 0;
    const texts = await readDecklistTexts(many, "k", async () => {
      calls += 1;
      return new Response("Deck\n1 Sol Ring\n");
    });
    expect(calls).toBe(MAX_DECKLIST_FILES);
    expect(texts.size).toBe(MAX_DECKLIST_FILES);
  });
});

/** SxF layout: 35 always-color cards, IMPORTANT OPTIONS with Color and Black and White (53 each plus basics). */
function sxfTree(kind: "standard" | "deluxe", withList: boolean): RawNode {
  const manga = Array.from({ length: 35 }, (_, index) => file(`m${index}`, `Manga ${index + 1}.jpg`));
  const options = (prefix: string) => Array.from({ length: 53 }, (_, index) => file(`${prefix}${index}`, `Option ${index + 1}.jpg`));
  const basics = (prefix: string) => folder(`${prefix}lands`, "Basic Lands", [file(`${prefix}i1`, "Island 1.jpg"), file(`${prefix}i2`, "Island 2.jpg"), file(`${prefix}p1`, "Plains 1.jpg")]);
  const bwName = kind === "deluxe" ? "Black & White" : "Black and White";
  const full = folder(`${kind}full`, "Full Deck", [
    ...manga,
    folder(`${kind}opts`, "IMPORTANT OPTIONS", [
      folder(`${kind}color`, "Color", [...options(`${kind}c`), basics(`${kind}c`)]),
      folder(`${kind}bw`, bwName, [...options(`${kind}b`), basics(`${kind}b`)]),
    ]),
  ]);
  const name = kind === "deluxe" ? "2_Spy x Family Deluxe Edition" : "1_Spy x Family Standard Edition";
  return folder(`${kind}root`, name, [...(withList ? [file(`${kind}list`, "decklist - SxF - Operation Strix.txt")] : []), full]);
}

const SXF_LIST = `Commander\n1x Manga 1\nDeck\n${Array.from({ length: 34 }, (_, i) => `1x Manga ${i + 2}`).join("\n")}\n${Array.from({ length: 53 }, (_, i) => `1x Option ${i + 1}`).join("\n")}\n6x Island\n4x Plains\n`;

describe("SxF without a usable list falls back to 35 + 53 + basic lands", () => {
  for (const kind of ["standard", "deluxe"] as const) {
    it(`${kind}: groups one card per option with a Color and a Black and White file, and opens on Color`, () => {
      const catalogue = catalogueFromTree(sxfTree(kind, false), "SxF");
      const edition = catalogue.editions[0]!;
      const mains = edition.cards.filter((card) => card.role === "main");
      expect(mains).toHaveLength(35 + 53 + 3);
      expect(edition.decklists).toBeUndefined();
      expect(hasToneChoice(edition)).toBe(true);
      const option = mains.find((card) => card.name === "Option 1")!;
      expect(option.faces[0]!.defaultArt).toMatchObject({ id: `${kind}c0`, tone: "color" });
      expect(option.faces[0]!.alternates).toEqual([expect.objectContaining({ id: `${kind}b0`, tone: "bw" })]);
      expect(mains.find((card) => card.name === "Manga 1")!.faces[0]!.defaultArt?.tone).toBeUndefined();
      const draft = freshDraft(catalogue, edition, "d", new Date(0));
      expect(draft.tone).toBe("color");
      expect(countCopies(draft.cards)).toBe(91);
      const bw = applyTone(edition, draft.cards, "bw");
      const arts = new Map(bw.map((row) => [row.cardId, row.pairs[0]!.art]));
      expect(arts.get(option.id)).toBe(`${kind}b0`);
      expect(arts.get(mains.find((card) => card.name === "Island 1")!.id)).toBe(`${kind}bi1`);
      expect(arts.get(mains.find((card) => card.name === "Manga 1")!.id)).toBe("m0");
    });

    it(`${kind}: a list in the folder is preferred over the fallback and keeps the toggle`, () => {
      const tree = sxfTree(kind, true);
      const catalogue = catalogueFromTree(tree, "SxF", [], { decklistTexts: new Map([[`${kind}list`, SXF_LIST]]) });
      const edition = catalogue.editions[0]!;
      const draft = freshDraft(catalogue, edition, "d", new Date(0));
      expect(draft.decklistId).toBe("sxf-operation-strix");
      expect(countCopies(draft.cards)).toBe(35 + 53 + 6 + 4);
      expect(hasToneChoice(edition)).toBe(true);
    });
  }

  it("All cards and Random stay in the chosen print set", () => {
    const catalogue = catalogueFromTree(sxfTree("standard", false), "SxF");
    const edition = catalogue.editions[0]!;
    const option = edition.cards.find((card) => card.name === "Option 2")!;
    const all = selectAllCards(edition, [], "bw");
    expect(all.find((row) => row.cardId === option.id)!.pairs[0]!.art).toBe("standardb1");
    const random = randomizeUnlocked(edition, [], () => 0, "bw");
    expect(random.find((row) => row.cardId === option.id)!.pairs[0]!.art).toBe("standardb1");
    const colorRandom = randomizeUnlocked(edition, [], () => 0.99, "color");
    expect(colorRandom.find((row) => row.cardId === option.id)!.pairs[0]!.art).toBe("standardc1");
  });

  it("never moves an always-color card that has its own alternate art", () => {
    const catalogue = catalogueFromTree(sxfTree("standard", false), "SxF");
    const base = catalogue.editions[0]!;
    const manga = base.cards.find((card) => card.name === "Manga 1")!;
    const edition = {
      ...base,
      cards: base.cards.map((card) => (card.id === manga.id ? { ...card, faces: [{ ...card.faces[0]!, alternates: [{ id: "manga-alt", name: "Manga 1 2.jpg", thumbId: "manga-alt", label: "Manga 1 2" }] }] } : card)),
    };
    const rows = [{ cardId: manga.id, locked: false, pairs: [{ art: "m0", qty: 1 }, { art: "manga-alt", qty: 1 }] }];
    expect(applyTone(edition, rows, "bw")).toEqual(rows);
    expect(applyTone(edition, rows, "color")).toEqual(rows);
  });

  it("does not tag files when only one of the two option folders exists", () => {
    const tree = folder("std", "1_Spy x Family Standard Edition", [
      folder("full", "Full Deck", [file("m", "Manga 1.jpg"), folder("opts", "IMPORTANT OPTIONS", [folder("c", "Color", [file("c1", "Option 1.jpg")])])]),
    ]);
    const edition = catalogueFromTree(tree, "SxF").editions[0]!;
    expect(hasToneChoice(edition)).toBe(false);
  });

  it("never offers the switch on a partial foil edition", () => {
    const edition = { ...withDecklist(catalogueFromTree(sxfTree("standard", false), "SxF").editions[0]!, null), printType: "partial_foil" as const };
    expect(hasToneChoice(edition)).toBe(false);
  });
});
