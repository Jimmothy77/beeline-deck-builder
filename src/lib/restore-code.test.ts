import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allPartialFoilPacks, SHIPPED_DECK_IDS } from "@/lib/fixtures/all-pf-packs";
import { CODE_CHECK_FAILED, codeTooBigMessage, makeRestoreCode, MAX_CODE_CHARS, MAX_JSON_BYTES, MAX_STAMP_AHEAD_MS, mergeRestored, readRestoreCode, RESTORE_ERRORS, RESTORE_PREFIX, restoredMessage, TOO_BIG } from "@/lib/restore-code";
import { catalogueStamp, packForStorage, packHash, parseUnlocked, sha256Hex, upsertUnlocked, type UnlockedPack } from "@/lib/storage";
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
    expect(restoredMessage(0, 0, 1)).toBe("Your restore code matched 1 unlocked folder already on this device. 1 deck list here was as new or newer, so it was kept.");
    expect(restoredMessage(0, 1, 2)).toBe("Your restore code matched 3 unlocked folders already on this device. 1 deck list was updated. 2 deck lists here were as new or newer, so they were kept.");
    expect(restoredMessage(1, 0, 1)).toBe("Restored 1 unlocked folder on this device. 1 deck list here was as new or newer, so it was kept.");
  });
});

describe("restore code size limits", () => {
  const codeFor = (bytes: Uint8Array, check = "0badc0de") => `BEELINE-RESTORE-1.z${Buffer.from(bytes).toString("base64url")}.${check}`;

  it("refuses a deflate bomb while inflating, before the checksum, without inflating all of it", async () => {
    // 64 MB of zeros deflates to about 64 KB: small enough to paste, far too big to inflate.
    const bomb = deflateRawSync(Buffer.alloc(64 * 1024 * 1024));
    const code = codeFor(bomb);
    expect(code.length).toBeLessThan(MAX_CODE_CHARS);
    const started = performance.now();
    expect(await fails(code)).toBe(TOO_BIG);
    expect(performance.now() - started).toBeLessThan(5000);
    // Even with a right checksum it is refused for its size, not read.
    const json = Buffer.alloc(64 * 1024 * 1024, 0x20).toString("utf8");
    expect(await fails(codeFor(deflateRawSync(Buffer.from(json)), sha256Hex(" ").slice(0, 8)))).toBe(TOO_BIG);
  });

  it("stops just past the inflate limit and still reads a payload under it", async () => {
    const make = (value: string) => codeFor(deflateRawSync(Buffer.from(value)), sha256Hex(value).slice(0, 8));
    const body = JSON.stringify({ kind: "beeline-unlocks", version: 1, packs: [packForStorage(A)] });
    const padded = body + " ".repeat(MAX_JSON_BYTES - Buffer.byteLength(body));
    expect(Buffer.byteLength(padded)).toBe(MAX_JSON_BYTES);
    expect(await readRestoreCode(make(padded))).toEqual([A]);
    expect(await fails(make(padded + " "))).toBe(TOO_BIG);
  });

  it("refuses a pasted code over the length limit before decoding it", async () => {
    const huge = "BEELINE-RESTORE-1.j" + "A".repeat(MAX_CODE_CHARS) + ".00000000";
    expect(await fails(huge)).toBe(TOO_BIG);
    expect(await fails(" \n".repeat(MAX_CODE_CHARS + 1))).toBe(TOO_BIG);
    // Just under the limit is decoded as usual (and here fails its checksum, not its size).
    const under = "BEELINE-RESTORE-1.j" + "A".repeat(MAX_CODE_CHARS - 40) + ".00000000";
    expect(await fails(under)).toBe(RESTORE_ERRORS.damaged);
  });
});

