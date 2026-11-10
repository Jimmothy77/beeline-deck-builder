import { describe, expect, it } from "vitest";
import { buildShippedStandardTree, parseEmbeddedFolder, type ListedFolder, type Lister } from "@/lib/crawl";
import { artIdsOf, catalogueFromTree, groupPartialFoilEdition, isTemplateOrFontFolder, pdfIdsInEdition, productEditionKind } from "@/lib/group";
import { cleanDeckName, preferDeckName } from "@/lib/names";
import { designedSelection, randomizeUnlocked, selectAllCards, selectionToSlots } from "@/lib/selection";
import { splitExportByPrintType } from "@/lib/xml";
import type { RawNode } from "@/lib/types";

function file(id: string, name: string): RawNode {
  return { id, name, folder: false };
}
function folder(id: string, name: string, children: RawNode[]): RawNode {
  return { id, name, folder: true, children };
}

function standardTree(): RawNode {
  return folder("standardRoot1", "1_ Silksong Standard Edition", [
    folder("fullDeck0001", "Full Deck", [
      folder("cardBacks001", "Card Back", [file("backfile0001", "Card Back 1.jpg"), file("backfile0002", "Card Back 2.jpg")]),
      folder("tokens000001", "Tokens", [
        folder("whiteKnight01", "2-2 White Knight", [file("knightart0001", "Knight 1.jpg"), file("knightart0002", "Knight 2.jpg")]),
        folder("blueKnight001", "2-2 White Blue Knight", [file("blueknight001", "Knight 1.jpg"), file("blueknight002", "Knight 10.jpg")]),
        file("golemfile001", "Golem (Cogwork Dancers).jpg"),
      ]),
      file("plains1file1", "Plains 1.jpg"),
      file("plains3file1", "Plains 3.jpg"),
      file("solringfile1", "Sol Ring.jpg"),
      file("marshfile001", "Marsh Flats (Greymoor) 1.jpg"),
      file("teferifile01", "Teferi's Protection (Bench) 1.jpg"),
      file("gravefile001", "Watery Grave (Trail's End).jpg"),
      file("islandfile01", "Island.jpg"),
      file("talismanDom1", "Talisman of Dominance (Herrah).jpg"),
      file("talismanPro1", "Talisman of Progress (Monomon).jpg"),
      file("cecilfront01", "1_1_Cecil, Dark Knight (Lost Lace).jpg"),
      file("cecilback001", "1_2_Cecil, Redeemed Paladin (Lace).jpg"),
      file("kinsbaile001", "Kinsbaile Cavalier (Garmond & Zaza).jpg"),
      file("swampfile001", "Swamp.jpg"),
      file("loctmain0001", "Locthwain Lancer (Last Judge).jpg"),
      file("marinermain1", "Unsettled Mariner (Crust King Khann).jpg"),
      file("skymain00001", "Suppressor Skyguard (Nyleth and Seth).jpg"),
    ]),
    folder("extras000001", "Extras", [
      folder("solfolder001", "Sol Ring", [file("solalt000001", "Sol Ring 1.jpg"), file("solalt000002", "Sol Ring 2.jpg")]),
      folder("plains3fold1", "Plains 3 (Crystal Peak)", [file("plains3alt01", "Plains 3 1.jpg"), file("plains3alt02", "Plains 3 2.jpg")]),
      folder("marshfolder1", "Marsh Flats (Greymoor)", [file("marshalt0001", "Marsh Flats (Greymoor) 1.jpg"), file("marshalt0002", "Marsh Flats (Greymoor) 2.jpg")]),
      folder("teferifolder", "Teferi's Protection (Bench's Repose)", [file("teferialt001", "Teferi's Protection (Bench) 2.jpg")]),
      folder("gravefolder1", "Watery Grave", [file("gravealt0001", "Watery Grave (Trail's End) 1.jpg")]),
      folder("islandfolder", "Island (Fog Canyon)", [file("islandalt001", "Island 1.jpg")]),
      folder("talismanfold", "Talismans", [
        file("taldomalt001", "Talisman of Dominance (Herrah) 1.jpg"),
        file("talproalt001", "Talisman of Progress (Monomon) 1.jpg"),
      ]),
      folder("cecilfolder1", "Cecil (Lace)", [
        file("cecilalt0001", "1_1_Cecil, Dark Knight (Lost Lace) 1.jpg"),
        file("cecilalt0002", "1_2_Cecil, Redeemed Paladin (Lace) 4.jpg"),
      ]),
      folder("dualsfolder1", "True Duals", [file("scrubland001", "Scrubland (The Cradle).jpg"), file("tundrafile01", "Tundra (Mount Fay).jpg")]),
      folder("kinsfolder01", "Kinsbaile Cavalier (Garmond and Zaza)", [file("kinsalt00001", "Kinsbaile Cavalier (Garmond and Zaza) 1.jpg")]),
      folder("swampfolder1", "Swamp (Shellwood)", [file("swampalt0001", "Swamp 1.jpg")]),
      folder("loctfolder01", "Locthwain Lancer (The Last Judge)", [
        file("locttypo0001", "Lochtwain Lancer (Last Judge) 1.jpg"),
        file("locttypo0002", "Lochtwain Lancer (Last Judge) 2.jpg"),
      ]),
      folder("sethfolder01", "Unsettled Mariner (Crust King Khann - Shrine Guardian Seth)", [
        file("sethfile0001", "Unsettled Mariner (Seth) 2.jpg"),
        file("sethfile0002", "Unsettled Mariner (Seth) 3.jpg"),
      ]),
      folder("skyfolder001", "Suppressor Skyguard (Nyleth and Seth - The Hive Knight)", [
        file("skyhive00001", "Suppressor Skyguard (The Hive Knight) 2.jpg"),
      ]),
      file("alelafile001", "Alela, Artful Provocateur.jpg"),
    ]),
  ]);
}

describe("standard grouping", () => {
  const edition = catalogueFromTree(standardTree()).editions[0]!;

  function card(name: string) {
    const found = edition.cards.find((item) => item.name === name);
    if (!found) throw new Error(`missing card ${name}`);
    return found;
  }

  it("keeps basic lands apart and attaches only the matching alternates", () => {
    const plains1 = card("Plains 1");
    const plains3 = card("Plains 3");
    expect(plains1.role).toBe("main");
    expect(plains1.faces[0]!.alternates).toHaveLength(0);
    expect(plains3.faces[0]!.alternates.map((art) => art.id).sort()).toEqual(["plains3alt01", "plains3alt02"]);
    expect(edition.printType).toBe("standard");
  });

  it("groups alternates, double-faced cards, tokens, and unpacked extras", () => {
    expect(card("Sol Ring").faces[0]!.alternates.map((art) => art.id)).toEqual(["solalt000001", "solalt000002"]);
    expect(card("Marsh Flats (Greymoor)").faces[0]!.defaultArt?.id).toBe("marshfile001");
    expect(card("Marsh Flats (Greymoor)").faces[0]!.alternates.map((art) => art.id)).toContain("marshalt0002");
    expect(card("Teferi's Protection (Bench)").faces[0]!.alternates.map((art) => art.id)).toEqual(["teferialt001"]);
    expect(card("Watery Grave (Trail's End)").faces[0]!.alternates).toHaveLength(1);
    expect(card("Island").faces[0]!.alternates.map((art) => art.id)).toEqual(["islandalt001"]);
    expect(card("Swamp").faces[0]!.alternates.map((art) => art.id)).toEqual(["swampalt0001"]);
    expect(card("Kinsbaile Cavalier (Garmond & Zaza)").faces[0]!.alternates).toHaveLength(1);
    expect(card("Talisman of Dominance (Herrah)").faces[0]!.alternates.map((art) => art.id)).toEqual(["taldomalt001"]);
    expect(card("Talisman of Progress (Monomon)").faces[0]!.alternates).toHaveLength(1);
    expect(edition.cards.some((item) => item.name === "Talismans")).toBe(false);

    const cecil = edition.cards.find((item) => item.name.includes("Cecil, Dark Knight"))!;
    expect(cecil.faces).toHaveLength(2);
    expect(cecil.faces[0]!.defaultArt?.id).toBe("cecilfront01");
    expect(cecil.faces[0]!.alternates.map((art) => art.id)).toEqual(["cecilalt0001"]);
    expect(cecil.faces[1]!.defaultArt?.id).toBe("cecilback001");
    expect(cecil.faces[1]!.alternates.map((art) => art.id)).toEqual(["cecilalt0002"]);
    expect(cecil.defaultQty).toBe(1);

    const knight = card("2-2 White Knight");
    const blue = card("2-2 White Blue Knight");
    expect(knight.role).toBe("token");
    expect(knight.defaultQty).toBe(0);
    expect(knight.faces[0]!.defaultArt?.id).toBe("knightart0001");
    expect(knight.faces[0]!.alternates.map((art) => art.id)).toEqual(["knightart0002"]);
    expect(blue.faces[0]!.alternates.map((art) => art.id)).toContain("blueknight002");
    expect(card("Golem (Cogwork Dancers)").role).toBe("token");

    expect(card("Scrubland (The Cradle)").role).toBe("extra");
    expect(card("Tundra (Mount Fay)").role).toBe("extra");
    expect(card("Alela, Artful Provocateur").role).toBe("extra");
    expect(edition.backs.map((back) => back.id)).toEqual(["backfile0001", "backfile0002"]);
    expect(edition.notes.some((note) => note.name === "True Duals" && note.level === "ambiguous")).toBe(true);
    expect(card("Locthwain Lancer (Last Judge)").faces[0]!.alternates.map((art) => art.id).sort()).toEqual(["locttypo0001", "locttypo0002"]);
    expect(card("Unsettled Mariner (Crust King Khann)").faces[0]!.alternates.map((art) => art.id)).toEqual(["sethfile0001", "sethfile0002"]);
    expect(card("Suppressor Skyguard (Nyleth and Seth)").faces[0]!.alternates.map((art) => art.id)).toEqual(["skyhive00001"]);
    expect(edition.cards.some((item) => item.name.includes("Lochtwain"))).toBe(false);
    expect(edition.cards.some((item) => item.role === "extra" && item.name.includes("Seth"))).toBe(false);
  });
});

