import { mapLinkWarning, purgeMapUnlocks } from "@/lib/pf-map";
import { catalogueStamp, findUnlocked, packForStorage, parseUnlocked, sha256Hex, upsertUnlocked, type UnlockedPack } from "@/lib/storage";

/**
 * Restore codes move the unlocked folders on this device (localStorage printabee.unlocked.v1) to
 * another device by copy and paste. No account and no server: the code *is* the stored deck lists,
 * file ids included, so anyone holding it gets the same unlocks. The UI treats it like a password.
 *
 * Format: BEELINE-RESTORE-1.<z|j><base64url payload>.<check>
 *   z = deflate-raw, j = plain JSON (browsers without CompressionStream),
 *   check = first 8 hex chars of SHA-256 of the JSON text, so a cut-off or edited code is caught.
 * The code is built and read only in the browser. It is never logged or sent anywhere.
 */
export const RESTORE_PREFIX = "BEELINE-RESTORE-";
export const RESTORE_VERSION = 1;
const KIND = "beeline-unlocks";

export const RESTORE_ERRORS = {
  empty: "Paste a restore code first.",
  notCode: "That isn't a BeeLine restore code. A restore code starts with BEELINE-RESTORE-1.",
  newer: "That restore code was made by a newer BeeLine. Update this copy of BeeLine, then paste it again.",
  damaged: "That restore code is incomplete or was changed. Copy the whole code again on the other device and paste all of it.",
  noPacks: "That restore code has no unlocked folders in it.",
  nothing: "There are no unlocked folders on this device yet, so there is nothing to put in a restore code.",
} as const;

export class RestoreCodeError extends Error {}

/**
 * A pasted code longer than this is refused before it is decoded. Every shipped deck unlocked as
 * Partial Foil (its Deluxe included) makes a code of about 610 KB, so 1 MB leaves room to grow.
 */
export const MAX_CODE_CHARS = 1024 * 1024;
/** Decompression stops past this many bytes, so a small "deflate bomb" cannot fill memory. */
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const TOO_BIG = "That restore code is far too large to be a BeeLine restore code. Copy the code again on the other device and paste only the code.";

const kb = (n: number) => Math.ceil(n / 1024).toLocaleString("en-US");

/** Shown instead of a code when the unlocks here would make one too big for any BeeLine to read. */
export function codeTooBigMessage(size: number, limit = MAX_CODE_CHARS): string {
  return `There are too many unlocked folders on this device for one restore code: it would be ${kb(size)} KB, and BeeLine reads codes up to ${kb(limit)} KB. No code was made. On the other device, paste the Drive links from your orders instead.`;
}

export const CODE_CHECK_FAILED = "BeeLine couldn't make a restore code that reads back correctly, so none is shown. Reload the page and try again, or paste the Drive links on the other device instead.";

