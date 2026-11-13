import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unlockPfRoot } from "@/lib/fixtures/pf-root-pipeline";
import { isPartialFoilMapName, purgeMapUnlocks } from "@/lib/pf-map";
import { mergeRestored, readRestoreCode } from "@/lib/restore-code";
import { loadUnlocked, UNLOCK_KEY } from "@/lib/storage";

/**
 * A pasted Partial Foil edition root, unlocked end to end by v0.1.37's own code (fixtures/v0137-pf-root.json,
 * recorded with logs/golden_pfroot_v0137.mts in the v0.1.37 source tree, d817761, with
 * fixtures/pf-root-pipeline.ts copied in). The root is laid out like a real one: the printable PDFs in
 * "PDF Partial Foil Map/Full Deck + Tokens Folder", the PNG masks in "Partial Foil Map", a Deluxe shortcut
 * and Readme.txt. The map folders are the print and mask sources there, never a refused paste: v0.1.38 must
 * ask Drive the same things, build the same tree and catalogue, store the same text, make the same restore
 * codes and export the same XML, byte for byte. And the stored unlock (whose notes start "PDF Partial Foil
 * Map/") must never be taken for a map folder by the load or restore purge.
 */
type Recorded = Awaited<ReturnType<typeof unlockPfRoot>>;
const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/v0137-pf-root.json"), "utf8")) as { recordedWith: string; cases: Record<string, Recorded> };
const memory = (text: string) => ({ getItem: (key: string) => (key === UNLOCK_KEY ? text : null), setItem: () => {}, removeItem: () => {} }) as unknown as Storage;

describe("a pasted Partial Foil edition root unlocks exactly as v0.1.37 did (v0.1.38)", () => {
  it("was recorded with v0.1.37", () => {
    expect(golden.recordedWith).toBe("v0.1.37 (d817761)");
    expect(Object.keys(golden.cases)).toEqual(["3_KPDH Partial Foil Edition", "3_Nier Partial Foil Edition"]);
  });

  for (const [rootName, recorded] of Object.entries(golden.cases)) {
    it(`${rootName}: the same Drive requests, tree, catalogue, stored text, restore codes and XML, byte for byte`, async () => {
      const now = await unlockPfRoot(rootName);
      expect(now.requests).toEqual(recorded.requests);
      expect(now.tree).toBe(recorded.tree);
      expect(now.catalogue).toBe(recorded.catalogue);
      expect(now.stored).toBe(recorded.stored);
      expect(now.restoreCode).toBe(recorded.restoreCode);
      expect(now.restoreCodePlain).toBe(recorded.restoreCodePlain);
      expect(now.editions.map((edition) => edition.id)).toEqual(recorded.editions.map((edition) => edition.id));
      for (const [i, edition] of now.editions.entries()) {
        expect(edition.xml).toBe(recorded.editions[i]!.xml);
        expect(edition).toEqual(recorded.editions[i]);
      }
    });

    it(`${rootName}: reads its PDFs from PDF Partial Foil Map/Full Deck + Tokens Folder and its masks from Partial Foil Map`, async () => {
      const now = await unlockPfRoot(rootName);
      // Both map folders and the print folder inside the PDF map were listed: crawled, not refused.
      for (const listed of ["pr-root-00", "pr-maskroot-00", "pr-maskx-00", "pr-maskt-00", "pr-pdfmap-00", "pr-pdeck-00", "pr-pextras-00"]) expect(now.requests).toContain(`list ${listed}`);
      const partial = now.editions.find((edition) => edition.printType === "partial_foil")!;
      expect(partial.cards).toBe(7);
      expect(partial.pdfs).toEqual(["pr-p-akroma-00", "pr-p-alela-00", "pr-p-cafe-00", "pr-p-dream-00", "pr-p-signet-00", "pr-p-sol-00", "pr-p-sopor-00", "pr-p-tokback-00", "pr-p-tokfront-00"]);
      expect(partial.masks.filter((mask) => mask !== "-").length).toBeGreaterThan(0);
      expect(partial.xml).toContain("pr-p-sol-00");
      expect(JSON.parse(now.catalogue).name).toBe(rootName.replace(/^3_/, "").replace(" Partial Foil Edition", ""));
    });

    it(`${rootName}: survives the load and restore purge, notes starting "PDF Partial Foil Map/" and all`, async () => {
      const packs = loadUnlocked(memory(recorded.stored));
      expect(packs).toHaveLength(1);
      const notes = packs[0]!.catalogue.editions.flatMap((edition) => edition.notes.map((note) => note.path));
      expect(notes.some((note) => note.startsWith("PDF Partial Foil Map/"))).toBe(true);
      expect(purgeMapUnlocks(packs)).toEqual({ packs, dropped: 0 });
      const restored = mergeRestored([], await readRestoreCode(recorded.restoreCode));
      expect(restored.maps).toBe(0);
      expect(restored.packs.map((pack) => pack.catalogue.name)).toEqual(packs.map((pack) => pack.catalogue.name));
    });
  }

  it("never purges an edition stored under its own folder's name, whatever the case and spacing", () => {
    const [pack] = loadUnlocked(memory(golden.cases["3_KPDH Partial Foil Edition"]!.stored));
    for (const name of ["KPDH Partial Foil Edition", "3_Nier Partial Foil Edition", "  nier   partial foil EDITION ", "Partial Foil Edition", "PDF Partial Foil", "Partial Foil Maps"]) {
      expect(isPartialFoilMapName(name)).toBe(false);
      const renamed = { ...pack!, catalogue: { ...pack!.catalogue, name } };
      expect(purgeMapUnlocks([renamed]).dropped).toBe(0);
    }
  });
});