describe("paid editions stay separated", () => {
  const tree = folder("silksongroot", "3_Silksong", [
    folder("standardOnly1", "1_ Silksong Standard Edition", [
      folder("fullA", "Full Deck", [file("stdsolring1", "Sol Ring.jpg"), folder("backsA", "Card Back", [file("stdback00001", "Card Back 1.jpg")])]),
      folder("extrasA", "Extras", []),
    ]),
    folder("deluxeWrap001", "2_Silksong Deluxe Edition", [
      folder("deluxe1200dpi", "Deluxe Edition (1200 DPI)", [
        folder("fullB", "Full Deck", [file("deluxesol01", "Sol Ring.png")]),
        folder("extrasB", "Extras", [folder("solB", "Sol Ring", [file("deluxealt001", "Sol Ring 2.png")])]),
      ]),
      folder("empty600dpi1", "Standard Edition (600 DPI)", []),
      folder("templates0001", "Templates", [file("templatepsd1", "Template.psd")]),
    ]),
    folder("partialWrap01", "3_Silksong Partial Foil Edition", [
      folder("previewMap001", "Partial Foil Map", [file("previewsol01", "Sol Ring.png")]),
      folder("pdfMap0000001", "PDF Partial Foil Map", [
        folder("pdfDeck000001", "Full Deck + Tokens Folder", [
          file("pdfsolring01", "Sol Ring.pdf"),
          file("loosejpg0001", "Preview Only.jpg"),
          file("pdfcardback1", "card back.png"),
          folder("front00000001", "Front", [file("pdftoken0001", "Token 1.pdf"), file("pdfFlip000001", "Flip 1.pdf")]),
          folder("back000000001", "Back", [file("pdftokenback", "Token 1.pdf"), file("pdfFlipBack01", "Flip 1.png")]),
        ]),
        folder("pdfExtras0001", "Extras", [
          folder("altArts000001", "Alternate Arts", [file("pdfsolalt001", "Sol Ring 2.pdf")]),
          folder("altCards00001", "Alternate Cards", [file("pdfalela0001", "Alela (Hornet).pdf")]),
        ]),
      ]),
      file("readmetxt0001", "Readme.txt"),
      folder("emptyDeluxe1", "Deluxe Edition", []),
    ]),
  ]);

  const catalogue = catalogueFromTree(tree);

  it("puts deluxe with standard prints and partial foil on its own", () => {
    const standard = catalogue.editions.find((edition) => edition.id === "standard")!;
    const deluxe = catalogue.editions.find((edition) => edition.id === "2-silksong-deluxe-edition")!;
    const partial = catalogue.editions.find((edition) => edition.id === "partial-foil")!;
    expect(standard.printType).toBe("standard");
    expect(deluxe.printType).toBe("standard");
    expect(partial.printType).toBe("partial_foil");
    expect(artIdsOf(standard).has("deluxesol01")).toBe(false);
    expect(artIdsOf(standard).has("pdfsolring01")).toBe(false);
    expect(artIdsOf(deluxe).has("stdsolring1")).toBe(false);
    expect(artIdsOf(partial).has("stdsolring1")).toBe(false);
    expect(artIdsOf(partial).has("previewsol01")).toBe(false);
    expect(artIdsOf(partial).has("loosejpg0001")).toBe(false);
    expect(artIdsOf(deluxe).has("templatepsd1")).toBe(false);

    const partialSol = partial.cards.find((card) => card.name === "Sol Ring")!;
    expect(partialSol.faces[0]!.defaultArt?.id).toBe("pdfsolring01");
    expect(partialSol.faces[0]!.defaultArt?.thumbId).toBe("deluxesol01");
    expect(partialSol.faces[0]!.defaultArt?.thumbId).not.toBe("previewsol01");
    expect(partialSol.faces[0]!.alternates.map((art) => art.id)).toEqual(["pdfsolalt001"]);
    expect(partial.backs.map((back) => back.id)).toEqual(["pdfcardback1"]);
    expect(partial.cards.find((card) => card.name === "Token 1")!.faces).toHaveLength(2);
    expect(partial.cards.find((card) => card.name === "Token 1")!.role).toBe("token");
    expect(partial.cards.find((card) => card.name === "Flip 1")!.role).toBe("main");
    expect(partial.cards.find((card) => card.name === "Alela (Hornet)")!.role).toBe("extra");
    expect(partial.notes.some((note) => note.level === "ambiguous" && note.name === "Front / Back")).toBe(true);
  });
});

describe("shipped crawl boundaries", () => {
  it("does not treat a Deluxe or Partial Foil root as the free standard edition", async () => {
    const list: Lister = async (id) => {
      const pages: Record<string, ListedFolder> = {
        deluxeRoot: { title: "2_Example Deluxe Edition", entries: [{ id: "full0001", name: "Full Deck", folder: true }] },
        partialRoot: { title: "3_Example Partial Foil Edition", entries: [{ id: "pdf00001", name: "PDF Partial Foil Map", folder: true }] },
      };
      return pages[id] ?? { title: id, entries: [] };
    };
    await expect(buildShippedStandardTree({ rootId: "deluxeRoot", deckQuery: "deluxe", list })).rejects.toThrow(/Deluxe and Partial Foil/);
    await expect(buildShippedStandardTree({ rootId: "partialRoot", deckQuery: "partial", list })).rejects.toThrow(/Deluxe and Partial Foil/);
  });

  it("refuses several folders that each hold a Full Deck, and does not treat a pdf folder as an image set", async () => {
    const requested: string[] = [];
    const list: Lister = async (id) => {
      requested.push(id);
      const pages: Record<string, ListedFolder> = {
        rootMany: {
          title: "Decks",
          entries: [{ id: "deckMany", name: "9_Example", folder: true }],
        },
        deckMany: {
          title: "9_Example",
          entries: [
            { id: "wrapOne", name: "Example A", folder: true },
            { id: "wrapTwo", name: "Example B", folder: true },
          ],
        },
        wrapOne: { title: "Example A", entries: [{ id: "fullA", name: "Full Deck", folder: true }] },
        wrapTwo: { title: "Example B", entries: [{ id: "fullB", name: "Full Deck", folder: true }] },
        rootPdf: { title: "Decks", entries: [{ id: "deckPdf", name: "8_Example", folder: true }] },
        deckPdf: { title: "8_Example", entries: [{ id: "innerPdf", name: "Example", folder: true }] },
        innerPdf: { title: "Example", entries: [{ id: "notimage", name: "Sol Ring.pdf", folder: false }] },
      };
      const found = pages[id];
      if (!found) throw new Error(`refusing to list ${id}`);
      return found;
    };
    await expect(buildShippedStandardTree({ rootId: "rootMany", deckQuery: "example", list })).rejects.toThrow(/More than one folder holds a Full Deck/);
    await expect(buildShippedStandardTree({ rootId: "rootPdf", deckQuery: "example", list })).rejects.toThrow(/No Standard edition/);
    expect(requested).toContain("innerPdf");
  });

  it("does not treat an empty folder or a folder that contains another folder as a card image set", async () => {
    const list: Lister = async (id) => {
      const pages: Record<string, ListedFolder> = {
        rootEmpty: { title: "Decks", entries: [{ id: "deckEmpty", name: "7_Example", folder: true }] },
        deckEmpty: { title: "7_Example", entries: [{ id: "innerEmpty", name: "Example", folder: true }] },
        innerEmpty: { title: "Example", entries: [{ id: "readme0001", name: "readme.txt", folder: false }] },
        rootJunk: { title: "Decks", entries: [{ id: "deckJunk", name: "5_Example", folder: true }] },
        deckJunk: { title: "5_Example", entries: [{ id: "innerJunk", name: "Example", folder: true }] },
        innerJunk: {
          title: "Example",
          entries: [
            { id: "soljunk", name: "Sol Ring.png", folder: false },
            { id: "notejunk", name: "notes.txt", folder: false },
          ],
        },
        rootNested: { title: "Decks", entries: [{ id: "deckNested", name: "6_Example", folder: true }] },
        deckNested: { title: "6_Example", entries: [{ id: "innerNested", name: "Example", folder: true }] },
        innerNested: {
          title: "Example",
          entries: [
            { id: "solimg0001", name: "Sol Ring.png", folder: false },
            { id: "morefolder1", name: "More", folder: true },
          ],
        },
        morefolder1: { title: "More", entries: [{ id: "islandimg1", name: "Island.png", folder: false }] },
      };
      const found = pages[id];
      if (!found) throw new Error(`refusing to list ${id}`);
      return found;
    };
    await expect(buildShippedStandardTree({ rootId: "rootEmpty", deckQuery: "example", list })).rejects.toThrow(/No Standard edition/);
    await expect(buildShippedStandardTree({ rootId: "rootJunk", deckQuery: "example", list })).rejects.toThrow(/No Standard edition/);
    await expect(buildShippedStandardTree({ rootId: "rootNested", deckQuery: "example", list })).rejects.toThrow(/No Standard edition/);
  });
});

describe("shipped crawl never requests paid folders", () => {
  it("parses the embedded folder view", () => {
    const html = `<html><head><title>3_Silksong</title></head><body><div class="flip-entries">
      <div class="flip-entry" id="entry-standardID01"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/standardID01"><div aria-label="Folder"></div><div class="flip-entry-title">1_ Silksong Standard Edition</div></a></div></div>
      <div class="flip-entry" id="entry-deluxeID0001"><a href="https://drive.google.com/drive/folders/deluxeID0001"><div class="flip-entry-title">2_Silksong Deluxe Edition</div></a></div>
      <div class="flip-entry" id="entry-fileSol00001"><div class="flip-entry-title">Sol Ring &amp; Co.jpg</div></div>
    </div></body></html>`;
    const listed = parseEmbeddedFolder(html);
    expect(listed.title).toBe("3_Silksong");
    expect(listed.entries.map((entry) => [entry.name, entry.folder])).toEqual([
      ["1_ Silksong Standard Edition", true],
      ["2_Silksong Deluxe Edition", true],
      ["Sol Ring & Co.jpg", false],
    ]);
  });

  it("lists the standard edition only", async () => {
    const requested: string[] = [];
    const list: Lister = async (id) => {
      requested.push(id);
      const pages: Record<string, ListedFolder> = {
        rootFolder01: {
          title: "Decks",
          entries: [
            { id: "deckSilksong", name: "3_Silksong", folder: true },
            { id: "deckVader0001", name: "4_Vader", folder: true },
          ],
        },
        deckSilksong: {
          title: "3_Silksong",
          entries: [
            { id: "standardFold", name: "1_ Silksong Standard Edition", folder: true },
            { id: "deluxeFolder1", name: "2_Silksong Deluxe Edition", folder: true },
            { id: "partialFoil1", name: "3_Silksong Partial Foil Edition", folder: true },
          ],
        },
        standardFold: {
          title: "1_ Silksong Standard Edition",
          entries: [
            { id: "fullDeckFold", name: "Full Deck", folder: true },
            { id: "extrasFolder", name: "Extras", folder: true },
          ],
        },
        fullDeckFold: { title: "Full Deck", entries: [{ id: "solringfilex", name: "Sol Ring.jpg", folder: false }] },
        extrasFolder: { title: "Extras", entries: [] },
      };
      const found = pages[id];
      if (!found) throw new Error(`refusing to list ${id}`);
      return found;
    };
    const built = await buildShippedStandardTree({ rootId: "rootFolder01", deckQuery: "silksong", list });
    expect(requested).not.toContain("deluxeFolder1");
    expect(requested).not.toContain("partialFoil1");
    expect(requested).not.toContain("deckVader0001");
    expect(built.skipped).toEqual(["2_Silksong Deluxe Edition", "3_Silksong Partial Foil Edition"]);
    expect(built.deckName).toBe("Silksong");
    const ids = JSON.stringify(built.tree);
    expect(ids).not.toContain("deluxeFolder1");
    expect(ids).not.toContain("partialFoil1");
    expect(ids).toContain("solringfilex");
    expect(productEditionKind("Partial Foil Map")).toBe("partial_foil");
    expect(productEditionKind("PDF Partial Foil Map")).toBe("partial_foil");
    expect(productEditionKind("PDF Print Map")).toBeNull();
    expect(productEditionKind("3_Silksong Partial Foil Edition")).toBe("partial_foil");
    expect(productEditionKind("2_Silksong Deluxe Edition")).toBe("deluxe");
    expect(productEditionKind("Deluxe Partial Foil")).toBe("deluxe");
    expect(productEditionKind("Partial Foil Edition (Standard Holo)")).toBe("partial_foil");
    expect(productEditionKind("Partial-Foil")).toBe("partial_foil");
    expect(productEditionKind("partial_foil")).toBe("partial_foil");
    expect(productEditionKind("PartialFoil")).toBe("partial_foil");
    expect(productEditionKind("DeLuxe")).toBe("deluxe");
    expect(productEditionKind("deLuxe Edition")).toBe("deluxe");
    expect(productEditionKind("Nonstandard art")).toBeNull();
    expect(productEditionKind("Standard Bearer")).toBeNull();
    expect(productEditionKind("Substandard")).toBeNull();
    expect(productEditionKind("Partial Foil Templates")).toBeNull();
    expect(productEditionKind("Partial Foil Fonts")).toBeNull();
    expect(productEditionKind("Font of Mythos")).toBeNull();
    expect(isTemplateOrFontFolder("Font of Mythos")).toBe(false);
    expect(isTemplateOrFontFolder("Partial Foil Templates")).toBe(true);
    expect(isTemplateOrFontFolder("Partial Foil Fonts")).toBe(true);
    expect(productEditionKind("Non-Standard")).toBeNull();
    expect(productEditionKind("Standard Edition")).toBe("standard");
  });
});

