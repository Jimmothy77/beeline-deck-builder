import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";

/**
 * Drive ids are 19–44 characters. 0B… ids are the older 28-character form.
 * Match them quoted, in a /id path segment, after +, after any word=, after a prefix_, or with a copy suffix.
 * The captured text may include -copy or -copy-of-<other>; that tail is removed before the length check.
 */
const DRIVE_BODY = "(?:0B[A-Za-z0-9_-]{17,80}|1[A-Za-z0-9_-]{18,80})";
const COPY_SUFFIX = "(?:-[Cc]opy(?:-of-[A-Za-z0-9_-]+)?)?";
const ID_END = `${COPY_SUFFIX}(?![A-Za-z0-9_-])`;
const DRIVE_PATTERNS = [
  new RegExp(`folders/(${DRIVE_BODY})${ID_END}`, "gi"),
  new RegExp(`/d/(${DRIVE_BODY})${ID_END}`, "g"),
  new RegExp(`(?<![A-Za-z0-9_])[A-Za-z]+=(${DRIVE_BODY})${ID_END}`, "gi"),
  new RegExp(`["'\`](${DRIVE_BODY})${COPY_SUFFIX}["'\`]`, "gi"),
  new RegExp(`\\((${DRIVE_BODY})${COPY_SUFFIX}\\)`, "g"),
  new RegExp(`(?<![A-Za-z0-9])=(${DRIVE_BODY})${ID_END}`, "g"),
];
/** Generic slash and plus matches can sit inside a shaNNN- base64 blob. The patterns above cannot. */
const INTEGRITY_GUARDED = [
  new RegExp(`/(${DRIVE_BODY})${ID_END}`, "g"),
  new RegExp(`(?<![A-Za-z0-9])\\+(${DRIVE_BODY})${ID_END}`, "g"),
];
const PREFIXED_ID = new RegExp(`(?<![A-Za-z0-9_-])([A-Za-z0-9][A-Za-z0-9_-]*)_+(${DRIVE_BODY})${ID_END}`, "g");
const BARE_TOKEN = /(?<![A-Za-z0-9_+/=/-])([A-Za-z0-9_-]{19,100})(?![A-Za-z0-9_+/=/-])/g;

/** A `3_1_Card Name` token is exempt only as a filename or a JSON name, not as a bare id. */
function isPrintFilenameOrName(text: string, index: number, token: string): boolean {
  const after = text.slice(index + token.length, index + token.length + 8);
  if (/^\.(?:png|jpe?g|webp|gif|pdf|tiff?)\b/i.test(after)) return true;
  const before = text.slice(Math.max(0, index - 40), index);
  return /"name"\s*:\s*"$/.test(before);
}

function stripCopySuffix(token: string): string {
  return token.replace(/-copy(?:-of-[A-Za-z0-9_-]+)?$/i, "");
}

/**
 * True when `index` sits inside a real SRI body: sha256/384/512 (any case), then 43–86 base64
 * characters. `=` padding ends that body, so an id glued on after `==` is outside it.
 */
function inIntegrity(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0) {
    const ch = text[i]!;
    if (ch === "=") return false;
    if (!/[A-Za-z0-9+/]/.test(ch)) break;
    i -= 1;
  }
  if (i < 0 || text[i] !== "-") return false;
  if (!/sha(?:256|384|512)$/i.test(text.slice(0, i))) return false;
  let end = i + 1;
  while (end < text.length && /[A-Za-z0-9+/]/.test(text[end]!)) end += 1;
  const bodyLength = end - (i + 1);
  return bodyLength >= 43 && bodyLength <= 86 && index < end;
}

function isBareDriveId(id: string): boolean {
  if (id.length < 19 || id.length > 44) return false;
  if (/^\d+$/.test(id)) return false;
  const letters = id.replace(/[^A-Za-z]/g, "").length;
  if (letters < 8) return false;
  const mixed = /[a-z]/.test(id) && /[A-Z]/.test(id);
  if (mixed && /\d/.test(id)) return true;
  // Single-case ids still have to look like a Drive id. A sha256 hex string does not.
  return /^(?:0B|1)/.test(id);
}