/** A code's stamp may be at most this far ahead of this device's clock. Later stamps count as this. */
export const MAX_STAMP_AHEAD_MS = 24 * 60 * 60 * 1000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function canCompress(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A bad input fails the read below; the write side's own rejections are not separate errors.
  writer.write(bytes as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += (value as Uint8Array).length;
    // Read chunk by chunk and stop as soon as the output passes the limit; the rest is never inflated.
    if (total > limit) {
      reader.cancel().catch(() => undefined);
      throw new RestoreCodeError(TOO_BIG);
    }
    chunks.push(value as Uint8Array);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A pack as a restore reads it: its stored form parsed back. Fields a restore drops (such as sourceFiles) are gone. */
function asRestored(pack: UnlockedPack): UnlockedPack | null {
  return parseUnlocked(JSON.parse(JSON.stringify(packForStorage(pack))) as unknown);
}

/**
 * Builds the code from the packs as a restore will read them. Folder ids are never part of a stored
 * pack, so never part of the code. The code is then read back exactly as a paste would be; a code
 * that is over the size limits, or that does not read back to the same packs, is refused here with a
 * message for the person, so a code a restore would refuse is never shown.
 */
export async function makeRestoreCode(packs: UnlockedPack[], options?: { compress?: boolean }): Promise<string> {
  // A Partial Foil Map folder saved by an older BeeLine is never carried (v0.1.38).
  const carried = purgeMapUnlocks(packs).packs;
  if (!carried.length) throw new RestoreCodeError(RESTORE_ERRORS.nothing);
  const readable = carried.flatMap((pack) => {
    const parsed = asRestored(pack);
    return parsed ? [parsed] : [];
  });
  const stored = readable.map(packForStorage);
  const json = JSON.stringify({ kind: KIND, version: RESTORE_VERSION, packs: stored });
  const raw = new TextEncoder().encode(json);
  if (raw.length > MAX_JSON_BYTES) throw new RestoreCodeError(codeTooBigMessage(raw.length, MAX_JSON_BYTES));
  const compress = (options?.compress ?? true) && canCompress();
  const body = compress ? "z" + toBase64Url(await pipe(raw, new CompressionStream("deflate-raw"))) : "j" + toBase64Url(raw);
  const code = `${RESTORE_PREFIX}${RESTORE_VERSION}.${body}.${sha256Hex(json).slice(0, 8)}`;
  if (code.length > MAX_CODE_CHARS) throw new RestoreCodeError(codeTooBigMessage(code.length));
  let back: UnlockedPack[];
  try {
    back = await readRestoreCode(code);
  } catch {
    throw new RestoreCodeError(CODE_CHECK_FAILED);
  }
  if (JSON.stringify(back.map(packForStorage)) !== JSON.stringify(stored)) throw new RestoreCodeError(CODE_CHECK_FAILED);
  return code;
}

/** Reads a pasted code. Spaces and line breaks (from wrapped text) are ignored. Throws RestoreCodeError with a message for the person. */
export async function readRestoreCode(input: string): Promise<UnlockedPack[]> {
  // Refuse a huge paste before any work on it (whitespace stripping included).
  if (input.length > MAX_CODE_CHARS * 2) throw new RestoreCodeError(TOO_BIG);
  const text = input.replace(/\s+/g, "");
  if (!text) throw new RestoreCodeError(RESTORE_ERRORS.empty);
  if (text.length > MAX_CODE_CHARS) throw new RestoreCodeError(TOO_BIG);
  const head = /^BEELINE-RESTORE-(\d+)\./i.exec(text);
  if (!head) throw new RestoreCodeError(RESTORE_ERRORS.notCode);
  if (Number(head[1]) > RESTORE_VERSION) throw new RestoreCodeError(RESTORE_ERRORS.newer);
  if (Number(head[1]) !== RESTORE_VERSION) throw new RestoreCodeError(RESTORE_ERRORS.notCode);
  const parts = text.slice(head[0].length).split(".");
  if (parts.length !== 2 || !/^[0-9a-f]{8}$/.test(parts[1]!)) throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  const [body, check] = parts as [string, string];
  const mode = body.charAt(0);
  if (mode !== "z" && mode !== "j") throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  let json: string;
  try {
    const bytes = fromBase64Url(body.slice(1));
    if (mode === "z" && !canCompress()) throw new RestoreCodeError("This browser can't read that restore code. Try it in a current Chrome, Edge, Firefox, or Safari.");
    json = new TextDecoder("utf-8", { fatal: true }).decode(mode === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON_BYTES) : bytes);
  } catch (caught) {
    if (caught instanceof RestoreCodeError) throw caught;
    throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  }
  if (sha256Hex(json).slice(0, 8) !== check) throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  }
  const record = parsed && typeof parsed === "object" ? (parsed as { kind?: unknown; packs?: unknown }) : null;
  if (!record || record.kind !== KIND || !Array.isArray(record.packs)) throw new RestoreCodeError(RESTORE_ERRORS.damaged);
  const packs = record.packs.flatMap((item) => {
    const pack = parseUnlocked(item);
    return pack ? [pack] : [];
  });
  if (!packs.length) throw new RestoreCodeError(RESTORE_ERRORS.noPacks);
  return packs;
}