describe("a Deluxe PDF Print Map stays standard", () => {
  it("does not export printType partial_foil", () => {
    const tree = folder("deluxeRoot001", "2_Silksong Deluxe Edition", [
      folder("pdfPrintMap1", "PDF Print Map", [
        file("mapjpg000001", "Sol Ring.jpg"),
        file("mappdf000001", "Sol Ring.pdf"),
      ]),
      folder("deluxeFull001", "Full Deck", [file("deluxejpg001", "Sol Ring.jpg")]),
    ]);
    const edition = catalogueFromTree(tree).editions[0]!;
    expect(edition.id).toBe("2-silksong-deluxe-edition");
    expect(edition.printType).toBe("standard");
    expect(artIdsOf(edition).has("deluxejpg001")).toBe(true);
    expect(artIdsOf(edition).has("mapjpg000001")).toBe(false);
    expect(artIdsOf(edition).has("mappdf000001")).toBe(false);
    expect(edition.cards.every((card) => card.faces.every((face) => !/\.pdf$/i.test(face.defaultArt?.name ?? "")))).toBe(true);
  });
});

describe("partial foil ignores deluxe PDF trees", () => {
  const ownPdf = "ownpdf000000000000000000000001";
  const deluxeA = "deluxepdf00000000000000000001";
  const deluxeB = "deluxepdf00000000000000000002";
  const deluxeC = "deluxepdf00000000000000000003";
  const backId = "cardback000000000000000000001";

  function pack() {
    return folder("partialRoot1", "3_Silksong Partial Foil Edition", [
      folder("pdfMap000001", "PDF Map", [
        folder("ownFull00001", "Full Deck", [
          file(ownPdf, "Sol Ring.pdf"),
          file(backId, "card back.png"),
        ]),
      ]),
      folder("deluxeInside1", "Deluxe Edition", [
        folder("deluxePdf001", "PDF", [
          folder("deluxeFull01", "Full Deck", [
            file(deluxeA, "A.pdf"),
            file(deluxeB, "B.pdf"),
            file(deluxeC, "C.pdf"),
          ]),
        ]),
      ]),
    ]);
  }

  it("keeps the one PDF from PDF Map and drops the three Deluxe PDFs", () => {
    const edition = groupPartialFoilEdition(pack());
    expect(edition.printType).toBe("partial_foil");
    expect(artIdsOf(edition).has(ownPdf)).toBe(true);
    expect(artIdsOf(edition).has(deluxeA)).toBe(false);
    expect(artIdsOf(edition).has(deluxeB)).toBe(false);
    expect(artIdsOf(edition).has(deluxeC)).toBe(false);
    expect(edition.cards.filter((card) => card.role === "main")).toHaveLength(1);
  });

  it("builds XML from that tree through the normal selection", () => {
    const edition = catalogueFromTree(pack()).editions[0]!;
    const slots = selectionToSlots(edition, designedSelection(edition));
    const [xml] = splitExportByPrintType({
      deck: "Silksong",
      cardback: backId,
      pdfIds: pdfIdsInEdition(edition),
      slots: slots.map((slot) => ({ ...slot, printType: edition.printType })),
    });
    expect(xml).toContain("<printType>partial_foil</printType>");
    expect(xml).toContain(ownPdf);
    expect(xml).toContain("<name>Sol Ring.pdf</name>");
    expect(xml).not.toContain(deluxeA);
    expect(xml).not.toContain(deluxeB);
    expect(xml).not.toContain(deluxeC);
  });

  it("says so when the only PDFs sit inside Deluxe", () => {
    const edition = groupPartialFoilEdition(
      folder("partialOnly1", "3_Silksong Partial Foil Edition", [
        folder("deluxeInside1", "Deluxe Edition", [
          folder("deluxePdf001", "PDF", [folder("deluxeFull01", "Full Deck", [file(deluxeA, "A.pdf"), file(deluxeB, "B.pdf"), file(deluxeC, "C.pdf")])]),
        ]),
      ]),
    );
    expect(edition.cards).toEqual([]);
    expect(edition.notes.some((note) => /No PDF print files/i.test(note.reason))).toBe(true);
  });

  it("uses an inner Partial-Foil folder when the pasted title says standard", () => {
    const edition = catalogueFromTree(
      folder("pasted000001", "My Standard Order", [
        folder("innerPartial", "Partial-Foil", [
          folder("pdfMap000001", "PDF Map", [folder("ownFull00001", "Full Deck", [file(ownPdf, "Sol Ring.pdf")])]),
        ]),
      ]),
    ).editions[0]!;
    expect(edition.printType).toBe("partial_foil");
    expect(artIdsOf(edition).has(ownPdf)).toBe(true);
  });
});