export function driveIdsIn(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of DRIVE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (!raw) continue;
      const id = stripCopySuffix(raw);
      if (!/^(?:0B|1)/.test(id) || id.length < 19 || id.length > 44 || /^\d+$/.test(id)) continue;
      found.add(id);
    }
  }
  for (const pattern of INTEGRITY_GUARDED) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (!raw || inIntegrity(text, match.index ?? 0)) continue;
      const id = stripCopySuffix(raw);
      if (!/^(?:0B|1)/.test(id) || id.length < 19 || id.length > 44 || /^\d+$/.test(id)) continue;
      found.add(id);
    }
  }
  PREFIXED_ID.lastIndex = 0;
  for (const match of text.matchAll(PREFIXED_ID)) {
    const raw = match[2];
    if (!raw) continue;
    // An underscore inside a real 19–44 character id is not a separate id.
    if ((match[0]?.length ?? 0) <= 44) continue;
    const id = stripCopySuffix(raw);
    if (id.length < 19 || id.length > 44 || /^\d+$/.test(id)) continue;
    found.add(id);
  }
  BARE_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(BARE_TOKEN)) {
    const token = match[1];
    if (!token) continue;
    const id = stripCopySuffix(token);
    if (id.length > 44) continue;
    if (/^\d+_\d+_/.test(id) && isPrintFilenameOrName(text, match.index ?? 0, token)) continue;
    if (isBareDriveId(id)) found.add(id);
  }
  return [...found];
}

export function classifyDriveId(id: string, allowed: Set<string>, denyHashes: Set<string>): "ok" | "denied" | "foreign" {
  if (denyHashes.has(sha256(id))) return "denied";
  if (!allowed.has(id)) return "foreign";
  return "ok";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function loadIdLines(file: string): Set<string> {
  const text = readFileSync(file, "utf8");
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

/** The gitignored file of local-only folder ids (or their SHA-256) that must never ship. */
export const PRIVATE_IDS_FILE = ".beeline-private-ids.txt";

/**
 * SHA-256 hashes of the local, untracked list of non-Standard folder ids (deck parents, the old public
 * root): the file named by BEELINE_PRIVATE_IDS, else `.beeline-private-ids.txt` in the repo. A line is a
 * raw id or its 64-hex SHA-256. Nothing is read or returned when there is no such file, and the ids
 * themselves are never kept.
 */
export function loadPrivateDenyHashes(root: string, env: Record<string, string | undefined> = process.env): Set<string> {
  const file = env.BEELINE_PRIVATE_IDS || path.join(root, PRIVATE_IDS_FILE);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return new Set();
  }
  const hashes = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    hashes.add(/^[0-9a-f]{64}$/i.test(line) ? line.toLowerCase() : sha256(line));
  }
  return hashes;
}

function hasGit(root: string): boolean {
  try {
    return lstatSync(path.join(root, ".git")).isDirectory();
  } catch {
    return false;
  }
}