describe("restoring never rolls a deck list back", () => {
  const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const renamed = (base: UnlockedPack, name: string, stamps: Partial<UnlockedPack>): UnlockedPack => ({ ...base, ...stamps, catalogue: { ...base.catalogue, name } });

  it("keeps the catalogue here when the code's copy is older or the same age", () => {
    const here = renamed(A, "Here", { savedAt: at(1), refreshedAt: at(10) });
    for (const stamp of [at(5), at(10)]) {
      const result = mergeRestored([here], [renamed(A, "Older code", { savedAt: at(1), refreshedAt: stamp })]);
      expect(result).toMatchObject({ added: 0, refreshed: 0, kept: 1 });
      expect(result.packs).toEqual([here]);
    }
  });

  it("replaces it when the code's copy was read later, keeping its place and first unlock time", () => {
    const here = renamed(A, "Here", { savedAt: at(1), refreshedAt: at(3) });
    const result = mergeRestored([here, B], [renamed(A, "Newer code", { savedAt: at(2), refreshedAt: at(9) })]);
    expect(result).toMatchObject({ added: 0, refreshed: 1, kept: 0 });
    expect(result.packs.map((item) => item.packHash)).toEqual([A.packHash, B.packHash]);
    expect(result.packs[0]!.catalogue.name).toBe("Newer code");
    expect(result.packs[0]!.savedAt).toBe(at(1));
    expect(result.packs[0]!.refreshedAt).toBe(at(9));
  });

  it("an older code that lacks some folders never removes them or reorders the list", () => {
    const C = pack("tmnt", 3);
    const current = [renamed(A, "A here", { refreshedAt: at(8) }), B, C];
    const result = mergeRestored(current, [renamed(A, "A old", { refreshedAt: at(4) })]);
    expect(result.packs).toEqual(current);
    expect(mergeRestored(current, []).packs).toEqual(current);
  });

  it("falls back to the first unlock time for saves made before refresh times were kept", () => {
    expect(catalogueStamp({ savedAt: at(4) })).toBe(Date.parse(at(4)));
    expect(catalogueStamp({ savedAt: at(4), refreshedAt: at(6) })).toBe(Date.parse(at(6)));
    expect(catalogueStamp({ savedAt: "not a date" })).toBe(0);
    const old = renamed(A, "Old save", { savedAt: at(4) });
    expect(mergeRestored([old], [renamed(A, "Old code", { savedAt: at(3) })]).kept).toBe(1);
    expect(mergeRestored([old], [renamed(A, "New code", { savedAt: at(4), refreshedAt: at(5) })]).refreshed).toBe(1);
  });

  it("carries the refresh time through storage and the code; a fresh paste always replaces and stamps it", async () => {
    const stamped = renamed(A, "Stamped", { refreshedAt: at(7) });
    expect(parseUnlocked(JSON.parse(JSON.stringify(packForStorage(stamped))))!.refreshedAt).toBe(at(7));
    expect((await readRestoreCode(await makeRestoreCode([stamped])))[0]!.refreshedAt).toBe(at(7));
    expect(parseUnlocked({ ...packForStorage(stamped), refreshedAt: "soon" })!.refreshedAt).toBeUndefined();
    const pasted = upsertUnlocked([stamped], renamed(A, "Pasted again", { savedAt: at(2), refreshedAt: undefined }));
    expect(pasted[0]!.catalogue.name).toBe("Pasted again");
    expect(pasted[0]!.savedAt).toBe(A.savedAt);
    expect(pasted[0]!.refreshedAt).toBe(at(2));
  });
});

async function makeFails(packs: UnlockedPack[], options?: { compress?: boolean }): Promise<string> {
  try {
    await makeRestoreCode(packs, options);
  } catch (caught) {
    return (caught as Error).message;
  }
  throw new Error("make did not fail");
}