describe("partial foil name matching", () => {
  const mapPdf = "mappdf00000000000000000000001";
  const deluxeOne = "deluxepdf00000000000000000011";
  const deluxeTwo = "deluxepdf00000000000000000012";
  const dpiOne = "dpipdf00000000000000000000001";
  const dpiTwo = "dpipdf00000000000000000000002";
  const otherPdf = "otherpdf0000000000000000000001";
  const deluxeJpg = "deluxejpg00000000000000000001";
  const backId = "cardback000000000000000000009";
  const flipFront = "flipfront00000000000000000001";
  const flipBack = "flipback000000000000000000001";
  const tokenFront = "tokenfront0000000000000000001";
  const tokenBack = "tokenback00000000000000000001";

  function namePack() {
    return folder("partialRoot9", "3_Silksong Partial Foil Edition", [
      folder("foilMap00001", "PDF Partial-Foil Map", [
        folder("mapFull00001", "Full Deck", [
          file(mapPdf, "Sol Ring.pdf"),
          file(backId, "card back.png"),
          folder("front0000009", "Front", [file(flipFront, "Flip 1.pdf"), file(tokenFront, "Token 1.pdf")]),
          folder("back00000009", "Back", [file(flipBack, "Flip 1.pdf"), file(tokenBack, "Token 1.png")]),
        ]),
      ]),
      folder("deLuxe000001", "DeLuxe Edition", [
        folder("deLuxePdf001", "PDF", [file(deluxeOne, "A.pdf"), file(deluxeTwo, "B.pdf")]),
        folder("deLuxeFull01", "Full Deck", [file(deluxeJpg, "Sol Ring.jpg")]),
      ]),
      folder("dpiFolder0001", "1200 DPI", [folder("dpiPdf000001", "PDF", [file(dpiOne, "C.pdf"), file(dpiTwo, "D.pdf")])]),
    ]);
  }

  it("uses PDF Partial-Foil Map and not DeLuxe or 1200 DPI", () => {
    const edition = groupPartialFoilEdition(namePack());
    expect(artIdsOf(edition).has(mapPdf)).toBe(true);
    expect(artIdsOf(edition).has(flipFront)).toBe(true);
    expect(artIdsOf(edition).has(flipBack)).toBe(true);
    for (const id of [deluxeOne, deluxeTwo, dpiOne, dpiTwo, deluxeJpg]) expect(artIdsOf(edition).has(id)).toBe(false);
  });

  it("unlocks the nested DeLuxe deck beside partial foil, each exporting only its own files", () => {
    const editions = catalogueFromTree(namePack()).editions;
    const partial = editions.find((edition) => edition.printType === "partial_foil")!;
    const deluxe = editions.find((edition) => edition.id === "deluxe-edition")!;
    expect(deluxe.printType).toBe("standard");
    expect(artIdsOf(deluxe).has(deluxeJpg)).toBe(true);
    expect(artIdsOf(deluxe).has(mapPdf)).toBe(false);
    expect(artIdsOf(partial).has(deluxeJpg)).toBe(false);
    const partialXml = splitExportByPrintType({
      deck: "Silksong",
      cardback: backId,
      pdfIds: pdfIdsInEdition(partial),
      slots: selectionToSlots(partial, designedSelection(partial)).map((slot) => ({ ...slot, printType: "partial_foil" as const })),
    })[0]!;
    const deluxeXml = splitExportByPrintType({
      deck: "Silksong",
      cardback: "backimage1234",
      pdfIds: new Set<string>(),
      slots: selectionToSlots(deluxe, designedSelection(deluxe)).map((slot) => ({ ...slot, printType: "standard" as const })),
    })[0]!;
    expect(partialXml).toContain("<printType>partial_foil</printType>");
    expect(partialXml).toContain(mapPdf);
    expect(partialXml).not.toContain(deluxeJpg);
    expect(partialXml).not.toContain(deluxeOne);
    expect(deluxeXml).toContain("<printType>standard</printType>");
    expect(deluxeXml).toContain(deluxeJpg);
    expect(deluxeXml).not.toContain(mapPdf);
    expect(deluxeXml).not.toContain("<printType>partial_foil</printType>");
  });

  it("does not use 1200 DPI when another unnamed PDF folder is present", () => {
    const edition = groupPartialFoilEdition(
      folder("partialRoot8", "Partial-Foil", [
        folder("dpiFolder0001", "1200 DPI", [folder("dpiPdf000001", "PDF", [file(dpiOne, "C.pdf"), file(dpiTwo, "D.pdf")])]),
        folder("otherFolder01", "Other", [folder("otherPdf0001", "PDF", [file(otherPdf, "E.pdf")])]),
      ]),
    );
    expect(edition.cards).toEqual([]);
    expect(edition.notes.some((item) => /largest folder was not chosen/i.test(item.reason))).toBe(true);
  });

  it("prints a PDF flip back as its own front only when that option is on", () => {
    const edition = groupPartialFoilEdition(namePack());
    const selected = edition.cards.map((card) => ({
      cardId: card.id,
      locked: false,
      pairs: [{ art: card.faces[0]?.defaultArt?.id ?? "", qty: 2 }],
    }));
    const asBacks = selectionToSlots(edition, selected, { printFlipBacksAsFronts: false });
    const asFronts = selectionToSlots(edition, selected, { printFlipBacksAsFronts: true });
    const backsXml = splitExportByPrintType({
      deck: "Silksong",
      cardback: backId,
      pdfIds: pdfIdsInEdition(edition),
      slots: asBacks.map((slot) => ({ ...slot, printType: "partial_foil" as const })),
    })[0]!;
    const frontsXml = splitExportByPrintType({
      deck: "Silksong",
      cardback: backId,
      pdfIds: pdfIdsInEdition(edition),
      slots: asFronts.map((slot) => ({ ...slot, printType: "partial_foil" as const })),
    })[0]!;
    expect(backsXml).toContain("<backs>");
    expect(backsXml).toContain(flipBack);
    expect(frontsOf(backsXml)).not.toContain(flipBack);
    expect(frontsOf(frontsXml)).toContain(flipBack);
    expect(frontsXml.split(flipBack).length - 1).toBeGreaterThan(0);
    const frontBlock = frontsOf(frontsXml);
    const backBlock = frontsXml.includes("<backs>") ? frontsXml.slice(frontsXml.indexOf("<backs>")) : "";
    expect(frontBlock).not.toContain(tokenBack);
    expect(backBlock).toContain(tokenBack);
    expect(frontsXml).not.toContain(deluxeOne);
    expect(frontsXml).not.toContain(dpiOne);
  });

  it("does not keep an empty Standard edition next to DeLuxe", () => {
    const editions = catalogueFromTree(
      folder("silksongpack", "3_Silksong", [
        folder("emptyStd001", "Standard Edition", []),
        folder("deLuxe000001", "DeLuxe Edition", [folder("deLuxeFull01", "Full Deck", [file(deluxeJpg, "Sol Ring.jpg")])]),
      ]),
    ).editions;
    expect(editions.map((edition) => edition.id)).toEqual(["deluxe-edition"]);
  });

  it("uses a sole PDF folder only when it sits directly under the edition, and names it", () => {
    const directId = "directpdf00000000000000000001";
    const direct = groupPartialFoilEdition(
      folder("partialDirect", "Partial Foil", [
        folder("onlyPdf00001", "Prints", [file(directId, "Sol Ring.pdf")]),
      ]),
    );
    expect(artIdsOf(direct).has(directId)).toBe(false);

    const named = groupPartialFoilEdition(
      folder("partialNamed01", "Partial Foil", [folder("pdfFolder0001", "PDF", [file(directId, "Sol Ring.pdf")])]),
    );
    expect(artIdsOf(named).has(directId)).toBe(true);
    expect(named.notes.some((note) => note.level === "info" && note.reason.includes("PDF") && note.name === "PDF")).toBe(true);

    const nestedId = "nestedpdf00000000000000000001";
    const nested = groupPartialFoilEdition(
      folder("partialNested", "Partial Foil", [
        folder("dpiFolder0001", "1200 DPI", [folder("dpiPdf000001", "PDF", [file(nestedId, "Sol Ring.pdf")])]),
      ]),
    );
    expect(nested.cards).toEqual([]);
    expect(nested.notes.some((note) => /not directly under this edition/i.test(note.reason) && note.reason.includes("PDF"))).toBe(true);
  });

  it("does not print the same partial-foil file twice when PDF folders are nested", () => {
    const shared = "sharedpdf00000000000000000001";
    const edition = groupPartialFoilEdition(
      folder("partialNested2", "Partial Foil", [
        folder("outerPdf00001", "PDF Partial-Foil Map", [
          folder("outerFull0001", "Full Deck", [file(shared, "Sol Ring.pdf")]),
          folder("innerPdf00001", "Inner PDF Partial-Foil", [folder("innerFull0001", "Full Deck", [file(shared, "Sol Ring.pdf")])]),
        ]),
      ]),
    );
    const uses = edition.cards.flatMap((card) => card.faces.flatMap((face) => [face.defaultArt, ...face.alternates].filter((art) => art?.id === shared)));
    expect(uses).toHaveLength(1);
  });

  it("skips folders named template or font", () => {
    const hidden = "fontpdf0000000000000000000001";
    const kept = "keptpdf0000000000000000000001";
    const edition = groupPartialFoilEdition(
      folder("partialUtil001", "Partial Foil", [
        folder("fontFolder001", "Font", [folder("fontPdf00001", "PDF", [file(hidden, "Hidden.pdf")])]),
        folder("template00001", "Template", [file("templatepdf1", "Template.pdf")]),
        folder("keptPdf000001", "PDF", [file(kept, "Sol Ring.pdf")]),
      ]),
    );
    expect(artIdsOf(edition).has(kept)).toBe(true);
    expect(artIdsOf(edition).has(hidden)).toBe(false);
    expect(artIdsOf(edition).has("templatepdf1")).toBe(false);
  });

  it("gives two Deluxe folders distinct ids that do not depend on paste order", () => {
    const higher = folder("zzzdeluxe0001", "Deluxe Edition", [folder("fullOne000001", "Full Deck", [file("deluxefile0001", "Sol Ring.jpg")])]);
    const lower = folder("aaadeluxe0001", "Deluxe Edition", [folder("fullTwo000001", "Full Deck", [file("deluxefile0002", "Island.jpg")])]);
    const pack = (children: RawNode[]) => catalogueFromTree(folder("packorder0001", "Silksong", children)).editions;
    const forward = pack([higher, lower]);
    const reverse = pack([lower, higher]);
    const idOf = (editions: ReturnType<typeof pack>, fileId: string) => editions.find((edition) => artIdsOf(edition).has(fileId))!.id;
    expect(idOf(forward, "deluxefile0002")).toBe("deluxe-edition");
    expect(idOf(forward, "deluxefile0001")).toBe("deluxe-edition-2");
    expect(idOf(reverse, "deluxefile0002")).toBe(idOf(forward, "deluxefile0002"));
    expect(idOf(reverse, "deluxefile0001")).toBe(idOf(forward, "deluxefile0001"));
    expect(new Set(forward.map((edition) => edition.id)).size).toBe(2);
    expect(new Set(forward.map((edition) => edition.name)).size).toBe(2);
    expect(forward.every((edition) => /\(\d+\)$/.test(edition.name))).toBe(true);
  });

  it("does not give Deluxe Edition 2 and a second Deluxe Edition the same id", () => {
    const lower = folder("aaadeluxe0001", "Deluxe Edition", [folder("fullLow000001", "Full Deck", [file("lowfile0000001", "Island.jpg")])]);
    const higher = folder("mmmdeluxe0001", "Deluxe Edition", [folder("fullHigh00001", "Full Deck", [file("highfile000001", "Swamp.jpg")])]);
    const numbered = folder("zzzdeluxe20001", "Deluxe Edition 2", [folder("fullNum000001", "Full Deck", [file("numfile0000001", "Plains.jpg")])]);
    const pack = (children: RawNode[]) => catalogueFromTree(folder("packorder0003", "Silksong", children)).editions;
    const forward = pack([numbered, higher, lower]);
    const reverse = pack([lower, numbered, higher]);
    const idOf = (editions: ReturnType<typeof pack>, fileId: string) => editions.find((edition) => artIdsOf(edition).has(fileId))!;
    expect(idOf(forward, "numfile0000001").id).toBe("deluxe-edition-2");
    expect(idOf(forward, "lowfile0000001").id).toBe("deluxe-edition");
    expect(idOf(forward, "highfile000001").id).toBe("deluxe-edition-3");
    expect(new Set(forward.map((edition) => edition.id)).size).toBe(3);
    expect(idOf(reverse, "numfile0000001").id).toBe(idOf(forward, "numfile0000001").id);
    expect(idOf(reverse, "highfile000001").id).toBe(idOf(forward, "highfile000001").id);
    expect(idOf(forward, "lowfile0000001").name).toContain("Deluxe Edition");
  });

  it("promotes a double-faced main card's PDF back when flip backs are printed as fronts", () => {
    const front = "dfcfront000000000000000000001";
    const back = "dfcback0000000000000000000001";
    const edition = groupPartialFoilEdition(
      folder("partialDfc0001", "Partial Foil", [
        folder("dfcPdf0000001", "PDF Partial-Foil Map", [
          folder("dfcFull000001", "Full Deck", [
            file(front, "1_1_Cecil, Dark Knight (Lost Lace).pdf"),
            file(back, "1_2_Cecil, Redeemed Paladin (Lace).pdf"),
          ]),
        ]),
      ]),
    );
    const card = edition.cards.find((item) => item.faces.length === 2);
    expect(card?.role).toBe("main");
    const selected = [{ cardId: card!.id, locked: false, pairs: [{ art: "", qty: 1 }] }];
    const off = selectionToSlots(edition, selected, { printFlipBacksAsFronts: false });
    const on = selectionToSlots(edition, selected, { printFlipBacksAsFronts: true });
    expect(off).toHaveLength(1);
    expect(off[0]!.back?.id).toBe(back);
    expect(on.map((slot) => slot.front.id)).toEqual([front, back]);
    expect(on.every((slot) => slot.back === null)).toBe(true);
  });
});

