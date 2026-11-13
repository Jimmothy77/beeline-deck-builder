import { describe, expect, it } from "vitest";
import { kpdhLikeTree } from "@/lib/fixtures/foil-maps-tree";
import {
  attachFoilMaps,
  canShowFoil,
  FOIL_SESSION_KEY,
  foilMapsMissing,
  foilView,
  isFoilMaskFolderName,
  maskKey,
  readShowFoil,
  splitFoilMasks,
  writeShowFoil,
} from "@/lib/foil-maps";
import { freshDraft } from "@/lib/draft";
import { artIdsOf, catalogueFromTree, pdfIdsInEdition } from "@/lib/group";
import { makeRestoreCode, readRestoreCode } from "@/lib/restore-code";
import { selectAllCards, selectionToSlots } from "@/lib/selection";
import { parseUnlocked, packForStorage, type UnlockedPack } from "@/lib/storage";
import type { ArtFile, DeckCard, DeckCatalogue, Edition } from "@/lib/types";
import { buildXml } from "@/lib/xml";

const partialOf = (catalogue: DeckCatalogue) => catalogue.editions.find((edition) => edition.printType === "partial_foil")!;
const artsOf = (edition: Edition): ArtFile[] => edition.cards.flatMap((card) => card.faces.flatMap((face) => [face.defaultArt, ...face.alternates].filter((art): art is ArtFile => Boolean(art))));
const card = (edition: Edition, name: string) => edition.cards.find((item) => item.name === name)!;
/** The catalogue with mask data taken off, to compare with one built without masks. */
function withoutMasks(catalogue: DeckCatalogue): DeckCatalogue {
  return JSON.parse(JSON.stringify(catalogue, (key, value) => (key === "maskId" || key === "foilMaps" ? undefined : value))) as DeckCatalogue;
}
function xmlOf(edition: Edition, deck: DeckCatalogue): string[] {
  const draft = freshDraft(deck, edition, "golden", new Date(0));
  const cardback = draft.cardbackId || edition.backs[0]?.id || "";
  if (!cardback) return [];
  return [draft.cards, selectAllCards(edition, draft.cards)].map((cards) =>
    buildXml({ slots: selectionToSlots(edition, cards, { cardBacks: draft.cardBacks, cardback }), cardback, deck: deck.name, printType: edition.printType, pdfIds: pdfIdsInEdition(edition) }),
  );
}

describe("foil mask names", () => {
  it("matches across the apostrophe underscore, case, NFC, extension and outer or doubled spaces", () => {
    expect(maskKey("Akroma_s Will (The Honmoon).png")).toBe(maskKey("Akroma's Will (The Honmoon).pdf"));
    expect(maskKey("Akroma’s Will (The Honmoon).pdf")).toBe(maskKey("Akroma_s Will (The Honmoon).png"));
    expect(maskKey("SOL RING  .png")).toBe(maskKey("Sol Ring.pdf"));
    expect(maskKey("  Sol   Ring .png")).toBe(maskKey("sol ring.pdf"));
    expect(maskKey("Cafe\u0301 Sign.png")).toBe(maskKey("Caf\u00e9 Sign.pdf"));
    // The face stays part of the key, so a back's mask never fits its front.
    expect(maskKey("1_2_Soporific Springs (Serene Rooftops).png")).toBe(maskKey("1_2_Soporific Springs (Serene Rooftops).pdf"));
    expect(maskKey("1_2_Soporific Springs.png")).not.toBe(maskKey("1_1_Soporific Springs.pdf"));
    expect(maskKey("1_2 Lost Vale.png")).toBe(maskKey("1_2_Lost Vale.pdf"));
  });

  it("knows the mask folder from the PDF print map", () => {
    expect(isFoilMaskFolderName("Partial Foil Map")).toBe(true);
    expect(isFoilMaskFolderName("Partial-Foil map")).toBe(true);
    expect(isFoilMaskFolderName("PDF Partial Foil Map")).toBe(false);
    expect(isFoilMaskFolderName("Partial Foil Templates")).toBe(false);
    expect(isFoilMaskFolderName("Extras")).toBe(false);
  });
});

