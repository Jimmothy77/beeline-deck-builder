import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateRawSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogueFromTree } from "@/lib/group";
import { slug } from "@/lib/names";
import { PRIVATE_IDS_FILE, SCAN_CHUNK, classifyDriveId, driveIdsIn, hasDeniedWindow, loadIdLines, loadPrivateDenyHashes, scanForForeignDriveIds, sha256 } from "@/lib/public-ids";
import type { RawNode } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const id33 = `1${"a".repeat(32)}`;
const id28 = `0B${"b".repeat(26)}`;
const id44 = `1${"c".repeat(43)}`;

/** The local Art Picker archive holds upstream Drive file ids. Leave the file where the user put it. */
function scanRepo(allowed: Set<string>, denied: Set<string>, extra: string[] = []) {
  return scanForForeignDriveIds(root, allowed, denied, extra, {
    exclude: (relative) => ["uploads/MPC_Art_Picker_v2.7.2_00a4.zip", PRIVATE_IDS_FILE].includes(relative.split(path.sep).join("/")),
  });
}

describe("drive id matching", () => {
  it("does not treat a numbered card face filename as a drive id", () => {
    const face = ["3", "1", "Decklist_Legends"].join("_");
    expect(driveIdsIn(`{"name":"${face}"}`)).not.toContain(face);
    expect(driveIdsIn(`${face}.jpg`)).not.toContain(face);
    expect(driveIdsIn(`loose ${face} end`)).toContain(face);
    const secret = `1${"A".repeat(8)}${"b".repeat(23)}1`;
    expect(driveIdsIn(`note ${secret} note`)).toContain(secret);
  });

  it("reads folder links, id= query params, 0B ids, and 44-character ids", () => {
    const text = [
      `https://drive.google.com/drive/folders/${id33}?usp=sharing`,
      `https://drive.google.com/open?id=${id28}`,
      `https://drive.google.com/file/d/${id44}/view`,
      `id=${id33}`,
    ].join("\n");
    const found = driveIdsIn(text);
    expect(found).toContain(id33);
    expect(found).toContain(id28);
    expect(found).toContain(id44);
    const bare = `1Aa${"bB".repeat(15)}`;
    expect(driveIdsIn(`The file is ${bare} in the note.`)).toContain(bare);
    expect(driveIdsIn(`(${bare})`)).toContain(bare);
    expect(driveIdsIn(`https://docs.google.com/document/d/${bare}/edit`)).toContain(bare);
    expect(driveIdsIn(`note ${id33} end`)).toContain(id33);
    expect(driveIdsIn(`folders/${id33}-copy`)).toEqual([id33]);
    expect(driveIdsIn(`key=${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`key=${id33}-copy`)).toEqual([id33]);
    expect(driveIdsIn(`${id33}-copy-of-file`)).toEqual([id33]);
    expect(driveIdsIn(`resourcekey=${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`folder=${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`q=${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`a_very_long_print_prefix_${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`a_very_long_print_prefix_${id33}-copy-of-file`)).toEqual([id33]);
    expect(driveIdsIn(`https://drive.google.com/uc/${id33}/view`)).toContain(id33);
    expect(driveIdsIn(`+${id33}`)).toEqual([id33]);
    expect(driveIdsIn(`${id33}-copy-of-report`)).toEqual([id33]);
    const denyHashes = [
      "5a4b8f5c075343e864061727c3218627671a7a733b70838d3d137f1c55916ba6",
      "e2dcbb575cd2351231396f83286c3f45a5535db5e911481ef36edde6e78f488c",
    ];
    expect(driveIdsIn(denyHashes.join("\n"))).toEqual([]);
    expect(driveIdsIn(`key=${denyHashes[0]}`)).toEqual([]);
    expect(driveIdsIn(`resourcekey=${denyHashes[0]}`)).toEqual([]);
    expect(driveIdsIn(`folder=${denyHashes[1]}`)).toEqual([]);
    expect(driveIdsIn(`q=${denyHashes[1]}`)).toEqual([]);
    expect(driveIdsIn(`a_very_long_print_prefix_${denyHashes[0]}`)).toEqual([]);
    expect(driveIdsIn(`${denyHashes[0]}-copy-of-file`)).toEqual([]);
    expect(driveIdsIn(`/${denyHashes[0]}/`)).toEqual([]);
    expect(driveIdsIn(`+${denyHashes[0]}`)).toEqual([]);
    expect(driveIdsIn(`${denyHashes[1]}-copy-of-report`)).toEqual([]);
    expect(driveIdsIn("sha512-/Foi8vKY2EVbed/1eZx0gJEEwHAIxogrySI7rULcRIvhZzbvoE/b5qG5Ghc0WKAFKOHA9SD1x7RsFlOYdutIiQ==")).toEqual([]);
    expect(driveIdsIn(`sha512-x/drive/folders/${id33}`)).toContain(id33);
    expect(driveIdsIn(`"integrity":"sha512-AAAA","url":"https://drive.google.com/drive/folders/${id33}"`)).toContain(id33);
    expect(driveIdsIn(`var a="sha512-",b="https://drive.google.com/drive/folders/${id33}";`)).toContain(id33);
    const b64 = "A".repeat(86);
    expect(driveIdsIn(`sha512-${b64}==${id33}`)).toContain(id33);
    expect(driveIdsIn(`==/${id33}`)).toContain(id33);
    expect(driveIdsIn(`sha512-/${id33}`)).toContain(id33);
    expect(driveIdsIn(`SHA512-AAAA/${id33}`)).toContain(id33);
    expect(driveIdsIn(`/sha256-AAAA/${id33}`)).toContain(id33);
    expect(hasDeniedWindow(`sha512-${b64}==${id33}`, new Set([sha256(id33)]))).toBe(true);
    expect(hasDeniedWindow("no folder id in this sentence", new Set([sha256(id33)]))).toBe(false);
    const hidden = `1${"f".repeat(32)}`;
    const body = (length: number, id: string) => {
      const head = `/${id}/`;
      return `${head}${"B".repeat(length - head.length)}`;
    };
    expect(driveIdsIn(`sha512-${body(86, hidden)}!`)).not.toContain(hidden);
    expect(driveIdsIn("SHA512-" + body(86, hidden) + "!")).not.toContain(hidden);
    expect(driveIdsIn(`bundle-${body(86, hidden)}!`)).toContain(hidden);
    expect(driveIdsIn(`sha512-${body(42, id33)}!`)).toContain(id33);
    expect(driveIdsIn(`sha512-${body(87, id33)}!`)).toContain(id33);
  });

  it("flags a glued paid id when scanning a file", () => {
    const secret = `1${"e".repeat(32)}`;
    const dir = mkdtempSync(path.join(root, ".printabee-id-scan-"));
    try {
      writeFileSync(path.join(dir, "glued.txt"), `prefix${secret}suffix`);
      const hits = scanForForeignDriveIds(dir, new Set(), new Set([sha256(secret)]));
      expect(hits.some((line) => line.includes("matches a paid folder id"))).toBe(true);
      expect(hits.join("\n")).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans a paid id hidden in a gitignored path", () => {
    const secret = `1${"g".repeat(32)}`;
    const file = path.join(root, "uploads", "paid-probe.txt");
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      writeFileSync(file, `prefix${secret}suffix`);
      const allowed = loadIdLines(path.join(root, "src/lib/drive-allow-list.txt"));
      const denied = loadIdLines(path.join(root, "src/lib/drive-deny-list.txt"));
      denied.add(sha256(secret));
      const hits = scanRepo(allowed, denied);
      const probe = hits.filter((line) => line.includes("uploads/paid-probe.txt"));
      expect(probe.some((line) => line.includes("matches a paid folder id"))).toBe(true);
      expect(probe.join("\n")).not.toContain(secret);
      expect(hits.filter((line) => !line.includes("uploads/paid-probe.txt"))).toEqual([]);
    } finally {
      rmSync(file, { force: true });
      try {
        rmdirSync(path.dirname(file));
      } catch {
        // uploads/ still holds other ignored files.
      }
    }
  });

  it("reports paid ids in binary files, zip entries, utf-16, large files, and nested dist folders", () => {
    const secret = `1${"h".repeat(32)}`;
    const allowed = loadIdLines(path.join(root, "src/lib/drive-allow-list.txt"));
    const denied = loadIdLines(path.join(root, "src/lib/drive-deny-list.txt"));
    denied.add(sha256(secret));
    const png = path.join(root, "public", "paid-text.png");
    const stored = path.join(root, "public", "paid-stored.zip");
    const deflated = path.join(root, "public", "paid-deflated.zip");
    const pdf = path.join(root, "public", "paid-zero.pdf");
    const utf16 = path.join(root, "public", "paid-utf16.txt");
    const stray = path.join(root, "public", "paid-stray.txt");
    const large = path.join(root, "public", "paid-large.bin");
    const nestedPublic = path.join(root, "public", "dist", "tracked.txt");
    const nestedSrc = path.join(root, "src", "dist", "tracked.txt");
    const distPng = path.join(root, "dist", "paid-text.png");
    const distStored = path.join(root, "dist", "paid-stored.zip");
    const distDeflated = path.join(root, "dist", "paid-deflated.zip");
    const distNested = path.join(root, "dist", "dist", "tracked.txt");
    const made = [png, stored, deflated, pdf, utf16, stray, large, nestedPublic, nestedSrc, distPng, distStored, distDeflated, distNested];
    const payload = Buffer.from(`note ${secret}\n`);
    try {
      mkdirSync(path.dirname(nestedPublic), { recursive: true });
      mkdirSync(path.dirname(nestedSrc), { recursive: true });
      mkdirSync(path.dirname(distNested), { recursive: true });
      writeFileSync(png, pngWithText(secret));
      writeFileSync(stored, zipWith("card.txt", payload, 0));
      writeFileSync(deflated, zipWith("card.txt", payload, 8));
      writeFileSync(pdf, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(secret), Buffer.from([0]), Buffer.from("\n%%EOF\n")]));
      writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(secret, "utf16le")]));
      writeFileSync(stray, Buffer.concat([Buffer.from("keep"), Buffer.from([0]), Buffer.from(secret)]));
      const big = Buffer.alloc(5_242_880 + 64, 0x41);
      Buffer.from(secret).copy(big, 5_242_870);
      writeFileSync(large, big);
      writeFileSync(nestedPublic, `prefix${secret}suffix`);
      writeFileSync(nestedSrc, `prefix${secret}suffix`);
      copyFileSync(png, distPng);
      copyFileSync(stored, distStored);
      copyFileSync(deflated, distDeflated);
      writeFileSync(distNested, `prefix${secret}suffix`);
      const hits = scanRepo(allowed, denied, [path.join(root, "dist")]);
      const flagged = (rel: string) => hits.some((line) => line.replaceAll("\\", "/").includes(rel) && line.includes("matches a paid folder id"));
      expect(flagged("public/paid-text.png")).toBe(true);
      expect(flagged("public/paid-stored.zip")).toBe(true);
      expect(flagged("public/paid-deflated.zip")).toBe(true);
      expect(flagged("dist/paid-text.png")).toBe(true);
      expect(flagged("dist/paid-stored.zip")).toBe(true);
      expect(flagged("dist/paid-deflated.zip")).toBe(true);
      expect(flagged("public/paid-zero.pdf")).toBe(true);
      expect(flagged("public/paid-utf16.txt")).toBe(true);
      expect(flagged("public/paid-stray.txt")).toBe(true);
      expect(flagged("public/paid-large.bin")).toBe(true);
      expect(flagged("public/dist/tracked.txt")).toBe(true);
      expect(flagged("src/dist/tracked.txt")).toBe(true);
      expect(flagged("dist/dist/tracked.txt")).toBe(true);
      expect(hits.join("\n")).not.toContain(secret);
    } finally {
      for (const file of made) rmSync(file, { force: true });
      for (const dir of [path.dirname(nestedPublic), path.dirname(nestedSrc), path.dirname(distNested)]) {
        try {
          rmdirSync(dir);
        } catch {
          // The directory still has other files.
        }
      }
    }
  }, 120_000);

  it("does not follow a symlink to an endless device", () => {
    const linkDir = path.join(root, "uploads", "links");
    const link = path.join(linkDir, "zero");
    mkdirSync(linkDir, { recursive: true });
    try {
      symlinkSync("/dev/zero", link);
      const hits = scanForForeignDriveIds(root, new Set(), new Set());
      expect(hits.some((line) => line.includes("uploads/links/zero"))).toBe(false);
    } finally {
      rmSync(link, { force: true });
      try {
        rmdirSync(linkDir);
      } catch {
        // Leave the directory if it is not empty.
      }
      try {
        rmdirSync(path.join(root, "uploads"));
      } catch {
        // uploads/ still holds other ignored files.
      }
    }
  }, 20_000);

  it("flags a paid-folder hash without putting the id on the allow-list", () => {
    expect(classifyDriveId(id33, new Set<string>(), new Set([sha256(id33)]))).toBe("denied");
    expect(classifyDriveId(id33, new Set([id33]), new Set([sha256(id33)]))).toBe("denied");
  });
});