describe("partial foil previews", () => {
  it("uses the Deluxe art from the same unlock and never the foil mask", () => {
    const mask = "masksol000000000000000000001";
    const pdf = "pdfsol0000000000000000000001";
    const deluxe = "deluxesol0000000000000000001";
    const islandPdf = "pdfisland0000000000000000001";
    const islandMask = "maskisland000000000000000001";
    const tree = folder("pfpack0000001", "3_P5", [
      folder("deluxefold001", "2_P5 Deluxe Edition", [folder("deluxefull001", "Full Deck", [file(deluxe, "Sol Ring.png")])]),
      folder("partialfold01", "3_P5 Partial Foil Edition", [
        folder("maskfolder001", "Partial Foil Map", [file(mask, "Sol Ring.png"), file(islandMask, "Island.jpg")]),
        folder("pdffolder0001", "PDF Partial Foil Map", [
          folder("pdfdeck000001", "Full Deck", [file(pdf, "Sol Ring.pdf"), file(islandPdf, "Island.pdf")]),
        ]),
      ]),
    ]);
    const partial = catalogueFromTree(tree).editions.find((edition) => edition.printType === "partial_foil")!;
    const sol = partial.cards.find((card) => card.name === "Sol Ring")!.faces[0]!.defaultArt!;
    const island = partial.cards.find((card) => card.name === "Island")!.faces[0]!.defaultArt!;
    expect(sol.id).toBe(pdf);
    expect(sol.thumbId).toBe(deluxe);
    expect(sol.thumbId).not.toBe(mask);
    expect(island.id).toBe(islandPdf);
    expect(island.thumbId).toBe(islandPdf);
    expect(island.thumbId).not.toBe(islandMask);
    expect(artIdsOf(partial).has(mask)).toBe(false);
    expect(artIdsOf(partial).has(deluxe)).toBe(false);
  });

  it("falls back to a built-in Standard art when this unlock has no Deluxe match", () => {
    const mask = "maskplains000000000000000001";
    const pdf = "pdfplains0000000000000000001";
    const standard = catalogueFromTree(
      folder("stdpack000001", "1_P5 Standard Edition", [folder("stdfull000001", "Full Deck", [file("stdplains000000000000000001", "Plains.png")])]),
    );
    const partial = catalogueFromTree(
      folder("onlypartial01", "3_P5 Partial Foil Edition", [
        folder("maskfolder002", "Partial Foil Map", [file(mask, "Plains.jpg")]),
        folder("pdffolder0002", "PDF Partial Foil Map", [folder("pdfdeck000002", "Full Deck", [file(pdf, "Plains.pdf")])]),
      ]),
      undefined,
      [standard],
    );
    const art = partial.editions[0]!.cards[0]!.faces[0]!.defaultArt!;
    expect(art.id).toBe(pdf);
    expect(art.thumbId).toBe("stdplains000000000000000001");
    expect(art.thumbId).not.toBe(mask);
  });
});

describe("deluxe previews", () => {
  it("uses the deluxe image itself and a shipped standard image only for a pdf", () => {
    const standard = catalogueFromTree(
      folder("stdpack000002", "1_P5 Standard Edition", [
        folder("stdfull000002", "Full Deck", [file("stdsolimg000000000000000001", "Sol Ring.jpg"), file("stdislandimg000000000000001", "Island.jpg")]),
      ]),
    );
    const deluxe = catalogueFromTree(
      folder("deluxepack002", "2_P5 Deluxe Edition", [
        folder("deluxefull002", "Full Deck", [file("dxsolpng0000000000000000001", "Sol Ring.png"), file("dxislandpdf0000000000000001", "Island.pdf")]),
      ]),
      undefined,
      [standard],
    );
    const edition = deluxe.editions[0]!;
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!.faces[0]!.defaultArt!;
    const island = edition.cards.find((card) => card.name === "Island")!.faces[0]!.defaultArt!;
    expect(sol.id).toBe("dxsolpng0000000000000000001");
    expect(sol.thumbId).toBe("dxsolpng0000000000000000001");
    expect(island.id).toBe("dxislandpdf0000000000000001");
    expect(island.thumbId).toBe("stdislandimg000000000000001");
    expect(artIdsOf(edition).has("stdislandimg000000000000001")).toBe(false);
  });

  it("does not use a deluxe PDF as the preview when a standard image exists", () => {
    const standard = catalogueFromTree(
      folder("stdpackpdf001", "1_SxF Standard Edition", [folder("stdfullpdf01", "Full Deck", [file("stdsoljpg000000000000000001", "Sol Ring.jpg")])]),
    );
    const partial = catalogueFromTree(
      folder("pfpackpdf0001", "3_SxF", [
        folder("dxpdfonly0001", "2_SxF Deluxe Edition", [folder("dxpdffull0001", "Full Deck", [file("dxsolpdf0000000000000000001", "Sol Ring.pdf")])]),
        folder("pfpdfonly0001", "3_SxF Partial Foil Edition", [
          folder("pfmap00000001", "PDF Partial Foil Map", [folder("pfdeck0000001", "Full Deck", [file("pfsolpdf0000000000000000001", "Sol Ring.pdf")])]),
        ]),
      ]),
      undefined,
      [standard],
    );
    const art = partial.editions.find((edition) => edition.printType === "partial_foil")!.cards[0]!.faces[0]!.defaultArt!;
    expect(art.id).toBe("pfsolpdf0000000000000000001");
    expect(art.thumbId).toBe("stdsoljpg000000000000000001");
    expect(art.thumbId).not.toBe("dxsolpdf0000000000000000001");
  });
});