describe("Partial Foil masks in an unlock", () => {
  const withMasks = catalogueFromTree(kpdhLikeTree());
  const plain = catalogueFromTree(kpdhLikeTree({ masks: false }));
  const partial = partialOf(withMasks);

  it("never turns a mask into a card: cards, ids, backs, totals and XML are the same as without the mask folder", () => {
    expect(withoutMasks(withMasks)).toEqual(plain);
    for (const edition of withMasks.editions) {
      const before = plain.editions.find((item) => item.id === edition.id)!;
      expect(artIdsOf(edition)).toEqual(artIdsOf(before));
      expect(xmlOf(edition, withMasks)).toEqual(xmlOf(before, plain));
    }
    expect(xmlOf(partial, withMasks)).toHaveLength(2);
    const maskIds = new Set(splitFoilMasks(kpdhLikeTree()).masks.map((mask) => mask.id));
    expect(maskIds.size).toBe(8);
    for (const art of withMasks.editions.flatMap(artsOf)) {
      expect(maskIds.has(art.id), art.name).toBe(false);
      expect(maskIds.has(art.thumbId), art.name).toBe(false);
    }
    for (const xml of withMasks.editions.flatMap((edition) => xmlOf(edition, withMasks))) for (const id of maskIds) expect(xml).not.toContain(id);
  });

  it("takes the mask folder out of the tree and keeps only images as masks", () => {
    const { tree, masks } = splitFoilMasks(kpdhLikeTree());
    expect(JSON.stringify(tree)).not.toContain("fm-maskroot-00");
    expect(tree.maskScan).toBeUndefined();
    expect(masks.map((mask) => mask.name)).not.toContain("Notes.txt");
    expect(masks.find((mask) => mask.id === "fm-m-tokt-00")?.group).toBe("tokens");
    expect(masks.find((mask) => mask.id === "fm-m-alela-00")?.group).toBe("extras");
    expect(masks.find((mask) => mask.id === "fm-m-akroma-00")?.group).toBe("main");
  });

  it("pairs each print file with its mask by name, faces, Extras and Tokens included", () => {
    expect(card(partial, "Akroma's Will (The Honmoon)").faces[0]!.defaultArt?.maskId).toBe("fm-m-akroma-00");
    const dfc = card(partial, "Dream Gate (Serene Rooftops) // Soporific Springs (Serene Rooftops)");
    expect(dfc.faces.map((face) => face.defaultArt?.maskId)).toEqual(["fm-m-dreamf-00", "fm-m-sopor-00"]);
    expect(card(partial, "Café Sign").faces[0]!.defaultArt?.maskId).toBe("fm-m-cafe-00");
    expect(card(partial, "Sol Ring").faces[0]!.defaultArt?.maskId).toBe("fm-m-sol-00");
    expect(card(partial, "Alela (Hornet)").faces[0]!.defaultArt?.maskId).toBe("fm-m-alela-00");
    // Two masks named "Token 1": the token takes the one in Tokens, not the one in Extras.
    expect(card(partial, "Token 1").faces.map((face) => face.defaultArt?.maskId)).toEqual(["fm-m-tokt-00", "fm-m-tokt-00"]);
    expect(partial.foilMaps).toEqual({ found: 8, total: 9 });
  });

  it("leaves a card with no mask on its own art, and a deck with no mask folder works with every card unmatched", () => {
    const signet = card(partial, "Arcane Signet").faces[0]!.defaultArt!;
    expect(signet.maskId).toBeUndefined();
    expect(signet.thumbId).toBe(card(partialOf(plain), "Arcane Signet").faces[0]!.defaultArt!.thumbId);
    const noFolder = kpdhLikeTree({ masks: false });
    noFolder.maskScan = true;
    const empty = partialOf(catalogueFromTree(noFolder));
    expect(empty.foilMaps).toEqual({ found: 0, total: 9 });
    expect(artsOf(empty).every((art) => !art.maskId)).toBe(true);
    // An older crawl (no maskScan) records nothing at all: that is how an old unlock is told apart.
    expect(partialOf(plain).foilMaps).toBeUndefined();
  });

  it("matches by card name when the print file and mask differ only in their variant, but never guesses between two", () => {
    const edition: Edition = {
      id: "pf",
      name: "Partial Foil",
      printType: "partial_foil",
      backs: [],
      notes: [],
      cards: [
        { id: "a", name: "Akroma's Will", role: "main", defaultQty: 1, faces: [{ id: "a1", name: "Akroma's Will", defaultArt: { id: "p1", name: "Akroma's Will.pdf", thumbId: "p1", label: "" }, alternates: [] }] },
        { id: "b", name: "Sol Ring", role: "main", defaultQty: 1, faces: [{ id: "b1", name: "Sol Ring", defaultArt: { id: "p2", name: "Sol Ring.pdf", thumbId: "p2", label: "" }, alternates: [] }] },
        {
          id: "c",
          name: "Lost Vale // Lost Vale",
          role: "main",
          defaultQty: 1,
          faces: [
            { id: "c1", name: "Lost Vale", defaultArt: { id: "p3", name: "1_1_Lost Vale.pdf", thumbId: "p3", label: "" }, alternates: [] },
            { id: "c2", name: "Lost Vale", defaultArt: { id: "p4", name: "1_2_Lost Vale.pdf", thumbId: "p4", label: "" }, alternates: [] },
          ],
        },
      ],
    };
    const [out] = attachFoilMaps([edition], [
      { id: "m1", name: "Akroma_s Will (The Honmoon).png", group: "main" },
      { id: "m2", name: "Sol Ring (One).png", group: "main" },
      { id: "m3", name: "Sol Ring (Two).png", group: "main" },
      { id: "m4", name: "1_1_Lost Vale.png", group: "main" },
      { id: "m5", name: "1_2_Lost Vale.png", group: "main" },
    ]);
    // Two faces with the same name: each face takes the mask of its own side.
    expect(out!.cards[2]!.faces.map((face) => face.defaultArt?.maskId)).toEqual(["m4", "m5"]);
    expect(out!.cards[0]!.faces[0]!.defaultArt?.maskId).toBe("m1");
    expect(out!.cards[1]!.faces[0]!.defaultArt?.maskId).toBeUndefined();
    // Standard and Deluxe editions are left alone.
    const [standard] = attachFoilMaps([{ ...edition, printType: "standard" }], [{ id: "m1", name: "Akroma's Will.png", group: "main" }]);
    expect(standard!.foilMaps).toBeUndefined();
    expect(standard!.cards[0]!.faces[0]!.defaultArt?.maskId).toBeUndefined();
  });

  it("keeps mask ids in the stored pack and in a restore code, like art ids", async () => {
    const pack: UnlockedPack = { packHash: "0123456789ab", savedAt: "2026-11-12T00:00:00.000Z", catalogue: withMasks };
    const stored = parseUnlocked(JSON.parse(JSON.stringify(packForStorage(pack))))!;
    expect(partialOf(stored.catalogue).foilMaps).toEqual({ found: 8, total: 9 });
    expect(card(partialOf(stored.catalogue), "Sol Ring").faces[0]!.defaultArt?.maskId).toBe("fm-m-sol-00");
    const restored = await readRestoreCode(await makeRestoreCode([pack], { compress: false }));
    expect(card(partialOf(restored[0]!.catalogue), "Sol Ring").faces[0]!.defaultArt?.maskId).toBe("fm-m-sol-00");
    // A damaged count is dropped, which reads as an old unlock (a note, never a crash).
    const broken = JSON.parse(JSON.stringify(packForStorage(pack)));
    broken.catalogue.editions[0].foilMaps = { found: 9, total: 2 };
    expect(partialOf(parseUnlocked(broken)!.catalogue).foilMaps).toBeUndefined();
  });
});