function gitList(root: string, args: string): string[] {
  return execSync(`git ${args}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split("\0")
    .filter(Boolean);
}

function listSourceFiles(root: string): string[] {
  if (hasGit(root)) {
    try {
      // Committed and untracked files are never filtered by a path segment named dist.
      return gitList(root, "ls-files -co --exclude-standard -z").map((relative) => path.join(root, relative));
    } catch {
      // A copied tree with a broken git dir falls through to a plain walk.
    }
  }
  const files = new Set<string>();
  collectFiles(root, files, new Set(["node_modules", ".git"]));
  return [...files];
}

/** Ignored paths such as uploads/. Only the top-level build directories are left out. */
function listIgnoredFiles(root: string): string[] {
  if (!hasGit(root)) return [];
  try {
    return gitList(root, "ls-files -o --ignored --exclude-standard -z -- . ':(exclude)node_modules' ':(exclude)dist' ':(exclude)dist-ssr'")
      .filter((relative) => {
        const top = relative.split(/[/\\]/)[0];
        return top !== "node_modules" && top !== "dist" && top !== "dist-ssr";
      })
      .map((relative) => path.join(root, relative));
  } catch {
    return [];
  }
}

export const SCAN_CHUNK = 1024 * 1024;
const CHUNK = SCAN_CHUNK;
const OVERLAP = 256;

function textsOf(buf: Buffer): string[] {
  const texts = [buf.toString("latin1")];
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) texts.push(buf.toString("utf16le"));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - (buf.length % 2));
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1]!;
      swapped[i + 1] = buf[i]!;
    }
    texts.push(swapped.toString("utf16le"));
  }
  return texts;
}

type ZipMeta = { method: number; compSize: number; localOffset: number };

function centralDirectory(buf: Buffer): ZipMeta[] {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipMeta[] = [];
  for (let n = 0; n < count && offset + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    entries.push({ method, compSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryBytes(buf: Buffer, method: number, compSize: number, dataStart: number): Buffer | null {
  if (compSize < 0 || dataStart + compSize > buf.length) return null;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) {
    try {
      return inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
}

function zipEntries(buf: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  const central = centralDirectory(buf);
  if (central.length) {
    for (const entry of central) {
      const local = entry.localOffset;
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
      const flags = buf.readUInt16LE(local + 6);
      const method = buf.readUInt16LE(local + 8);
      let compSize = buf.readUInt32LE(local + 18);
      if (flags & 0x8) compSize = entry.compSize;
      const nameLen = buf.readUInt16LE(local + 26);
      const extraLen = buf.readUInt16LE(local + 28);
      const bytes = entryBytes(buf, method, compSize, local + 30 + nameLen + extraLen);
      if (bytes) entries.push(bytes);
    }
    return entries;
  }
  let offset = 0;
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const flags = buf.readUInt16LE(offset + 6);
    if (flags & 0x8) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + nameLen + extraLen;
    const bytes = entryBytes(buf, method, compSize, dataStart);
    if (bytes) entries.push(bytes);
    if (dataStart + compSize > buf.length) break;
    offset = dataStart + compSize;
  }
  return entries;
}

function absorbText(text: string, relative: string, allowed: Set<string>, denyHashes: Set<string>, found: string[], seen: Set<string>) {
  const report = (line: string) => {
    if (seen.has(line)) return;
    seen.add(line);
    found.push(line);
  };
  if (hasDeniedWindow(text, denyHashes)) report(`${relative}: matches a paid folder id`);
  for (const id of driveIdsIn(text)) {
    const kind = classifyDriveId(id, allowed, denyHashes);
    if (kind === "denied") report(`${relative}: matches a paid folder id`);
    else if (kind === "foreign") report(`${relative}: ${id}`);
  }
}

function absorbBuffer(buf: Buffer, relative: string, allowed: Set<string>, denyHashes: Set<string>, found: string[], seen: Set<string>, depth: number) {
  for (const text of textsOf(buf)) absorbText(text, relative, allowed, denyHashes, found, seen);
  if (depth > 0 || buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return;
  for (const entry of zipEntries(buf)) absorbBuffer(entry, relative, allowed, denyHashes, found, seen, depth + 1);
}

function detectUtf16(buf: Buffer): "le" | "be" | null {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "be";
  const n = Math.min(buf.length - (buf.length % 2), 512);
  if (n < 32) return null;
  let odd = 0;
  let even = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < n; i += 2) {
    pairs += 1;
    if (buf[i] === 0) even += 1;
    if (buf[i + 1] === 0) odd += 1;
  }
  if (pairs < 8) return null;
  if (odd / pairs > 0.8 && even / pairs < 0.3) return "le";
  if (even / pairs > 0.8 && odd / pairs < 0.3) return "be";
  return null;
}

function decodeUtf16(buf: Buffer, mode: "le" | "be"): string {
  const even = buf.subarray(0, buf.length - (buf.length % 2));
  if (mode === "le") return even.toString("utf16le");
  const swapped = Buffer.alloc(even.length);
  for (let i = 0; i + 1 < even.length; i += 2) {
    swapped[i] = even[i + 1]!;
    swapped[i + 1] = even[i]!;
  }
  return swapped.toString("utf16le");
}

function scanRegularFile(full: string, relative: string, allowed: Set<string>, denyHashes: Set<string>, found: string[], seen: Set<string>) {
  let fd: number | undefined;
  try {
    fd = openSync(full, "r");
    const info = lstatSync(full);
    const buf = Buffer.alloc(CHUNK);
    let prev = Buffer.alloc(0);
    let utf16: "le" | "be" | null | undefined;
    let header = Buffer.alloc(0);
    const reportPiece = (piece: Buffer, final: boolean) => {
      if (utf16 === undefined) utf16 = detectUtf16(piece);
      const latin = piece.toString("latin1");
      const latinText = final || latin.length <= OVERLAP ? latin : latin.slice(0, latin.length - OVERLAP);
      absorbText(latinText, relative, allowed, denyHashes, found, seen);
      if (!utf16) return;
      const decoded = decodeUtf16(piece, utf16);
      const keep = Math.floor(OVERLAP / 2);
      const text = final || decoded.length <= keep ? decoded : decoded.slice(0, decoded.length - keep);
      absorbText(text, relative, allowed, denyHashes, found, seen);
    };
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) {
        if (prev.length) reportPiece(prev, true);
        break;
      }
      if (header.length < 4) header = Buffer.concat([header, buf.subarray(0, n)]).subarray(0, 4);
      const piece = Buffer.concat([prev, buf.subarray(0, n)]);
      const more = n === buf.length;
      if (!more) {
        reportPiece(piece, true);
        prev = Buffer.alloc(0);
        break;
      }
      reportPiece(piece, false);
      prev = Buffer.from(piece.subarray(Math.max(0, piece.length - OVERLAP)));
    }
    const isZip = header.length >= 4 && header.readUInt32LE(0) === 0x04034b50;
    if (!isZip) return;
    let whole: Buffer;
    try {
      whole = Buffer.alloc(info.size);
    } catch {
      found.push(`${relative}: too-large`);
      return;
    }
    const got = readSync(fd, whole, 0, whole.length, 0);
    for (const entry of zipEntries(whole.subarray(0, got))) absorbBuffer(entry, relative, allowed, denyHashes, found, seen, 1);
  } catch {
    found.push(`${relative}: unreadable`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function scanForForeignDriveIds(
  root: string,
  allowed: Set<string>,
  denyHashes: Set<string>,
  extraDirs: string[] = [],
  options?: { exclude?: (relative: string) => boolean },
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const files = new Set<string>([...listSourceFiles(root), ...listIgnoredFiles(root)]);
  for (const extra of extraDirs) collectFiles(extra, files, new Set(["node_modules"]));

  for (const full of files) {
    let info;
    try {
      info = lstatSync(full);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    const relative = path.relative(root, full);
    if (options?.exclude?.(relative)) continue;
    scanRegularFile(full, relative, allowed, denyHashes, found, seen);
  }
  return found;
}

/**
 * Every 33-character window that can be a Drive id is hashed.
 * A paid folder id of that length starts with 1 or 0B, including when it is glued to other text.
 */
export function hasDeniedWindow(text: string, denyHashes: Set<string>): boolean {
  if (denyHashes.size === 0 || text.length < 33) return false;
  for (let i = 0; i <= text.length - 33; i++) {
    const head = text[i];
    if (head !== "1" && !(head === "0" && text[i + 1] === "B")) continue;
    if (denyHashes.has(sha256(text.slice(i, i + 33)))) return true;
  }
  return false;
}

function collectFiles(dir: string, files: Set<string>, skip: Set<string>) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) {
    if (stat.isFile()) files.add(dir);
    return;
  }
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    collectFiles(path.join(dir, name), files, skip);
  }
}