function pngWithText(secret: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  const text = Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.from(secret)]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("tEXt", text), chunk("IEND", Buffer.alloc(0))]);
}

function zipWith(name: string, data: Buffer, method: 0 | 8): Buffer {
  const payload = method === 8 ? deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([header, nameBuf, payload]);
}

function zipWithDataDescriptor(secret: string): Buffer {
  const data = Buffer.from(`note ${secret}\n`);
  const payload = deflateRawSync(data);
  const name = Buffer.from("card.txt");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x8, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(name.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32(data) >>> 0, 4);
  descriptor.writeUInt32LE(payload.length, 8);
  descriptor.writeUInt32LE(data.length, 12);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x8, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc32(data) >>> 0, 16);
  cd.writeUInt32LE(payload.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  const cdStart = 30 + name.length + payload.length + descriptor.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, name, payload, descriptor, cd, name, eocd]);
}

describe("scanner edges", () => {
  it("reads a data-descriptor zip, a renamed zip, a chunk boundary, and UTF-16 BE", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-scan-"));
    const secret = `1${"j".repeat(32)}`;
    const denied = new Set([sha256(secret)]);
    try {
      writeFileSync(path.join(dir, "descriptor.docx"), zipWithDataDescriptor(secret));
      const big = Buffer.alloc(SCAN_CHUNK + 64, 0x42);
      Buffer.from(secret).copy(big, SCAN_CHUNK - 32);
      writeFileSync(path.join(dir, "boundary.bin"), big);
      const encoded = Buffer.from(secret, "utf16le");
      const be = Buffer.alloc(2 + encoded.length);
      be[0] = 0xfe;
      be[1] = 0xff;
      for (let i = 0; i + 1 < encoded.length; i += 2) {
        be[2 + i] = encoded[i + 1]!;
        be[2 + i + 1] = encoded[i]!;
      }
      writeFileSync(path.join(dir, "be.txt"), be);
      const bare = Buffer.from(`\0${secret}\0`, "utf16le");
      writeFileSync(path.join(dir, "bare-le.txt"), bare);
      const carried = Buffer.alloc(SCAN_CHUNK + Buffer.byteLength(secret, "utf16le"));
      carried[0] = 0xff;
      carried[1] = 0xfe;
      Buffer.from(secret, "utf16le").copy(carried, SCAN_CHUNK);
      writeFileSync(path.join(dir, "carried-utf16.txt"), carried);
      writeFileSync(path.join(dir, "excluded.txt"), secret);
      const hits = scanForForeignDriveIds(dir, new Set(), denied);
      const flagged = (name: string) => hits.some((line) => line.includes(name) && line.includes("matches a paid folder id"));
      expect(flagged("descriptor.docx")).toBe(true);
      expect(flagged("boundary.bin")).toBe(true);
      expect(hits.filter((line) => line.includes("boundary.bin"))).toHaveLength(1);
      expect(flagged("be.txt")).toBe(true);
      expect(flagged("bare-le.txt")).toBe(true);
      expect(flagged("carried-utf16.txt")).toBe(true);
      const hidden = scanForForeignDriveIds(dir, new Set(), denied, [], { exclude: (relative) => relative.endsWith("excluded.txt") || relative.endsWith("carried-utf16.txt") });
      expect(hidden.some((line) => line.includes("excluded.txt"))).toBe(false);
      expect(flagged("excluded.txt")).toBe(true);
      expect(hits.join("\n")).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds an id at the front of a chunk and an id carried in the overlap, once each", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-scan-"));
    const front = `1${"m".repeat(17)}A1`;
    const carried = `1${"n".repeat(17)}B2`;
    const spanning = `1${"p".repeat(17)}C3`;
    const overlap = 256;
    const buf = Buffer.alloc(SCAN_CHUNK + 80, 0);
    Buffer.from(front).copy(buf, 8);
    Buffer.from(carried).copy(buf, SCAN_CHUNK - overlap + 8);
    Buffer.from(spanning).copy(buf, SCAN_CHUNK - 10);
    writeFileSync(path.join(dir, "split.bin"), buf);
    try {
      const hits = scanForForeignDriveIds(dir, new Set(), new Set()).filter((line) => line.includes("split.bin"));
      expect(hits.filter((line) => line.includes(front))).toHaveLength(1);
      expect(hits.filter((line) => line.includes(carried))).toHaveLength(1);
      expect(hits.filter((line) => line.includes(spanning))).toHaveLength(1);
      expect(hits).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not report an id completed only by the overlap back of a non-final chunk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-scan-"));
    const secret = `1${"r".repeat(32)}`;
    const denied = new Set([sha256(secret)]);
    const overlap = 256;
    const buf = Buffer.alloc(SCAN_CHUNK + 64, 0);
    Buffer.from(secret).copy(buf, SCAN_CHUNK - overlap - 1);
    writeFileSync(path.join(dir, "false-back.bin"), buf);
    try {
      const hits = scanForForeignDriveIds(dir, new Set(), denied);
      expect(hits.some((line) => line.includes("false-back.bin"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds a utf-16 id at the front of a chunk and does not keep only the overlap tail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-scan-"));
    const front = `1${"q".repeat(17)}D4`;
    const body = Buffer.alloc(SCAN_CHUNK + 80, 0);
    Buffer.from(front, "utf16le").copy(body, 4);
    const file = Buffer.alloc(2 + body.length);
    file[0] = 0xff;
    file[1] = 0xfe;
    body.copy(file, 2);
    writeFileSync(path.join(dir, "front-utf16.txt"), file);
    try {
      const hits = scanForForeignDriveIds(dir, new Set(), new Set()).filter((line) => line.includes("front-utf16.txt"));
      expect(hits.filter((line) => line.includes(front))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports an unreadable file instead of throwing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-scan-"));
    const file = path.join(dir, "locked.txt");
    writeFileSync(file, "hello");
    chmodSync(file, 0);
    try {
      const hits = scanForForeignDriveIds(dir, new Set(), new Set());
      if (typeof process.getuid === "function" && process.getuid() !== 0) {
        expect(hits.some((line) => line.includes("unreadable"))).toBe(true);
      } else {
        expect(Array.isArray(hits)).toBe(true);
      }
    } finally {
      chmodSync(file, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans an ignored file in a clean archive and does not follow a symlink", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "printabee-archive-"));
    const outside = mkdtempSync(path.join(tmpdir(), "printabee-outside-"));
    const ignoredSecret = `1${"k".repeat(32)}`;
    const linkedSecret = `1${"w".repeat(32)}`;
    try {
      writeFileSync(path.join(dir, "README.md"), "BeeLine\n");
      execSync("git init", { cwd: dir, stdio: "ignore" });
      execSync("git config user.email test@example.com && git config user.name Test", { cwd: dir, stdio: "ignore" });
      writeFileSync(path.join(dir, ".gitignore"), "secret-ignored.txt\n");
      writeFileSync(path.join(dir, "kept.txt"), "hello\n");
      execSync("git add .gitignore kept.txt README.md && git commit -m init", { cwd: dir, stdio: "ignore" });
      writeFileSync(path.join(dir, "secret-ignored.txt"), ignoredSecret);
      writeFileSync(path.join(outside, "secret.txt"), linkedSecret);
      symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "linked.txt"));
      execSync("git add linked.txt", { cwd: dir, stdio: "ignore" });
      const hits = scanForForeignDriveIds(dir, new Set(), new Set([sha256(ignoredSecret), sha256(linkedSecret)]));
      expect(hits.some((line) => line.includes("secret-ignored.txt"))).toBe(true);
      expect(hits.some((line) => line.includes("linked.txt") || line.includes(linkedSecret))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("public drive id allow-list", () => {
  it("rejects any drive id in the repo or dist that is not allow-listed or is a paid folder", () => {
    execSync("npx vite build", { cwd: root, stdio: "pipe", timeout: 60_000 });
    const allowed = loadIdLines(path.join(root, "src/lib/drive-allow-list.txt"));
    const denied = loadIdLines(path.join(root, "src/lib/drive-deny-list.txt"));
    expect(allowed.size).toBeGreaterThan(200);
    expect(denied.size).toBeGreaterThan(0);
    // Deck parents and the old public root come only from a local, untracked file (BEELINE_PRIVATE_IDS or
    // .beeline-private-ids.txt); without one this checks the committed deny list alone.
    const privateHashes = loadPrivateDenyHashes(root);
    for (const hash of privateHashes) denied.add(hash);
    expect([...allowed].filter((id) => privateHashes.has(sha256(id)))).toHaveLength(0);
    const foreign = scanRepo(allowed, denied, [path.join(root, "dist")]);
    expect(foreign).toEqual([]);
  }, 60_000);

  it("reads the private list as raw ids or hashes, from the env file or the gitignored file, and keeps no id", () => {
    const raw = `1${"p".repeat(32)}`;
    const hashed = `1${"q".repeat(32)}`;
    const dir = mkdtempSync(path.join(tmpdir(), "beeline-private-"));
    try {
      const file = path.join(dir, "ids.txt");
      writeFileSync(file, `# deck parents\n${raw}\n\n${sha256(hashed).toUpperCase()}\n`);
      const hashes = loadPrivateDenyHashes(dir, { BEELINE_PRIVATE_IDS: file });
      expect([...hashes].sort()).toEqual([sha256(raw), sha256(hashed)].sort());
      expect(JSON.stringify([...hashes])).not.toContain(raw);
      expect(loadPrivateDenyHashes(dir, {})).toEqual(new Set());
      writeFileSync(path.join(dir, PRIVATE_IDS_FILE), `${raw}\n`);
      expect(loadPrivateDenyHashes(dir, {})).toEqual(new Set([sha256(raw)]));
      // A private id that turns up in shipped files fails the scan without printing it.
      writeFileSync(path.join(dir, "leak.json"), `{"folder":"${raw}"}`);
      const hits = scanForForeignDriveIds(dir, new Set(), loadPrivateDenyHashes(dir, {}), [], { exclude: (relative) => relative === PRIVATE_IDS_FILE });
      expect(hits.some((line) => line.includes("leak.json") && line.includes("matches a paid folder id"))).toBe(true);
      expect(hits.join("\n")).not.toContain(raw);
      expect(readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/)).toContain(PRIVATE_IDS_FILE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SxF and Floating World default totals", () => {
  const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
  const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });
  const mainNames = (deckFile: string) => {
    const deck = JSON.parse(readFileSync(path.join(root, "public/decks", deckFile), "utf8")) as { editions: { cards: { id: string; name: string; role: string; defaultQty: number }[] }[] };
    return deck.editions[0]!.cards.filter((card) => card.role === "main");
  };
  const total = (cards: { defaultQty: number }[]) => cards.reduce((sum, card) => sum + card.defaultQty, 0);

  it("keeps the shipped standard totals and applies the same totals to deluxe and partial foil", () => {
    // SxF was 149 before v0.1.28: Hydroelectric Laboratory was its own main card until the source named it 1_2_, the back of Hydroelectric Specimen.
    for (const [deckFile, expected] of [
      ["sxf.json", 148],
      ["floating-world.json", 134],
    ] as const) {
      const shipped = mainNames(deckFile);
      expect(total(shipped)).toBe(expected);
      // A double-faced card's folder file is named after its front.
      const names = shipped.map((card) => card.name.split(" // ")[0]!);
      const deluxe = catalogueFromTree(
        folder(`${deckFile}-dx`, `3_${deckFile}`, [
          folder(`${deckFile}-wrap`, "2_Deck Deluxe Edition", [
            folder(`${deckFile}-dpi`, "Deluxe Edition (1200 DPI)", names.map((name, index) => file(`${deckFile}-d${index}`, `${name}.jpg`))),
          ]),
        ]),
      ).editions[0]!;
      const partial = catalogueFromTree(
        folder(`${deckFile}-pf`, "3_Deck Partial Foil Edition", [
          folder(`${deckFile}-pdf`, "PDF Partial Foil Map", [
            folder(`${deckFile}-full`, "Full Deck", names.map((name, index) => file(`${deckFile}-p${index}`, `${name}.pdf`))),
          ]),
        ]),
      ).editions[0]!;
      expect(total(deluxe.cards.filter((card) => card.role === "main"))).toBe(expected);
      expect(total(partial.cards.filter((card) => card.role === "main"))).toBe(expected);
      expect(deluxe.cards.map((card) => card.id)).toEqual(shipped.map((card) => card.id));
      expect(shipped.map((card) => card.id)).toEqual(names.map((name) => `main-${slug(name)}`));
    }
  });
});

describe("shipped double-faced cards", () => {
  it("keeps the real back faces: X-Men 7, KPDH 1, Nier 1, and three Terra backs", () => {
    const deck = (name: string) => JSON.parse(readFileSync(path.join(root, "public/decks", name), "utf8")) as { editions: { name: string; cards: { name: string; faces: { alternates?: unknown[] }[] }[] }[] };
    const faces = (name: string) => deck(name).editions.find((edition) => edition.name === "Standard")!.cards.filter((card) => card.faces.length > 1);
    expect(faces("x-men.json")).toHaveLength(7);
    expect(faces("kpdh.json")).toHaveLength(1);
    expect(faces("nier.json")).toHaveLength(1);
    const terra = faces("persona-5.json").find((card) => card.name.startsWith("Terra, Magical Adept"));
    expect(terra?.faces[1]?.alternates).toHaveLength(3);
  });
});
