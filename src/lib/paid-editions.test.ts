import { describe, expect, it } from "vitest";
import { catalogueFromTree } from "@/lib/group";
import { slug } from "@/lib/names";
import { oversizedDeckWarning, selectionToSlots } from "@/lib/selection";
import { resolveSavedDeck, type SavedDeck } from "@/lib/storage";
import type { Edition, RawNode } from "@/lib/types";

function file(id: string, name: string): RawNode {
  return { id, name, folder: false };
}
function folder(id: string, name: string, children: RawNode[]): RawNode {
  return { id, name, folder: true, children };
}

function pin(edition: Edition) {
  return edition.cards.map((card) => [card.id, card.name, card.role, card.defaultQty]);
}

function mainId(name: string): string {
  return `main-${slug(name)}`;
}

describe("paid editions keep v0.1.13 card ids and quantities", () => {
  it("pins Vader, KPDH, Persona 5, Dr. Eggman, Spy x Family, and Floating World", () => {
    const vaderSwamps = Array.from({ length: 16 }, (_, index) => file(`vsw${index + 1}`, `Swamp ${index + 1}.jpg`));
    const vader = catalogueFromTree(
      folder("vader", "3_Vader", [
        folder("vaderdx", "2_Vader Deluxe Edition", [
          folder("vaderdpi", "Deluxe Edition (1200 DPI)", [...vaderSwamps, file("vsol", "Sol Ring.jpg"), folder("vnotes", "Notes", [file("vreadme", "readme.txt")])]),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(vader)).toEqual([
      ...Array.from({ length: 16 }, (_, index) => [mainId(`Swamp ${index + 1}`), `Swamp ${index + 1}`, "main", 1]),
      [mainId("Sol Ring"), "Sol Ring", "main", 1],
    ]);
    expect(oversizedDeckWarning(vader)).toBeNull();

    const kpdhNames = ["Akroma's Will", "Aligned Heart", "Arcane Signet", ...Array.from({ length: 12 }, (_, index) => `Token - Treasure ${index + 1}`)];
    const kpdh = catalogueFromTree(
      folder("kpdh", "3_KPDH Partial Foil Edition", [
        folder("kpdhpdf", "PDF Partial Foil Map", [
          folder("kpdhfull", "Full Deck", kpdhNames.map((name, index) => file(`kpdh-${index}`, `${name}.pdf`))),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(kpdh)).toEqual(kpdhNames.map((name) => [mainId(name), name, "main", 1]));
    expect(kpdh.cards.filter((card) => card.id.startsWith("token-token-"))).toEqual([]);

    const eggmanNames = ["Arcane Signet", "Token - Treasure 1"];
    const eggman = catalogueFromTree(
      folder("egg", "3_Dr Eggman Partial Foil Edition", [
        folder("eggpdf", "PDF Partial Foil Map", [
          folder("eggfull", "Full Deck", eggmanNames.map((name, index) => file(`egg-${index}`, `${name}.pdf`))),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(eggman)).toEqual(eggmanNames.map((name) => [mainId(name), name, "main", 1]));

    const p5Names = [...Array.from({ length: 100 }, (_, index) => `Spell ${index}`), "Island 1", "Island 2"];
    const persona = catalogueFromTree(
      folder("p5", "3_P5 Partial Foil Edition", [
        folder("p5pdf", "PDF Partial Foil Map", [
          folder("p5full", "Full Deck", p5Names.map((name, index) => file(`p5-${index}`, `${name}.pdf`))),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(persona)).toEqual(p5Names.map((name) => [mainId(name), name, "main", 1]));
    expect(oversizedDeckWarning(persona)).toMatch(/102 main cards/);

    const sxfDeluxeNames = Array.from({ length: 101 }, (_, index) => `Island ${index + 1}`);
    const sxfDeluxe = catalogueFromTree(
      folder("sxf", "3_SxF", [
        folder("sxfdx", "2_SxF Deluxe Edition", [
          folder("sxfdpi", "Deluxe Edition (1200 DPI)", [
            ...sxfDeluxeNames.map((name, index) => file(`sxfdx-${index}`, `${name}.jpg`)),
            folder("sxfnotes", "Notes", [file("sxfnote", "readme.txt")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(sxfDeluxe)).toEqual(sxfDeluxeNames.map((name) => [mainId(name), name, "main", 1]));
    expect(oversizedDeckWarning(sxfDeluxe)).toMatch(/101 main cards/);

    const sxfPf = catalogueFromTree(
      folder("sxfpf", "3_SxF Partial Foil Edition", [
        folder("sxfpdf", "PDF Partial Foil Map", [
          folder("sxfcolor", "Color Partial Foil Map", [
            file("sxfsol", "Sol Ring.pdf"),
            file("sxfisland", "Basic Island 1.pdf"),
            file("sxfele", "Token - Elephant.pdf"),
          ]),
          folder("sxfbw", "Black and White Partial Foil Map", [file("sxfbwisl", "Basic Island 1.pdf")]),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(sxfPf)).toEqual([
      [mainId("Sol Ring"), "Sol Ring", "main", 1],
      [mainId("Basic Island 1"), "Basic Island 1", "main", 1],
      [mainId("Token - Elephant"), "Token - Elephant", "token", 0],
    ]);
    expect(sxfPf.cards.find((card) => card.name === "Basic Island 1")!.faces[0]!.alternates.map((art) => art.id)).toEqual(["sxfbwisl"]);

    const floatingNames = Array.from({ length: 101 }, (_, index) => `Forest ${index + 1}`);
    const floatingDeluxe = catalogueFromTree(
      folder("fw", "3_Floating World", [
        folder("fwdx", "2_Floating World Deluxe Edition", [
          folder("fwdpi", "Deluxe Edition (1200 DPI)", [
            ...floatingNames.map((name, index) => file(`fw-${index}`, `${name}.jpg`)),
            folder("fwnotes", "Notes", [file("fwnote", "readme.txt")]),
          ]),
        ]),
      ]),
    ).editions[0]!;
    expect(pin(floatingDeluxe)).toEqual(floatingNames.map((name) => [mainId(name), name, "main", 1]));
    expect(oversizedDeckWarning(floatingDeluxe)).toMatch(/101 main cards/);

    const floatingPf = catalogueFromTree(
      folder("fwpf", "3_Floating World Partial Foil Edition", [
        folder("fwpdf", "PDF Partial Foil Map", [
          folder("fwfull", "Full Deck", [file("fwsol", "Accumulated Knowledge.pdf"), file("fwisl", "Island 1.pdf"), file("fwisl2", "Island 2.pdf")]),
        ]),
      ]),
    ).editions[0]!;
    const altEdition = catalogueFromTree(
      folder("altdx", "2_P5 Deluxe Edition", [
        folder("altdpi", "Deluxe Edition (1200 DPI)", [
          file("altdxsol", "Sol Ring.png"),
          folder("altroot", "Alt", [folder("altlands", "Lands", [folder("altduals", "True Duals", [file("altbad", "Badlands.jpg"), file("altplateau", "Plateau.jpg")])])]),
        ]),
      ]),
    ).editions[0]!;
    expect(altEdition.cards.find((card) => card.name === "Sol Ring")?.faces[0]?.defaultArt?.id).toBe("altdxsol");
    expect(altEdition.cards.filter((card) => card.role === "extra").map((card) => [card.id, card.name, card.defaultQty])).toEqual([
      [mainId("Badlands").replace(/^main-/, "extra-"), "Badlands", 0],
      [mainId("Plateau").replace(/^main-/, "extra-"), "Plateau", 0],
    ]);
    expect(pin(floatingPf)).toEqual([
      [mainId("Accumulated Knowledge"), "Accumulated Knowledge", "main", 1],
      [mainId("Island 1"), "Island 1", "main", 1],
      [mainId("Island 2"), "Island 2", "main", 1],
    ]);
  });

  it("exports every copy of a v0.1.11 KPDH and Dr. Eggman partial foil save", () => {
    const saveOf = (edition: Edition, catalogueId: string, deckName: string): SavedDeck => ({
      id: catalogueId,
      name: deckName,
      deckId: catalogueId,
      deckName,
      editionId: edition.id,
      editionName: edition.name,
      printType: "partial_foil",
      treatment: null,
      cardbackId: null,
      cards: edition.cards
        .filter((card) => card.role === "main")
        .map((card) => ({ cardId: card.id, locked: false, pairs: [{ art: card.faces[0]!.defaultArt!.id, qty: 1 }] })),
      updatedAt: "2026-11-09T00:00:00.000Z",
    });
    const kpdhNames = ["Akroma's Will", ...Array.from({ length: 12 }, (_, index) => `Token - Treasure ${index + 1}`)];
    const kpdhCatalogue = catalogueFromTree(
      folder("kpdh2", "3_KPDH Partial Foil Edition", [
        folder("kpdhpdf2", "PDF Partial Foil Map", [folder("kpdhfull2", "Full Deck", kpdhNames.map((name, index) => file(`k2-${index}`, `${name}.pdf`)))]),
      ]),
    );
    const kpdh = kpdhCatalogue.editions[0]!;
    const kpdhSaved = saveOf(kpdh, kpdhCatalogue.id, "KPDH");
    const kpdhResolved = resolveSavedDeck(kpdhSaved, [], [kpdhCatalogue]);
    expect(kpdhResolved.note).toBeNull();
    expect(selectionToSlots(kpdh, kpdhResolved.deck.cards)).toHaveLength(kpdhNames.length);

    const eggCatalogue = catalogueFromTree(
      folder("egg2", "3_Dr Eggman Partial Foil Edition", [
        folder("eggpdf2", "PDF Partial Foil Map", [
          folder("eggfull2", "Full Deck", [file("eggsol", "Arcane Signet.pdf"), file("eggtok", "Token - Treasure 1.pdf")]),
        ]),
      ]),
    );
    const egg = eggCatalogue.editions[0]!;
    const eggSaved = saveOf(egg, eggCatalogue.id, "Dr. Eggman");
    const eggResolved = resolveSavedDeck(eggSaved, [], [eggCatalogue]);
    expect(eggResolved.note).toBeNull();
    expect(selectionToSlots(egg, eggResolved.deck.cards)).toHaveLength(2);
    expect(egg.cards.map((card) => card.id)).toEqual([mainId("Arcane Signet"), mainId("Token - Treasure 1")]);
  });
});