describe("free standard layouts that are not named Standard", () => {
  it("uses a non-paid child that holds Full Deck as the standard edition", async () => {
    const requested: string[] = [];
    const list: Lister = async (id) => {
      requested.push(id);
      const pages: Record<string, ListedFolder> = {
        rootFolder01: {
          title: "Decks",
          entries: [{ id: "deckTmnt0001", name: "1_TMNT", folder: true }],
        },
        deckTmnt0001: {
          title: "1_TMNT",
          entries: [
            { id: "tmntInner001", name: "TMNT", folder: true },
            { id: "tmntDeluxe01", name: "2_TMNT Deluxe Edition", folder: true },
          ],
        },
        tmntInner001: {
          title: "TMNT",
          entries: [
            { id: "tmntFull0001", name: "Full Deck (800 DPI)", folder: true },
            { id: "tmntExtras01", name: "Extras", folder: true },
          ],
        },
        tmntFull0001: { title: "Full Deck (800 DPI)", entries: [{ id: "tmntsol00001", name: "Sol Ring.png", folder: false }] },
        tmntExtras01: { title: "Extras", entries: [] },
      };
      const found = pages[id];
      if (!found) throw new Error(`refusing to list ${id}`);
      return found;
    };
    const built = await buildShippedStandardTree({ rootId: "rootFolder01", deckQuery: "tmnt", list });
    expect(requested).not.toContain("tmntDeluxe01");
    expect(requested).toContain("tmntInner001");
    expect(built.deckName).toBe("TMNT");
    const edition = catalogueFromTree(built.tree, built.deckName).editions[0]!;
    expect(edition.id).toBe("standard");
    expect(edition.cards.map((card) => card.name)).toEqual(["Sol Ring"]);
    expect(edition.cards[0]!.faces[0]!.defaultArt?.id).toBe("tmntsol00001");
  });

  it("treats Complete Collection as the deck and keeps a real Full Deck when both exist", () => {
    const collected = catalogueFromTree(
      folder("floatroot001", "1_Floating World Standard Edition", [
        folder("complete0001", "Complete Collection", [
          file("archway00001", "Arid Archway.jpg"),
          folder("basics000001", "Basic Lands", [folder("islands00001", "Islands", [file("islandfile01", "Island 1.jpg")])]),
          folder("backs0000001", "Card Back", [file("floatback001", "Card Back 1.jpg")]),
          folder("extras000001", "Extras", [file("archway00002", "Arid Archway 2.jpg")]),
          folder("optional0001", "Optional", [file("dandan000001", "Dandan 1.jpg")]),
        ]),
      ]),
    ).editions[0]!;
    expect(collected.cards.map((card) => card.name).sort()).toEqual(["Arid Archway", "Arid Archway 2", "Island 1"]);
    expect(collected.backs.map((back) => back.name)).toEqual(["Card Back 1"]);
    expect(collected.cards.find((card) => card.name === "Arid Archway 2")!.role).toBe("extra");
    expect(collected.cards.some((card) => card.name.startsWith("Dandan"))).toBe(false);
    expect(collected.notes.some((note) => note.name === "Optional")).toBe(true);

    const both = catalogueFromTree(
      folder("bothroot0001", "1_Example Standard Edition", [
        folder("realfull0001", "Full Deck", [file("realsol00001", "Sol Ring.jpg")]),
        folder("complete0002", "Complete Collection", [file("othersol0001", "Island.jpg")]),
      ]),
    ).editions[0]!;
    expect(both.cards.map((card) => card.name)).toEqual(["Sol Ring"]);
  });

  it("joins a deck split across Full Deck and Important Options without duplicating print variants", () => {
    const edition = catalogueFromTree(
      folder("sxfroot00001", "1_Spy x Family Standard Edition", [
        folder("sxffull00001", "Full Deck", [
          file("sxfloose0001", "Sol Ring (Proposal Ring).jpg"),
          folder("sxfoptions01", "IMPORTANT OPTIONS", [
            folder("sxfcolor0001", "Color", [
              file("sxfcolorarc1", "Academy Ruins (Eden Academy).jpg"),
              file("sxfcoloronly", "Only Color.jpg"),
              folder("sxfcolorland", "Basic Lands", [file("sxfcolorisl1", "Island 1.jpg")]),
            ]),
            folder("sxfbw0000001", "Black and White", [
              file("sxfbwarch001", "Academy Ruins (Eden Academy).jpg"),
              file("sxfbwonly001", "Only Mono.jpg"),
              folder("sxfbwlands01", "Basic Lands", [file("sxfbwisland1", "Island 1.jpg")]),
            ]),
          ]),
          folder("sxftokens001", "Tokens", [
            folder("sxftokbw0001", "Black and White", [file("sxftokbwfile", "Token - Treasure 1.jpg"), file("sxftokbwgold", "Token - Gold 1.jpg")]),
            folder("sxftokcolor1", "Color", [file("sxftokcofile", "Token - Treasure 1.jpg"), file("sxftokcogold", "Token - Gold 1.jpg")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const names = edition.cards.map((card) => card.name).sort();
    expect(names).toEqual(["Academy Ruins (Eden Academy)", "Island 1", "Only Color", "Only Mono", "Sol Ring (Proposal Ring)", "Token - Gold 1", "Token - Treasure 1"]);
    const ruins = edition.cards.find((card) => card.name.startsWith("Academy Ruins"))!;
    expect(ruins.role).toBe("main");
    expect(ruins.faces[0]!.defaultArt?.id).toBe("sxfcolorarc1");
    expect(ruins.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxfbwarch001"]);
    const island = edition.cards.find((card) => card.name === "Island 1")!;
    expect(island.faces[0]!.defaultArt?.id).toBe("sxfcolorisl1");
    expect(island.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxfbwisland1"]);
    const token = edition.cards.find((card) => card.name === "Token - Treasure 1")!;
    expect(token.role).toBe("token");
    expect(token.faces[0]!.defaultArt?.id).toBe("sxftokcofile");
    expect(token.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxftokbwfile"]);
    expect(edition.cards.filter((card) => card.name.startsWith("Academy Ruins"))).toHaveLength(1);
  });

  it("ships a flat folder of card images and refuses a folder that is not card images", async () => {
    const requested: string[] = [];
    const list: Lister = async (id) => {
      requested.push(id);
      const pages: Record<string, ListedFolder> = {
        rootFolder01: { title: "Decks", entries: [{ id: "deckHorror01", name: "3.1_Horror Movie Poster Secret Lair", folder: true }] },
        deckHorror01: { title: "3.1_Horror Movie Poster Secret Lair", entries: [{ id: "horrorInner1", name: "Horror Movie Poster Secret Lair", folder: true }] },
        horrorInner1: {
          title: "Horror Movie Poster Secret Lair",
          entries: [
            { id: "horrorfront1", name: "1_1_Thing in the Ice.png", folder: false },
            { id: "horrorback001", name: "1_2_Awoken Horror.png", folder: false },
            { id: "horrorsingle1", name: "Birthing Pod.png", folder: false },
          ],
        },
      };
      const found = pages[id];
      if (!found) throw new Error(`refusing to list ${id}`);
      return found;
    };
    const built = await buildShippedStandardTree({ rootId: "rootFolder01", deckQuery: "horror", list });
    expect(requested).toContain("horrorInner1");
    const edition = catalogueFromTree(built.tree, built.deckName).editions[0]!;
    expect(edition.cards.map((card) => card.name).sort()).toEqual(["Birthing Pod", "Thing in the Ice // Awoken Horror"]);
    const flip = edition.cards.find((card) => card.name.startsWith("Thing in the Ice"))!;
    expect(flip.role).toBe("main");
    expect(flip.faces.map((face) => face.name)).toEqual(["Thing in the Ice", "Awoken Horror"]);
    expect(edition.notes.some((note) => note.reason.includes("Every file is a card image"))).toBe(true);
    expect(edition.notes.some((note) => note.reason.includes("loose card images"))).toBe(false);

    expect(() => catalogueFromTree(folder("notcards0001", "Notes", [file("readme000001", "README.txt"), file("layoutpsd001", "Template.psd")]))).toThrow(/No printable cards/);
    expect(() =>
      catalogueFromTree(folder("mixed0000001", "Horror", [file("onecard00001", "Birthing Pod.png"), file("notes0000001", "notes.txt")])),
    ).toThrow(/No printable cards/);
  });
});

describe("v0.1.14 layout fixes", () => {
  it("uses the largest nested deluxe folder that holds card images", () => {
    const edition = catalogueFromTree(
      folder("pack", "3_Nier", [
        folder("wrap", "2_Nier Deluxe Edition", [
          folder("smalldpi", "Deluxe Edition (600 DPI)", [file("onlyplain", "Plains.jpg")]),
          folder("largedpi", "Deluxe Edition (1200 DPI)", [file("largesol", "Sol Ring.jpg"), file("largeisl", "Island.jpg"), file("largemtn", "Mountain.jpg")]),
        ]),
      ]),
    ).editions[0]!;
    expect(edition.cards.map((card) => card.faces[0]?.defaultArt?.id).sort()).toEqual(["largeisl", "largemtn", "largesol"]);
  });

  it("keeps a v0.1.11 Vader deluxe save as one card per swamp", () => {
    const swamps = Array.from({ length: 16 }, (_, index) => file(`vader-swamp-${index + 1}`, `Swamp ${index + 1}.jpg`));
    const edition = catalogueFromTree(folder("vaderdx", "2_Vader Deluxe Edition", [folder("vaderdpi", "Deluxe Edition (1200 DPI)", swamps)])).editions[0]!;
    expect(edition.cards.filter((card) => card.role === "main")).toHaveLength(16);
    const saved = edition.cards.map((card) => ({
      cardId: card.id,
      locked: false,
      pairs: [{ art: card.faces[0]!.defaultArt!.id, qty: 1 }],
    }));
    expect(selectionToSlots(edition, saved)).toHaveLength(16);
  });

  it("does not collapse loose deluxe basics into one card", () => {
    const edition = catalogueFromTree(
      folder("pack", "3_Nier", [
        folder("wrap", "2_Nier Deluxe Edition", [
          folder("dpi", "Deluxe Edition (1200 DPI)", [
            file("dxisland1", "Island 1.jpg"),
            file("dxisland2", "Island 2.jpg"),
            file("dxsol", "Sol Ring.jpg"),
            folder("notes", "Notes", [file("note", "readme.txt")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    expect(edition.cards.filter((card) => card.role === "main").map((card) => card.name).sort()).toEqual(["Island 1", "Island 2", "Sol Ring"]);
    expect(edition.cards.every((card) => card.role !== "main" || card.defaultQty === 1)).toBe(true);
  });

  it("uses loose card images when a deluxe edition has no Full Deck", () => {
    const edition = catalogueFromTree(
      folder("nierdeluxe01", "Deluxe Edition (1200 DPI)", [
        file("looseisland1", "Island.jpg"),
        file("loosesol0001", "Sol Ring.png"),
        folder("notesfolder1", "Notes", [file("notacard00001", "readme.txt")]),
      ]),
    ).editions[0]!;
    expect(edition.cards.map((card) => card.name).sort()).toEqual(["Island", "Sol Ring"]);
    expect(edition.notes.some((note) => /loose card images/i.test(note.reason))).toBe(true);
  });

  it("uses the Color print as the deluxe card when Black and White is listed first", () => {
    const edition = catalogueFromTree(
      folder("dxcolor", "2_Vader Deluxe Edition", [
        folder("dxfull", "Full Deck", [
          folder("dxbw", "Black and White", [file("dxbwsol", "Sol Ring.jpg")]),
          folder("dxcolorfolder", "Color", [file("dxcolorsol", "Sol Ring.jpg")]),
        ]),
      ]),
    ).editions[0]!;
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!;
    expect(sol.faces[0]!.defaultArt?.id).toBe("dxcolorsol");
    expect(sol.faces[0]!.alternates.map((art) => art.id)).toEqual(["dxbwsol"]);
    const colour = catalogueFromTree(
      folder("dxcolour", "2_Vader Deluxe Edition", [
        folder("dxfull2", "Full Deck", [
          folder("dxbw2", "Black and White", [file("dxbw2sol", "Sol Ring.jpg")]),
          folder("dxcolourfolder", "Colour", [file("dxcoloursol", "Sol Ring.jpg")]),
        ]),
      ]),
    ).editions[0]!;
    const colourSol = colour.cards.find((card) => card.name === "Sol Ring")!;
    expect(colourSol.faces[0]!.defaultArt?.id).toBe("dxcoloursol");
    expect(colourSol.faces[0]!.alternates.map((art) => art.id)).toEqual(["dxbw2sol"]);
  });

  it("keeps every numbered basic in the main deck at its normal count", () => {
    const islands = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => file(`${prefix}-${index + 1}`, `Island ${index + 1}.jpg`));
    const small = catalogueFromTree(
      folder("smallbasic1", "1_Vader Standard Edition", [folder("smallfull1", "Full Deck", islands("vader", 16))]),
    ).editions[0]!;
    expect(small.cards.filter((card) => card.role === "main")).toHaveLength(16);
    expect(small.cards.every((card) => card.defaultQty === 1)).toBe(true);
    const fillers = Array.from({ length: 100 }, (_, index) => file(`fill-${index}`, `Spell ${index}.jpg`));
    const big = catalogueFromTree(
      folder("bigbasic001", "1_SxF Standard Edition", [
        folder("bigfull0001", "Full Deck", [
          ...fillers,
          ...islands("sxf", 3),
          file("basicisland", "Basic Island 4.jpg"),
          file("bareisland", "Island.jpg"),
          folder("bigtokens", "Tokens", [file("tokenforest0", "Forest 0.jpg")]),
        ]),
        folder("bigextras", "Extras", [file("waste1", "Wastes 1.jpg"), file("waste2", "Wastes 2.jpg")]),
      ]),
    ).editions[0]!;
    const mains = big.cards.filter((card) => card.role === "main");
    expect(mains.length).toBeGreaterThan(100);
    const qty = (name: string) => mains.find((card) => card.name === name)?.defaultQty;
    expect(qty("Island 1")).toBe(1);
    expect(qty("Island 2")).toBe(1);
    expect(qty("Island 3")).toBe(1);
    expect(qty("Basic Island 4")).toBe(1);
    expect(qty("Spell 0")).toBe(1);
    expect(qty("Island")).toBe(1);
    expect(mains.reduce((sum, card) => sum + card.defaultQty, 0)).toBe(mains.length);
    const tokenForest = big.cards.find((card) => card.name === "Forest 0");
    expect(tokenForest?.role).toBe("token");
    expect(tokenForest?.defaultQty).toBe(0);
    const wastes = big.cards.filter((card) => card.name.startsWith("Wastes"));
    expect(wastes.map((card) => card.role)).toEqual(["extra", "extra"]);
    expect(wastes.every((card) => card.defaultQty === 0)).toBe(true);
    const at100 = catalogueFromTree(
      folder("exact100001", "1_Persona 5 Standard Edition", [
        folder("p5full", "Full Deck", [...fillers.slice(0, 98), file("p5i1", "Island 1.jpg"), file("p5i2", "Island 2.jpg")]),
      ]),
    ).editions[0]!;
    expect(at100.cards.filter((card) => card.role === "main")).toHaveLength(100);
    expect(at100.cards.every((card) => card.defaultQty === 1)).toBe(true);
    const paid = catalogueFromTree(
      folder("p5pf", "3_P5 Partial Foil Edition", [
        folder("p5pdf", "PDF Partial Foil Map", [
          folder("p5deck", "Full Deck", [...fillers.map((card, index) => file(`p5pdf-${index}`, card.name.replace(/\.jpg$/, ".pdf"))), file("p5pdf-i1", "Island 1.pdf"), file("p5pdf-i2", "Island 2.pdf")]),
        ]),
      ]),
    ).editions[0]!;
    expect(paid.cards.filter((card) => card.role === "main")).toHaveLength(102);
    expect(paid.cards.every((card) => card.defaultQty === 1)).toBe(true);
    expect(paid.cards.find((card) => card.name === "Island 2")?.defaultQty).toBe(1);
    const masks = Array.from({ length: 99 }, (_, index) => file(`p5mask-${index}`, `Mask ${index}.pdf`));
    const p5 = catalogueFromTree(
      folder("p5pf103", "3_P5 Partial Foil Edition", [
        folder("p5pdf103", "PDF Partial Foil Map", [
          folder("p5deck103", "Full Deck", [
            ...masks,
            file("p5f1", "Forest 1.pdf"),
            file("p5f2", "Forest 2.pdf"),
            file("p5p1", "Plains 1.pdf"),
            file("p5p2", "Plains 2.pdf"),
          ]),
        ]),
      ]),
    ).editions[0]!;
    expect(p5.cards.filter((card) => card.role === "main")).toHaveLength(103);
    expect(p5.cards.find((card) => card.name === "Forest 2")?.defaultQty).toBe(1);
    expect(p5.cards.find((card) => card.name === "Plains 2")?.defaultQty).toBe(1);
    expect(p5.cards.reduce((sum, card) => sum + card.defaultQty, 0)).toBe(103);
    const crowded = catalogueFromTree(
      folder("tokendeck", "1_SxF Standard Edition", [
        folder("tokenfull", "Full Deck", [
          ...fillers,
          file("token-in-main", "Token - Treasure 1.jpg"),
        ]),
      ]),
    ).editions[0]!;
    const treasure = crowded.cards.find((card) => card.name === "Token - Treasure 1")!;
    expect(treasure.role).toBe("main");
    expect(treasure.defaultQty).toBe(1);
    expect(crowded.cards.filter((card) => card.role === "main")).toHaveLength(101);
  });

  it("matches black and white files by exact name and does not name a one-file token folder Color", () => {
    const edition = catalogueFromTree(
      folder("bwroot000001", "1_Example Standard Edition", [
        folder("bwfull000001", "Full Deck", [
          file("loosekaboom1", "Kaboom (Bang).jpg"),
          file("loosesolring", "Sol Ring.jpg"),
          folder("bwoptions001", "IMPORTANT OPTIONS", [
            folder("bwfolder0001", "Black and White", [
              file("bwkaboom0001", "Kaboom.jpg"),
              file("bwfamily0001", "Sol Ring (Family).jpg"),
              file("bwsolring001", "Sol Ring.jpg"),
              file("bwisland1701", "Island 17.jpg"),
            ]),
          ]),
          folder("bwtokens0001", "Tokens", [
            folder("bwtcolor0001", "Color", [file("bwtreasurec1", "Token - Treasure 1.jpg")]),
            folder("bwtcolour001", "Colour", [file("bwtreasurec2", "Token - Treasure 2.jpg")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!;
    expect(sol.faces[0]!.defaultArt?.id).toBe("loosesolring");
    expect(sol.faces[0]!.alternates.map((art) => art.id)).toContain("bwsolring001");
    expect(edition.cards.find((card) => card.name === "Kaboom (Bang)")!.faces[0]!.alternates.map((art) => art.id)).toContain("bwkaboom0001");
    expect(edition.cards.some((card) => card.name === "Kaboom")).toBe(false);
    expect(edition.cards.find((card) => card.name === "Island 17")?.role).toBe("main");
    const treasure = edition.cards.find((card) => card.name === "Token - Treasure 1");
    expect(treasure?.role).toBe("token");
    expect(edition.cards.filter((card) => card.role === "token")).toHaveLength(2);
    expect(edition.cards.some((card) => card.name === "Color" || card.name === "Colour")).toBe(false);
    expect(edition.cards.find((card) => card.name === "Token - Treasure 2")?.role).toBe("token");
  });

  it("uses the larger Full Deck when an edition contains two", () => {
    const edition = catalogueFromTree(
      folder("twofullroot1", "1_Example Standard Edition", [
        folder("smallfull001", "Full Deck", [file("onlyone00001", "Island.jpg")]),
        folder("largefull001", "Full Deck (Print)", [file("largea000001", "Sol Ring.jpg"), file("largeb000001", "Plains.jpg")]),
      ]),
    ).editions[0]!;
    expect(edition.cards.map((card) => card.name).sort()).toEqual(["Plains", "Sol Ring"]);
  });

  it("drops a repeated file id inside one edition", () => {
    const edition = catalogueFromTree(
      folder("duperoot0001", "1_Example Standard Edition", [
        folder("dupefull0001", "Full Deck", [file("samefile0001", "Sol Ring.jpg"), file("samefile0001", "Sol Ring.jpg")]),
      ]),
    ).editions[0]!;
    expect(edition.cards).toHaveLength(1);
    expect(edition.cards[0]!.faces[0]!.alternates).toEqual([]);
  });

  it("uses a pdf id as the preview when no image art matches", () => {
    const edition = catalogueFromTree(
      folder("pdfprev00001", "2_P5 Deluxe Edition", [folder("pdfprevfull1", "Full Deck", [file("pdfonly000001", "Sol Ring.pdf")])]),
    ).editions[0]!;
    const art = edition.cards[0]!.faces[0]!.defaultArt!;
    expect(art.id).toBe("pdfonly000001");
    expect(art.thumbId).toBe("pdfonly000001");
  });
});

describe("v0.1.15 deluxe and partial foil", () => {
  const dpi = (id: string) => folder(id, "Deluxe Edition (1200 DPI)", [file(`${id}-sol`, "Sol Ring.png"), file(`${id}-island`, "Island.jpg")]);
  const deluxeWrap = (id: string, dpiFirst: boolean) => {
    const print = dpi(`${id}-dpi`);
    const standardLink = folder(`${id}-stdlink`, "Standard Edition (600 DPI)", [folder(`${id}-stdfull`, "Full Deck", [file(`${id}-stdfile`, "Other.jpg")])]);
    return folder(id, "2_Nier Deluxe Edition", dpiFirst ? [print, standardLink] : [standardLink, print]);
  };

  it("keeps the loose 1200 DPI deluxe art on a whole-deck paste in either order", () => {
    for (const deluxeFirst of [true, false]) {
      const deluxe = deluxeWrap("deck", deluxeFirst);
      const standard = folder("std", "1_Nier Standard Edition", [folder("stdfull", "Full Deck", [file("stdsol", "Sol Ring.jpg")])]);
      const partial = folder("pf", "3_Nier Partial Foil Edition", [folder("pdf", "PDF Partial Foil Map", [file("pfsol", "Sol Ring.pdf")])]);
      const children = deluxeFirst ? [deluxe, standard, partial] : [partial, standard, deluxe];
      const editions = catalogueFromTree(folder("pack", "3_Nier", children)).editions;
      const found = editions.find((edition) => edition.id.includes("deluxe"));
      expect(found?.cards.map((card) => card.faces[0]?.defaultArt?.id).sort()).toEqual(["deck-dpi-island", "deck-dpi-sol"]);
      expect(found?.cards.some((card) => card.faces[0]?.defaultArt?.id === "deck-stdfile")).toBe(false);
    }
  });

  it("keeps the loose 1200 DPI deluxe art on a partial foil paste in either order", () => {
    for (const deluxeFirst of [true, false]) {
      const deluxe = deluxeWrap("pfdeck", deluxeFirst);
      const pdf = folder("pfpdf", "PDF Partial Foil Map", [file("pfpdfsol", "Sol Ring.pdf")]);
      const editions = catalogueFromTree(folder("pfroot", "3_Nier Partial Foil Edition", deluxeFirst ? [deluxe, pdf] : [pdf, deluxe])).editions;
      const found = editions.find((edition) => edition.id.includes("deluxe"));
      expect(found?.cards.map((card) => card.faces[0]?.defaultArt?.id).sort()).toEqual(["pfdeck-dpi-island", "pfdeck-dpi-sol"]);
      expect(editions.some((edition) => edition.printType === "partial_foil")).toBe(true);
    }
  });

  it("groups an SxF partial foil map from the Color folder and keeps Front and Back", () => {
    const edition = catalogueFromTree(
      folder("sxfpf", "3_SxF Partial Foil Edition", [
        folder("sxfpdf", "PDF Partial Foil Map", [
          folder("sxfcolor", "Color Partial Foil Map", [
            file("sxfcolorsol", "Sol Ring.pdf"),
            file("sxfisland1", "Basic Island 1.pdf"),
            file("sxfisland2", "Basic Island 2.pdf"),
            file("sxf-elephant", "Token - Elephant.pdf"),
            file("sxf-foretell", "Token Foretell 2.pdf"),
            file("sxf-gold1", "Token - Gold 1.pdf"),
            file("sxf-gold2", "Token - Gold 2.pdf"),
            file("sxf-rad", "Token - Radiation.pdf"),
            file("sxf-tre1", "Token - Treasure 1.pdf"),
            file("sxf-tre2", "Token - Treasure 2.pdf"),
            folder("sxffront", "Front", [file("sxfflipf", "1_1_Thing in the Ice.pdf")]),
            folder("sxfback", "Back", [file("sxfflipb", "1_2_Awoken Horror.pdf")]),
          ]),
          folder("sxfbw", "Black and White Partial Foil Map", [
            file("sxfbwsol", "Sol Ring.pdf"),
            file("sxfbwfamily", "Sol Ring (Family).pdf"),
            file("sxfbwtoken", "Token - Treasure 3.pdf"),
            folder("sxfbwbasics", "Basic Lands", [file("sxfbw-island1", "Basic Island 1.pdf"), file("sxfbw17", "Basic Island 17.pdf")]),
            folder("sxfbwfront", "Front", [
              file("sxfbwflipf", "1_1_Thing in the Ice.pdf"),
              file("sxfbwbackf", "Back Flip 1.pdf"),
              file("sxfbwjacef", "2_1_Jace, Vryn's Prodigy.pdf"),
            ]),
            folder("sxfbwback", "Back", [file("sxfbwflipb", "1_2_Awoken Horror.pdf"), file("sxfbwjaceb", "2_2_Jace, Telepath Unbound.pdf")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    expect(edition.printType).toBe("partial_foil");
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!;
    expect(sol.role).toBe("main");
    expect(sol.faces[0]!.defaultArt?.id).toBe("sxfcolorsol");
    expect(sol.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxfbwsol"]);
    expect(edition.cards.filter((card) => card.role === "main").map((card) => card.name).sort()).toEqual(
      ["Basic Island 1", "Basic Island 2", "Sol Ring", "Thing in the Ice // Awoken Horror"].sort(),
    );
    const island1 = edition.cards.find((card) => card.name === "Basic Island 1")!;
    expect(island1.faces[0]!.defaultArt?.id).toBe("sxfisland1");
    expect(island1.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxfbw-island1"]);
    const island17 = edition.cards.find((card) => card.name === "Basic Island 17")!;
    expect(island17.role).toBe("extra");
    expect(island17.defaultQty).toBe(0);
    expect(edition.notes.some((note) => note.name === "Basic Island 17" && note.path === "Black and White")).toBe(true);
    expect(sol.faces[0]!.alternates.map((art) => art.id)).not.toContain("sxfbwfamily");
    expect(edition.cards.filter((card) => card.role === "main").some((card) => card.faces[0]?.defaultArt?.id === "sxfbwfamily")).toBe(false);
    const flip = edition.cards.find((card) => card.name.includes("Thing in the Ice"))!;
    expect(flip.role).toBe("main");
    expect(flip.faces.map((face) => face.defaultArt?.id)).toEqual(["sxfflipf", "sxfflipb"]);
    expect(flip.faces[0]!.alternates.map((art) => art.id)).toContain("sxfbwflipf");
    expect(flip.faces[1]!.alternates.map((art) => art.id)).toContain("sxfbwflipb");
    expect(edition.cards.filter((card) => card.role === "main").some((card) => card.faces[0]?.defaultArt?.id === "sxfbwbackf")).toBe(false);
    const family = edition.cards.find((card) => card.name.includes("Family"))!;
    expect(family.role).not.toBe("main");
    expect(family.defaultQty).toBe(0);
    const jace = edition.cards.find((card) => card.name.includes("Jace, Vryn"))!;
    expect(jace.role).toBe("extra");
    expect(jace.defaultQty).toBe(0);
    expect(jace.faces).toHaveLength(2);
    expect(jace.faces[1]!.defaultArt?.id).toBe("sxfbwjaceb");
    const treasure = edition.cards.find((card) => card.name.includes("Treasure 3"))!;
    expect(treasure.role).toBe("token");
    expect(edition.cards.filter((card) => card.role === "main").length).toBe(4);
    for (const name of ["Token - Elephant", "Token Foretell 2", "Token - Gold 1", "Token - Gold 2", "Token - Radiation", "Token - Treasure 1", "Token - Treasure 2"]) {
      const token = edition.cards.find((card) => card.name === name);
      expect(token?.id).toBe(`main-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
      expect(token?.role).toBe("token");
      expect(token?.defaultQty).toBe(0);
    }
    const fresh = selectAllCards(edition, []);
    const treasureOnly = edition.cards.find((card) => card.name.includes("Treasure 3"))!;
    expect(treasureOnly.bwOnly).toBe(true);
    expect(fresh.find((card) => card.cardId === treasureOnly.id)?.pairs[0]?.qty).toBe(0);
    const added = selectAllCards(edition, [{ cardId: treasureOnly.id, locked: false, pairs: [{ art: "", qty: 1 }] }]);
    expect(added.find((card) => card.cardId === treasureOnly.id)?.pairs[0]?.qty).toBe(1);
    const selected = selectionToSlots(edition, fresh);
    const exported = new Set(selected.map((slot) => slot.front.id));
    expect(exported.has("sxfcolorsol")).toBe(true);
    expect(exported.has("sxfbwsol")).toBe(false);
    expect(exported.has("sxfbw-island1")).toBe(false);
    expect(exported.has("sxfbw17")).toBe(false);
    const randomized = randomizeUnlocked(edition, fresh.filter((card) => edition.cards.find((item) => item.id === card.cardId)?.role === "main"), () => 0.99);
    const randomIds = new Set(selectionToSlots(edition, randomized).map((slot) => slot.front.id));
    expect(randomIds.has("sxfbwsol")).toBe(false);
    expect(randomIds.has("sxfbw-island1")).toBe(false);
    const floating = catalogueFromTree(
      folder("fwpf", "3_Floating World Partial Foil Edition", [
        folder("fwpdf", "PDF Partial Foil Map", [
          folder("fwcolor", "Color Partial Foil Map", [file("fwisland1", "Island 1.pdf"), file("fwisland2", "Island 2.pdf")]),
        ]),
      ]),
    ).editions[0]!;
    expect(floating.cards.filter((card) => card.role === "main").map((card) => card.name).sort()).toEqual(["Island 1", "Island 2"]);
  });

  it("attaches a Color file with the same name as an alternate", () => {
    const edition = catalogueFromTree(
      folder("altroot", "1_Example Standard Edition", [
        folder("altfull", "Full Deck", [
          file("altloose", "Sol Ring.jpg"),
          folder("altoptions", "IMPORTANT OPTIONS", [folder("altcolor", "Color", [file("altcolorfile", "Sol Ring.jpg")])]),
        ]),
      ]),
    ).editions[0]!;
    const sol = edition.cards.filter((card) => card.name === "Sol Ring");
    expect(sol).toHaveLength(1);
    expect(sol[0]!.faces[0]!.defaultArt?.id).toBe("altloose");
    expect(sol[0]!.faces[0]!.alternates.map((art) => art.id)).toEqual(["altcolorfile"]);
  });
});

describe("deluxe alt backs", () => {
  it("puts Esper Terra 1–3 on the back face and a seeded random can print one", () => {
    const edition = catalogueFromTree(
      folder("terra-pack", "3_P5", [
        folder("terra-dx", "2_P5 Deluxe Edition", [
          folder("terra-dpi", "Deluxe Edition (1200 DPI)", [
            file("terra-f", "1_1_Terra, Magical Adept.jpg"),
            file("terra-b", "1_2_Esper Terra.jpg"),
            folder("terra-alt", "Alt", [
              file("esper-1", "Esper Terra 1.jpg"),
              file("esper-2", "Esper Terra 2.jpg"),
              file("esper-3", "Esper Terra 3.jpg"),
              file("terra-note", "notes.txt"),
              folder("terra-std", "Standard Edition", [file("terra-std-file", "Sol Ring.jpg")]),
            ]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const terra = edition.cards.find((card) => card.name.includes("Terra, Magical Adept"))!;
    expect(terra.faces[0]!.defaultArt?.id).toBe("terra-f");
    expect(terra.faces[0]!.alternates.map((art) => art.id)).not.toEqual(expect.arrayContaining(["esper-1", "esper-2", "esper-3"]));
    expect(terra.faces[1]!.defaultArt?.id).toBe("terra-b");
    expect(terra.faces[1]!.alternates.map((art) => art.id).sort()).toEqual(["esper-1", "esper-2", "esper-3"]);
    expect(edition.cards.some((card) => card.faces[0]?.defaultArt?.id === "terra-note" || card.faces[0]?.defaultArt?.id === "terra-std-file")).toBe(false);
    const designed = designedSelection(edition);
    let step = 0;
    const rolled = randomizeUnlocked(edition, designed, () => (step++ === 0 ? 0 : 0.99));
    const pair = rolled.find((card) => card.cardId === terra.id)!.pairs[0]!;
    expect(pair.art).toBe("terra-f");
    expect(pair.back).toBe("esper-3");
    expect(selectionToSlots(edition, rolled).find((slot) => slot.front.id === "terra-f")?.back?.id).toBe("esper-3");
  });

  it("does not absorb Alt into a standard edition", () => {
    const edition = catalogueFromTree(
      folder("std-alt", "1_Example Standard Edition", [
        folder("std-full", "Full Deck", [file("std-sol", "Sol Ring.jpg"), folder("std-alt-folder", "Alt", [file("std-alt-file", "Badlands.jpg")])]),
      ]),
    ).editions[0]!;
    expect(edition.cards.some((card) => card.name === "Badlands" || card.faces[0]?.defaultArt?.id === "std-alt-file")).toBe(false);
    const twins = catalogueFromTree(
      folder("twin-pack", "3_P5", [
        folder("twin-dx", "2_P5 Deluxe Edition", [
          folder("twin-dpi", "Deluxe Edition (1200 DPI)", [
            file("twin-main", "Sol Ring.jpg"),
            folder("twin-alt", "Alt", [folder("twin-a", "A", [file("twin-1", "Island.jpg")]), folder("twin-b", "B", [file("twin-2", "Island.jpg")])]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const islandIds = twins.cards.filter((card) => card.name === "Island").map((card) => card.id);
    expect(new Set(islandIds).size).toBe(islandIds.length);
    expect(islandIds.length).toBe(2);
  });

  it("uses the face match for an exact back name", () => {
    const edition = catalogueFromTree(
      folder("match-pack", "3_P5", [
        folder("match-dx", "2_P5 Deluxe Edition", [
          folder("match-dpi", "Deluxe Edition (1200 DPI)", [
            file("short-front", "1_1_Terra.jpg"),
            file("long-back", "1_2_Terra, Magical Adept.jpg"),
            folder("match-alt", "Alt", [file("exact-back", "Terra, Magical Adept.jpg")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const card = edition.cards.find((item) => item.faces.length > 1)!;
    expect(card.faces[0]!.defaultArt?.id).toBe("short-front");
    expect(card.faces[1]!.defaultArt?.id).toBe("long-back");
    expect(card.faces[1]!.alternates.map((art) => art.id)).toContain("exact-back");
    expect(card.faces[0]!.alternates.map((art) => art.id)).not.toContain("exact-back");
  });

  it("keeps a one-letter front typo on the front face", () => {
    const edition = catalogueFromTree(
      folder("typo-pack", "3_P5", [
        folder("typo-dx", "2_P5 Deluxe Edition", [
          folder("typo-dpi", "Deluxe Edition (1200 DPI)", [
            file("typo-front", "1_1_Terra, Magical Adept.jpg"),
            file("typo-back", "1_2_Esper Terra.jpg"),
            folder("typo-alt", "Alt", [file("typo-file", "Terra, Magical Adpet.jpg")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    const card = edition.cards.find((item) => item.faces[0]?.defaultArt?.id === "typo-front")!;
    expect(card.faces[0]!.defaultArt?.id).toBe("typo-front");
    expect(card.faces[0]!.alternates.map((art) => art.id)).toContain("typo-file");
    expect(card.faces[1]!.alternates.map((art) => art.id)).not.toContain("typo-file");
  });
});

describe("a pasted PDF partial foil map", () => {
  it("prints from the map folder itself and takes the parent pack name", () => {
    const tree = folder("pdfmaproot01", "PDF Partial Foil Map", [
      folder("mapfull00001", "Full Deck", [file("mappdfsol000000000000000001", "Sol Ring.pdf"), file("mapjpgsol000000000000000001", "Sol Ring.png")]),
    ]);
    const edition = groupPartialFoilEdition(tree);
    expect(edition.printType).toBe("partial_foil");
    expect(artIdsOf(edition).has("mappdfsol000000000000000001")).toBe(true);
    expect(cleanDeckName("PDF Partial Foil Map")).toBe("");
    expect(preferDeckName("PDF Partial Foil Map", "3_P5 Partial Foil Edition")).toBe("P5");
    expect(catalogueFromTree(tree, preferDeckName(tree.name, "3_P5 Partial Foil Edition")).name).toBe("P5");
  });

  it("does not treat a JPG-only Partial Foil Map as a PDF root", () => {
    const edition = groupPartialFoilEdition(
      folder("jpgmap000001", "Partial Foil Map", [file("previewonly0000000000000001", "Sol Ring.jpg")]),
    );
    expect(edition.printType).toBe("partial_foil");
    expect(edition.cards).toEqual([]);
    expect(artIdsOf(edition).has("previewonly0000000000000001")).toBe(false);
  });

  it("still names a numbered pack from its own title", () => {
    expect(cleanDeckName("2_Silksong Deluxe Edition")).toBe("Silksong");
    expect(cleanDeckName("3_Silksong Partial Foil Edition")).toBe("Silksong");
    expect(preferDeckName("2_Silksong Deluxe Edition", "Decks")).toBe("Silksong");
    expect(preferDeckName("PDF Partial Foil Map", "3_P5 Partial Foil Edition")).toBe("P5");
    expect(preferDeckName("PDF Map", null)).toBe("PDF Map");
    expect(preferDeckName("Foil", "3_P5 Partial Foil Edition")).toBe("P5");
    expect(preferDeckName("Prints", "2_Silksong Deluxe Edition")).toBe("Silksong");
  });
});

function frontsOf(xml: string): string {
  const backsAt = xml.indexOf("<backs>");
  return backsAt === -1 ? xml : xml.slice(0, backsAt);
}
