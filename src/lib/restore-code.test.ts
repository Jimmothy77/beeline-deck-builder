import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeRestoreCode, mergeRestored, readRestoreCode, RESTORE_ERRORS, RESTORE_PREFIX, restoredMessage } from "@/lib/restore-code";
import { packHash, parseUnlocked, sha256Hex, type UnlockedPack } from "@/lib/storage";
import type { DeckCatalogue } from "@/lib/types";

// Fixtures: public Standard catalogues relabelled, and folder ids made up at run time. No paid id is in this file.
const root = path.resolve(import.meta.dirname, "../..");
const deck = (id: string) => JSON.parse(readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8")) as DeckCatalogue;
const fakeFolder = (n: number) => ["fake", "folder", String(n)].join("-");
function pack(id: string, n: number, savedAt = "2026-11-0" + n + "T00:00:00.000Z"): UnlockedPack {
  const catalogue = deck(id);
  return parseUnlocked({ packHash: packHash(fakeFolder(n)), savedAt, catalogue: { ...catalogue, editions: catalogue.editions.map((e) => ({ ...e, name: "Deluxe" })) } })!;
}
const A = pack("tmnt", 1);
const B = pack("x-men", 2);

async function fails(code: string): Promise<string> {
  try {
    await readRestoreCode(code);
  } catch (caught) {
    return (caught as Error).message;
  }
  throw new Error("read did not fail");
}

describe("restore code", () => {
  it("round-trips the stored packs, compressed and plain", async () => {
    for (const compress of [true, false]) {
      const code = await makeRestoreCode([A, B], { compress });
      expect(code.startsWith(`${RESTORE_PREFIX}1.${compress ? "z" : "j"}`)).toBe(true);
      expect(code).toMatch(/^BEELINE-RESTORE-1\.[zj][A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
      expect(await readRestoreCode(code)).toEqual([A, B]);
    }
  });

  it("compresses: the code is much shorter than the deck lists it carries", async () => {
    const plain = await makeRestoreCode([A], { compress: false });
    const small = await makeRestoreCode([A]);
    expect(small.length * 3).toBeLessThan(plain.length);
  });

  it("never carries a folder id, even when the pack in memory has one", async () => {
    const withFolder: UnlockedPack = { ...A, folderId: fakeFolder(1) };
    const code = await makeRestoreCode([withFolder], { compress: false });
    const json = Buffer.from(code.split(".")[1]!.slice(1), "base64url").toString("utf8");
    expect(json).not.toContain(fakeFolder(1));
    expect(json).not.toMatch(/folderId|sourceUrl/);
    expect(JSON.parse(json)).toMatchObject({ kind: "beeline-unlocks", version: 1 });
    expect((await readRestoreCode(code))[0]!.folderId).toBeUndefined();
  });

  it("ignores spaces and line breaks from wrapped text", async () => {
    const code = await makeRestoreCode([A]);
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 60)} \r\n\t${code.slice(60)}  `;
    expect(await readRestoreCode(wrapped)).toEqual([A]);
  });

  it("fails with a clear message for empty, foreign, newer, cut-off, or edited codes", async () => {
    const code = await makeRestoreCode([A]);
    expect(await fails("")).toBe(RESTORE_ERRORS.empty);
    expect(await fails("   \n ")).toBe(RESTORE_ERRORS.empty);
    expect(await fails("https://drive.google.com/drive/folders/abc")).toBe(RESTORE_ERRORS.notCode);
    expect(await fails(code.replace("BEELINE-RESTORE-1.", "BEELINE-RESTORE-2."))).toBe(RESTORE_ERRORS.newer);
    expect(await fails(code.replace("BEELINE-RESTORE-1.", "BEELINE-RESTORE-0."))).toBe(RESTORE_ERRORS.notCode);
    expect(await fails(code.slice(0, -12))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(code.slice(0, code.length - 20) + code.slice(code.length - 9))).toBe(RESTORE_ERRORS.damaged);
    const body = code.split(".")[1]!;
    const flipped = body.slice(0, 40) + (body[40] === "A" ? "B" : "A") + body.slice(41);
    expect(await fails(code.replace(body, flipped))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(code.replace(/\.[0-9a-f]{8}$/, ".00000000"))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(code.replace(/\.[0-9a-f]{8}$/, ""))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(code.replace(".z", ".q"))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(code.replace(".z", ".z!"))).toBe(RESTORE_ERRORS.damaged);
  });

  it("checks the payload, not just the checksum", async () => {
    const make = (value: unknown) => {
      const json = JSON.stringify(value);
      return `BEELINE-RESTORE-1.j${Buffer.from(json).toString("base64url")}.${sha256Hex(json).slice(0, 8)}`;
    };
    expect(await readRestoreCode(make({ kind: "beeline-unlocks", version: 1, packs: [{ packHash: A.packHash, savedAt: A.savedAt, catalogue: A.catalogue }] }))).toEqual([A]);
    expect(await fails(make({ kind: "printabee-saved-decks", version: 1, packs: [] }))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(make({ kind: "beeline-unlocks", version: 1 }))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(make([1, 2]))).toBe(RESTORE_ERRORS.damaged);
    expect(await fails(make({ kind: "beeline-unlocks", version: 1, packs: [{ packHash: "nothex", catalogue: {} }] }))).toBe(RESTORE_ERRORS.noPacks);
    const notJson = "{not json";
    expect(await fails(`BEELINE-RESTORE-1.j${Buffer.from(notJson).toString("base64url")}.${sha256Hex(notJson).slice(0, 8)}`)).toBe(RESTORE_ERRORS.damaged);
  });

  it("has nothing to make when nothing is unlocked", async () => {
    await expect(makeRestoreCode([])).rejects.toThrow(RESTORE_ERRORS.nothing);
  });

  it("merges into the unlocks already here: new packs go last, known ones keep their place and first unlock time", () => {
    const newerA = { ...A, savedAt: "2026-12-01T00:00:00.000Z" };
    const result = mergeRestored([A], [B, newerA]);
    expect(result.added).toBe(1);
    expect(result.refreshed).toBe(1);
    expect(result.packs.map((item) => item.packHash)).toEqual([A.packHash, B.packHash]);
    expect(result.packs[0]!.savedAt).toBe(A.savedAt);
    expect(mergeRestored([], [A, B])).toMatchObject({ added: 2, refreshed: 0 });
  });

  it("says what changed", () => {
    expect(restoredMessage(1, 0)).toBe("Restored 1 unlocked folder on this device.");
    expect(restoredMessage(2, 1)).toBe("Restored 2 unlocked folders on this device, and updated 1 already here.");
    expect(restoredMessage(0, 1)).toBe("Your restore code matched 1 unlocked folder already on this device. Their deck lists were updated.");
    expect(restoredMessage(0, 3)).toBe("Your restore code matched 3 unlocked folders already on this device. Their deck lists were updated.");
  });
});
