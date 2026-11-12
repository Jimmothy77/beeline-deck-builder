import { packForStorage, parseUnlocked, sha256Hex, upsertUnlocked, type UnlockedPack } from "@/lib/storage";

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

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A bad input fails the read below; the write side's own rejections are not separate errors.
  writer.write(bytes as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Builds the code from the packs as stored. Folder ids are never part of a stored pack, so never part of the code. */
export async function makeRestoreCode(packs: UnlockedPack[], options?: { compress?: boolean }): Promise<string> {
  if (!packs.length) throw new RestoreCodeError(RESTORE_ERRORS.nothing);
  const json = JSON.stringify({ kind: KIND, version: RESTORE_VERSION, packs: packs.map(packForStorage) });
  const raw = new TextEncoder().encode(json);
  const compress = (options?.compress ?? true) && canCompress();
  const body = compress ? "z" + toBase64Url(await pipe(raw, new CompressionStream("deflate-raw"))) : "j" + toBase64Url(raw);
  return `${RESTORE_PREFIX}${RESTORE_VERSION}.${body}.${sha256Hex(json).slice(0, 8)}`;
}

/** Reads a pasted code. Spaces and line breaks (from wrapped text) are ignored. Throws RestoreCodeError with a message for the person. */
export async function readRestoreCode(input: string): Promise<UnlockedPack[]> {
  const text = input.replace(/\s+/g, "");
  if (!text) throw new RestoreCodeError(RESTORE_ERRORS.empty);
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
    json = new TextDecoder("utf-8", { fatal: true }).decode(mode === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes);
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

/** Adds restored packs to the ones already here. A pack already on this device keeps its place and first unlock time. */
export function mergeRestored(current: UnlockedPack[], incoming: UnlockedPack[]): { packs: UnlockedPack[]; added: number; refreshed: number } {
  let packs = current;
  let added = 0;
  for (const pack of incoming) {
    const before = packs.length;
    packs = upsertUnlocked(packs, pack);
    if (packs.length > before) added += 1;
  }
  return { packs, added, refreshed: incoming.length - added };
}

export function restoredMessage(added: number, refreshed: number): string {
  const folders = (n: number) => `${n} unlocked ${n === 1 ? "folder" : "folders"}`;
  if (!added) return `Your restore code matched ${folders(refreshed)} already on this device. Their deck lists were updated.`;
  return `Restored ${folders(added)} on this device${refreshed ? `, and updated ${refreshed} already here` : ""}.`;
}