describe("showing the foiled area", () => {
  const partial: Edition = { ...partialOf(catalogueFromTree(kpdhLikeTree())), origin: "unlocked" };

  it("shows only on an unlocked Partial Foil edition", () => {
    expect(canShowFoil(partial)).toBe(true);
    expect(canShowFoil({ ...partial, origin: "shipped" })).toBe(false);
    expect(canShowFoil({ ...partial, origin: undefined })).toBe(false);
    expect(canShowFoil({ printType: "standard", origin: "unlocked" })).toBe(false);
  });

  it("swaps only thumbnails to masks, and marks a print with no mask", () => {
    const shown = foilView(partial);
    const sol = card(shown, "Sol Ring").faces[0]!.defaultArt!;
    expect(sol.thumbId).toBe("fm-m-sol-00");
    expect(sol.id).toBe(card(partial, "Sol Ring").faces[0]!.defaultArt!.id);
    expect(sol.noFoilMap).toBeUndefined();
    const signet = card(shown, "Arcane Signet").faces[0]!.defaultArt!;
    expect(signet.noFoilMap).toBe(true);
    expect(signet.thumbId).toBe(card(partial, "Arcane Signet").faces[0]!.defaultArt!.thumbId);
    expect(artIdsOf(shown)).toEqual(artIdsOf(partial));
    // The edition itself is not changed.
    expect(card(partial, "Sol Ring").faces[0]!.defaultArt!.thumbId).not.toBe("fm-m-sol-00");
  });

  it("leaves other editions, and an old unlock with no mask data, as they are", () => {
    const old = { ...partial, foilMaps: undefined };
    expect(foilMapsMissing(old)).toBe(true);
    expect(foilView(old)).toBe(old);
    const deluxe = { ...partial, printType: "standard" as const };
    expect(foilView(deluxe)).toBe(deluxe);
  });

  it("remembers the switch for the session, and treats a broken storage as off", () => {
    const map = new Map<string, string>();
    const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
    expect(readShowFoil(store)).toBe(false);
    writeShowFoil(store, true);
    expect(map.get(FOIL_SESSION_KEY)).toBe("1");
    expect(readShowFoil(store)).toBe(true);
    writeShowFoil(store, false);
    expect(readShowFoil(store)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readShowFoil(broken)).toBe(false);
    expect(() => writeShowFoil(broken, true)).not.toThrow();
    expect(readShowFoil(null)).toBe(false);
  });
});