/** Cards in all of a pack's editions. */
function cardCount(pack: UnlockedPack): number {
  return pack.catalogue.editions.reduce((sum, edition) => sum + edition.cards.length, 0);
}

/** A code's stamps capped at this device's clock plus a day, so a code from "the future" can't win forever. */
function capStamps(pack: UnlockedPack, now: number): UnlockedPack {
  const latest = now + MAX_STAMP_AHEAD_MS;
  const ahead = (value: string | undefined) => Boolean(value) && Date.parse(value!) > latest;
  if (!ahead(pack.refreshedAt) && !ahead(pack.savedAt)) return pack;
  const cap = new Date(latest).toISOString();
  return { ...pack, savedAt: ahead(pack.savedAt) ? cap : pack.savedAt, refreshedAt: ahead(pack.refreshedAt) || (!pack.refreshedAt && ahead(pack.savedAt)) ? cap : pack.refreshedAt };
}

/**
 * Adds restored packs to the ones already here. A Partial Foil Map folder in the code (saved by an older
 * BeeLine) is left out and counted in `maps`. A pack already on this device keeps its place and first
 * unlock time, and its deck list is replaced only when the code's copy was read from Drive later
 * (catalogueStamp, capped at this device's clock plus a day) and has cards. An older code never rolls a
 * deck list back, an empty one never empties it, and a restore never removes a pack.
 */
export function mergeRestored(
  current: UnlockedPack[],
  incoming: UnlockedPack[],
  now = Date.now(),
): { packs: UnlockedPack[]; added: number; refreshed: number; kept: number; empty: number; maps: number } {
  const { packs: wanted, dropped: maps } = purgeMapUnlocks(incoming);
  let packs = current;
  let added = 0;
  let refreshed = 0;
  let kept = 0;
  let empty = 0;
  for (const given of wanted) {
    const pack = capStamps(given, now);
    const existing = findUnlocked(packs, pack);
    if (existing && catalogueStamp(pack) <= catalogueStamp(existing)) {
      kept += 1;
      continue;
    }
    if (existing && cardCount(pack) === 0) {
      empty += 1;
      continue;
    }
    packs = upsertUnlocked(packs, pack);
    if (existing) refreshed += 1;
    else added += 1;
  }
  return { packs, added, refreshed, kept, empty, maps };
}

export function restoredMessage(added: number, refreshed: number, kept = 0, empty = 0, maps = 0): string {
  if (maps && !added && !refreshed && !kept && !empty) return mapLinkWarning(null);
  const mapNote = maps ? ` ${maps === 1 ? "1 Partial Foil Map folder in the code was" : `${maps} Partial Foil Map folders in the code were`} left out.` : "";
  return restoredCounts(added, refreshed, kept, empty) + mapNote;
}

function restoredCounts(added: number, refreshed: number, kept: number, empty: number): string {
  const folders = (n: number) => `${n} unlocked ${n === 1 ? "folder" : "folders"}`;
  const keptNote = kept ? ` ${kept === 1 ? "1 deck list here was" : `${kept} deck lists here were`} as new or newer, so ${kept === 1 ? "it was" : "they were"} kept.` : "";
  const emptyNote = empty ? ` ${empty === 1 ? "1 folder in the code had" : `${empty} folders in the code had`} no cards, so ${empty === 1 ? "its deck list here was" : "their deck lists here were"} kept.` : "";
  const notes = keptNote + emptyNote;
  if (!added && !refreshed) return `Your restore code matched ${folders(kept + empty)} already on this device.${notes}`;
  if (!added) return `Your restore code matched ${folders(refreshed + kept + empty)} already on this device. ${!kept && !empty ? "Their deck lists were" : refreshed === 1 ? "1 deck list was" : `${refreshed} deck lists were`} updated.${notes}`;
  return `Restored ${folders(added)} on this device${refreshed ? `, and updated ${refreshed} already here` : ""}.${notes}`;
}