describe("restore code limits fit the codes BeeLine makes (v0.1.37)", () => {
  it("uses 1 MB pasted and 8 MB unpacked", () => {
    expect(MAX_CODE_CHARS).toBe(1024 * 1024);
    expect(MAX_JSON_BYTES).toBe(8 * 1024 * 1024);
  });

  it("every shipped deck unlocked as Partial Foil makes a code that reads back, well under the paste limit", async () => {
    const packs = allPartialFoilPacks();
    expect(packs.map((item) => item.catalogue.id)).toEqual(SHIPPED_DECK_IDS);
    expect(SHIPPED_DECK_IDS).toHaveLength(11);
    for (const item of packs) {
      const [foil, deluxe] = item.catalogue.editions;
      expect(foil!.printType).toBe("partial_foil");
      expect(deluxe!.name).toBe("Deluxe");
      expect(foil!.foilMaps!.found).toBeGreaterThan(0);
    }
    const code = await makeRestoreCode(packs);
    const json = JSON.stringify({ kind: "beeline-unlocks", version: 1, packs: packs.map(packForStorage) });
    console.info(`all-PF restore code: ${code.length} chars (${((code.length / MAX_CODE_CHARS) * 100).toFixed(1)}% of ${MAX_CODE_CHARS}), JSON ${Buffer.byteLength(json)} bytes`);
    expect(code.length).toBeLessThan(0.7 * MAX_CODE_CHARS);
    expect(code.length).toBeGreaterThan(0.5 * MAX_CODE_CHARS);
    const back = await readRestoreCode(code);
    expect(back.map((item) => JSON.stringify(packForStorage(item)))).toEqual(packs.map((item) => JSON.stringify(packForStorage(item))));
    // Right after an unlock a pack also holds its Deluxe Standard-print list; a restore drops it, so the code leaves it out.
    const fresh = allPartialFoilPacks({ withSourceFiles: true });
    expect(fresh[0]!.catalogue.editions[1]!.sourceFiles?.length).toBeGreaterThan(0);
    expect(await makeRestoreCode(fresh)).toBe(code);
  });

  it("refuses to make a code a restore would refuse, with a message saying why", async () => {
    // Two buyers' worth of Partial Foil unlocks: over 1 MB even compressed.
    const many = [...allPartialFoilPacks(), ...allPartialFoilPacks({ seed: 38 })];
    const message = await makeFails(many);
    expect(message).toMatch(/^There are too many unlocked folders on this device for one restore code: it would be [\d,]+ KB, and BeeLine reads codes up to 1,024 KB\. No code was made\./);
    // The size given is the code's own, rounded up to whole KB: about twice the 611 KB of one set.
    const size = Number(/it would be ([\d,]+) KB/.exec(message)![1]!.replace(/,/g, ""));
    expect(size).toBeGreaterThan(1100);
    expect(size).toBeLessThan(1400);
    expect(codeTooBigMessage(1024 * 1024 + 1)).toMatch(/it would be 1,025 KB/);
    // Without compression (older browsers) the same unlocks are far over: refused, never shown.
    expect(await makeFails(allPartialFoilPacks(), { compress: false })).toMatch(/^There are too many unlocked folders/);
    // Over the unpacked limit, even though it would compress small.
    const padded = { ...A, catalogue: { ...A.catalogue, editions: [{ ...A.catalogue.editions[0]!, notes: [{ level: "info" as const, name: "pad", path: "", reason: "x".repeat(MAX_JSON_BYTES) }] }] } };
    const json = JSON.stringify({ kind: "beeline-unlocks", version: 1, packs: [packForStorage(parseUnlocked(JSON.parse(JSON.stringify(packForStorage(padded))))!)] });
    expect(await makeFails([padded])).toBe(codeTooBigMessage(Buffer.byteLength(json), MAX_JSON_BYTES));
    expect(codeTooBigMessage(Buffer.byteLength(json), MAX_JSON_BYTES)).toMatch(/reads codes up to 8,192 KB/);
    // Nothing in the packs that a restore could read.
    expect(await makeFails([{ ...A, catalogue: { ...A.catalogue, editions: [] } }])).toBe(CODE_CHECK_FAILED);
  });

  it("refuses to show a code that doesn't read back, such as one from a broken compressor", async () => {
    const real = globalThis.CompressionStream;
    // A "compressor" that passes the bytes through unchanged: the code says deflate but holds plain JSON.
    class Passthrough extends TransformStream<Uint8Array, Uint8Array> {
      constructor() {
        super();
      }
    }
    globalThis.CompressionStream = Passthrough as unknown as typeof CompressionStream;
    try {
      expect(await makeFails([A])).toBe(CODE_CHECK_FAILED);
    } finally {
      globalThis.CompressionStream = real;
    }
    expect(await makeRestoreCode([A])).toMatch(/^BEELINE-RESTORE-1\.z/);
  });

  it("each code it does make is under the limit and reads back to the same packs", async () => {
    for (const count of [1, 6, 11]) {
      const packs = allPartialFoilPacks().slice(0, count);
      const code = await makeRestoreCode(packs);
      expect(code.length).toBeLessThanOrEqual(MAX_CODE_CHARS);
      expect((await readRestoreCode(code)).length).toBe(count);
    }
  });
});