describe("variant and art number in the by-card match (v0.1.37)", () => {
  const art = (id: string, name: string): ArtFile => ({ id, name, thumbId: id, label: "" });
  const oneFace = (id: string, name: string, arts: ArtFile[]): DeckCard => ({ id, name, role: "main", defaultQty: 1, faces: [{ id: `${id}:f`, name, defaultArt: arts[0]!, alternates: arts.slice(1) }] });
  const edition = (cards: DeckCard[]): Edition => ({ id: "pf", name: "Partial Foil", printType: "partial_foil", backs: [], notes: [], cards });
  const masksOf = (out: Edition) => out.cards.map((item) => item.faces[0]!.alternates.concat(item.faces[0]!.defaultArt ? [item.faces[0]!.defaultArt] : []).map((file) => `${file.id}=${file.maskId ?? "-"}`).sort());

  it("never gives a print another variant's mask when both name a variant", () => {
    const [out] = attachFoilMaps(
      [edition([oneFace("forest-g", "Forest (Greenpath)", [art("p-g", "Forest (Greenpath).pdf")]), oneFace("forest-f", "Forest (Fog Canyon)", [art("p-f", "Forest (Fog Canyon).pdf")])])],
      [{ id: "m-fog", name: "forest  (fog canyon).png", group: "main" }],
    );
    expect(masksOf(out!)).toEqual([["p-g=-"], ["p-f=m-fog"]]);
    // A variant on one side only still matches, as before.
    const [loose] = attachFoilMaps([edition([oneFace("forest", "Forest", [art("p", "Forest.pdf")])])], [{ id: "m-fog", name: "Forest (Fog Canyon).png", group: "main" }]);
    expect(masksOf(loose!)).toEqual([["p=m-fog"]]);
    // The same variant, written differently, matches.
    const [same] = attachFoilMaps([edition([oneFace("forest-g", "Forest (Greenpath)", [art("p-g", "Forest (Greenpath) 1.pdf")])])], [{ id: "m-g", name: "FOREST ( greenpath ).png", group: "main" }]);
    expect(masksOf(same!)).toEqual([["p-g=m-g"]]);
  });

  it("keeps the art number when a card has more than one art", () => {
    const sol = oneFace("sol", "Sol Ring", [art("p1", "Sol Ring.pdf"), art("p2", "Sol Ring 2.pdf"), art("p3", "Sol Ring 3 (Foil).pdf")]);
    const [out] = attachFoilMaps([edition([sol])], [
      { id: "m1", name: "Sol Ring.png", group: "main" },
      { id: "m3", name: "Sol Ring 3.png", group: "main" },
    ]);
    // Art 1 has its own mask, art 2 has none (never art 1's). Art 3 has a variant its mask doesn't name, so
    // since v0.1.38 it has none either: on a card with more than one art the variant must be the same.
    expect(masksOf(out!)).toEqual([["p1=m1", "p2=-", "p3=-"]]);
    // With a single art the number is not a different print: "Sol Ring 2" alone still takes "Sol Ring".
    const [single] = attachFoilMaps([edition([oneFace("sol", "Sol Ring", [art("p2", "Sol Ring 2.pdf")])])], [{ id: "m1", name: "Sol Ring.png", group: "main" }]);
    expect(masksOf(single!)).toEqual([["p2=m1"]]);
    // "Sol Ring 1" and an unnumbered "Sol Ring" are the same art.
    const [first] = attachFoilMaps([edition([oneFace("sol", "Sol Ring", [art("p1", "Sol Ring.pdf"), art("p2", "Sol Ring 2.pdf")])])], [{ id: "m1", name: "Sol Ring 1.png", group: "main" }]);
    expect(masksOf(first!)).toEqual([["p1=m1", "p2=-"]]);
  });
});