describe("a code's stamps and empty deck lists (v0.1.37)", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const emptied = (base: UnlockedPack, stamps: Partial<UnlockedPack>): UnlockedPack => ({ ...base, ...stamps, catalogue: { ...base.catalogue, editions: base.catalogue.editions.map((edition) => ({ ...edition, cards: [] })) } });
  const renamed = (base: UnlockedPack, name: string, stamps: Partial<UnlockedPack>): UnlockedPack => ({ ...base, ...stamps, catalogue: { ...base.catalogue, name } });

  it("never lets a deck list with no cards replace one here, however new its stamp", async () => {
    const here = renamed(A, "Here", { savedAt: at(1), refreshedAt: at(10) });
    const future = emptied(A, { savedAt: at(1), refreshedAt: "9999-12-31T00:00:00.000Z" });
    // Through a real code, as the diff check did it.
    const incoming = await readRestoreCode(await makeRestoreCode([future]));
    const result = mergeRestored([here], incoming, now);
    expect(result).toMatchObject({ added: 0, refreshed: 0, kept: 0, empty: 1 });
    expect(result.packs).toEqual([here]);
    expect(result.packs[0]!.catalogue.editions[0]!.cards.length).toBeGreaterThan(0);
    // Even with an ordinary newer stamp.
    expect(mergeRestored([here], [emptied(A, { refreshedAt: at(11) })], now).empty).toBe(1);
    expect(restoredMessage(0, 0, 0, 1)).toBe("Your restore code matched 1 unlocked folder already on this device. 1 folder in the code had no cards, so its deck list here was kept.");
    expect(restoredMessage(1, 0, 0, 2)).toBe("Restored 1 unlocked folder on this device. 2 folders in the code had no cards, so their deck lists here were kept.");
  });

  it("counts a stamp later than this device's clock plus a day as that, so it can't win forever", () => {
    const DAY = 24 * 60 * 60 * 1000;
    expect(MAX_STAMP_AHEAD_MS).toBe(DAY);
    const cap = new Date(now + DAY).toISOString();
    const here = renamed(A, "Here", { savedAt: at(1), refreshedAt: at(10) });
    const future = renamed(A, "Year 9999", { savedAt: at(1), refreshedAt: "9999-12-31T00:00:00.000Z" });
    const first = mergeRestored([here], [future], now);
    expect(first.refreshed).toBe(1);
    expect(first.packs[0]!.catalogue.name).toBe("Year 9999");
    expect(first.packs[0]!.refreshedAt).toBe(cap);
    // A real later read (two days on) now replaces it; before the cap the year-9999 copy kept winning.
    const later = renamed(A, "Read later", { savedAt: at(1), refreshedAt: new Date(now + 2 * DAY).toISOString() });
    const second = mergeRestored(first.packs, [later], now + 2 * DAY);
    expect(second.refreshed).toBe(1);
    expect(second.packs[0]!.catalogue.name).toBe("Read later");
    // A far-future code is no newer than one stamped at the cap.
    expect(mergeRestored([renamed(A, "At cap", { refreshedAt: cap })], [future], now).kept).toBe(1);
    // Within a day ahead (clock skew) is taken as given.
    const skew = new Date(now + DAY - 1000).toISOString();
    expect(mergeRestored([here], [renamed(A, "Skewed", { refreshedAt: skew })], now).packs[0]!.refreshedAt).toBe(skew);
    // A new pack with a future first-unlock time is capped too, with no refresh time of its own.
    const added = mergeRestored([], [{ ...B, savedAt: "9999-01-01T00:00:00.000Z", refreshedAt: undefined }], now).packs[0]!;
    expect(added.savedAt).toBe(cap);
    expect(added.refreshedAt).toBe(cap);
  });
});