describe("no variant is its own variant on a card with more than one art (v0.1.38)", () => {
  const art = (id: string, name: string): ArtFile => ({ id, name, thumbId: id, label: "" });
  const forest = (arts: ArtFile[]): Edition => ({
    id: "pf",
    name: "Partial Foil",
    printType: "partial_foil",
    backs: [],
    notes: [],
    cards: [{ id: "forest", name: "Forest", role: "main", defaultQty: 1, faces: [{ id: "forest:f", name: "Forest", defaultArt: arts[0]!, alternates: arts.slice(1) }] }],
  });
  const masksOf = (out: Edition) => [out.cards[0]!.faces[0]!.defaultArt!, ...out.cards[0]!.faces[0]!.alternates].map((file) => `${file.id}=${file.maskId ?? "-"}`);

  it("never gives a plain Forest the Forest (Greenpath) mask, and never the other way round", () => {
    const [out] = attachFoilMaps([forest([art("p", "Forest.pdf"), art("p-g", "Forest (Greenpath).pdf"), art("p-f", "Forest (Fog Canyon) 3.pdf")])], [{ id: "m-g", name: "forest ( greenpath ) 1.png", group: "main" }]);
    expect(masksOf(out!)).toEqual(["p=-", "p-g=m-g", "p-f=-"]);
    const [back] = attachFoilMaps([forest([art("p", "Forest 1.pdf"), art("p-g", "Forest (Greenpath) 2.pdf")])], [{ id: "m", name: "Forest.png", group: "main" }]);
    expect(masksOf(back!)).toEqual(["p=m", "p-g=-"]);
    const [variantsOnly] = attachFoilMaps([forest([art("p-g", "Forest (Greenpath).pdf"), art("p-f", "Forest (Fog Canyon).pdf")])], [{ id: "m", name: "Forest.png", group: "main" }]);
    expect(masksOf(variantsOnly!)).toEqual(["p-g=-", "p-f=-"]);
  });

  it("still lets a one-art card's plain file take a variant mask", () => {
    const [out] = attachFoilMaps([forest([art("p", "Forest.pdf")])], [{ id: "m-g", name: "Forest (Greenpath).png", group: "main" }]);
    expect(masksOf(out!)).toEqual(["p=m-g"]);
  });
});
