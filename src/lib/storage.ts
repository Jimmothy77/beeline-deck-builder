import type { ArtTone, CatalogueNote, DeckCard, DeckCatalogue, Decklist, DecklistEntry, Edition, PrintType } from "@/lib/types";
import { artsOf, toneBackId, defaultBackId, type SavedCard } from "@/lib/selection";
import { artIdsOf, claimEditionId } from "@/lib/group";
import { isKnownUnprefixedPair, pairLooseFaces } from "@/lib/faces";
import { normalizeKey, parsePrintName, slug } from "@/lib/names";

export const SAVED_KEY = "printabee.savedDecks.v1";
/** One-time copy of the original v0.1.11 save, written on the first Save that converts it. */
export const LEGACY_BACKUP_KEY = "printabee.savedDecks.v011";
export const UNLOCK_KEY = "printabee.unlocked.v1";
/** The deck being built when the page was last used, for "Continue where you left off". */
export const LAST_SESSION_KEY = "printabee.lastSession.v1";

export type SavedDeck = {
  id: string;
  name: string;
  deckId: string;
  deckName: string;
  editionId: string;
  editionName: string;
  /**
   * Short hash of the unlocked folder this deck was built from.
   * Stored in localStorage only. It is not a Drive file id and is never shipped.
   */
  packHash?: string;
  printType: PrintType;
  treatment: string | null;
  cardbackId: string | null;
  /** Partial foil only. Flip and token backs become extra fronts when true. */
  printFlipBacksAsFronts?: boolean;
  /** Deck list the deck was opened on. Absent on decks saved before lists, and on editions without one. */
  decklistId?: string;
  /** SxF Color or Black and White pick. Absent when the edition has only one version. */
  tone?: ArtTone;
  /**
   * Per-card back picked in the card editor: card id to a file id (one of
   * the edition's card backs, or an extra's or token's front). Absent on
   * decks saved before v0.1.28 and on decks with no pick; a card without an
   * entry uses the deck-wide back, or its own back face.
   */
  cardBacks?: Record<string, string>;
  cards: SavedCard[];
  updatedAt: string;
};

export type UnlockedPack = {
  /** Truncated SHA-256 of the folder id. This is the stored identity. */
  packHash: string;
  /** v0.1.5 FNV hash, kept so a deck saved with that hash still finds this pack. */
  legacyHash?: string;
  savedAt: string;
  /**
   * When this catalogue was read from Drive (v0.1.36+). A restore code replaces a catalogue here only
   * when its own stamp (refreshedAt, else savedAt) is newer. Older saves fall back to savedAt.
   */
  refreshedAt?: string;
  catalogue: DeckCatalogue;
  /** In memory during unlock. Never written. */
  folderId?: string;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_FULL = "This browser couldn't save that. Its storage may be full. Export your decks as JSON, then free some space and try again.";
const FALLBACK_STAMP = "1970-01-01T00:00:00.000Z";

const pendingLegacyBackup = new WeakMap<Store, string>();

function isLegacySave(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return false;
    return parsed.some((item) => {
      if (!item || typeof item !== "object" || !Array.isArray((item as { cards?: unknown }).cards)) return false;
      return (item as { cards: unknown[] }).cards.some((card) => {
        if (!card || typeof card !== "object") return false;
        const row = card as { pairs?: unknown; arts?: unknown; qty?: unknown };
        return !Array.isArray(row.pairs) && (row.arts !== undefined || row.qty !== undefined);
      });
    });
  } catch {
    return false;
  }
}

export function loadSaved(store: Store): SavedDeck[] {
  const raw = store.getItem(SAVED_KEY);
  if (!raw) return [];
  if (isLegacySave(raw) && !store.getItem(LEGACY_BACKUP_KEY)) pendingLegacyBackup.set(store, raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const deck = parseSavedDeck(item);
    return deck ? [deck] : [];
  });
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const code = "code" in error ? Number(error.code) : 0;
  return name === "QuotaExceededError" || code === 22 || code === 1014;
}

const BACKUP_SKIPPED = "The original save could not be backed up because storage is full. This deck was saved.";

/** Returns a notice when the one-time backup could not be stored. The deck is still written. */
export function writeSaved(store: Store, decks: SavedDeck[]): string | null {
  let notice: string | null = null;
  const legacy = pendingLegacyBackup.get(store);
  if (legacy && !store.getItem(LEGACY_BACKUP_KEY)) {
    try {
      store.setItem(LEGACY_BACKUP_KEY, legacy);
    } catch (error) {
      if (!isQuotaError(error)) throw new Error(STORAGE_FULL);
      notice = BACKUP_SKIPPED;
    }
    pendingLegacyBackup.delete(store);
  }
  try {
    store.setItem(SAVED_KEY, JSON.stringify(decks));
  } catch {
    throw new Error(STORAGE_FULL);
  }
  return notice;
}

/**
 * The deck to offer under "Continue where you left off": the last deck being built, or, for a save
 * made before v0.1.35 (no record yet), the most recently saved deck. Null when nothing is saved.
 * Both go through the saved-deck parser, so older save formats load the same way they do in the list.
 */
export function loadLastSession(store: Store, saved: SavedDeck[]): SavedDeck | null {
  const last = parseSavedDeck(readJson(store, LAST_SESSION_KEY));
  if (last) return last;
  let newest: SavedDeck | null = null;
  for (const deck of saved) if (!newest || deck.updatedAt > newest.updatedAt) newest = deck;
  return newest;
}

/** Best effort. A full or blocked store only loses the Continue shortcut, never the deck. */
export function writeLastSession(store: Store, deck: SavedDeck) {
  try {
    store.setItem(LAST_SESSION_KEY, JSON.stringify(deck));
  } catch {
    // The saved decks are untouched. Continue falls back to the newest saved deck.
  }
}

/** Put the one-time v0.1.11 copy back. The backup itself stays, so it can be restored again. */
export function restoreLegacyBackup(store: Store): SavedDeck[] | null {
  const raw = store.getItem(LEGACY_BACKUP_KEY);
  if (!raw) return null;
  store.setItem(SAVED_KEY, raw);
  return loadSaved(store);
}

function rawUnlockNeedsRewrite(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  if (typeof record.folderId === "string" && record.folderId) return true;
  if (typeof record.sourceUrl === "string" && record.sourceUrl && record.rememberLink !== true) return true;
  if (record.rememberLink === true) return true;
  return false;
}

function stripUnlockSecrets(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const copy = { ...(item as Record<string, unknown>) };
  delete copy.folderId;
  delete copy.sourceUrl;
  delete copy.rememberLink;
  return copy;
}

export function loadUnlocked(store: Store): UnlockedPack[] {
  try {
    store.removeItem("printabee.rememberLink.v1");
  } catch {
    // The preference is unused. A full store can keep the key.
  }
  const parsed = readJson(store, UNLOCK_KEY);
  if (!Array.isArray(parsed)) return [];
  const packs: UnlockedPack[] = [];
  const stored = parsed.map((item) => {
    const pack = parseUnlocked(item);
    if (pack) {
      packs.push(pack);
      return packForStorage(pack);
    }
    return stripUnlockSecrets(item);
  });
  if (parsed.some(rawUnlockNeedsRewrite)) {
    try {
      store.setItem(UNLOCK_KEY, JSON.stringify(stored));
    } catch {
      // The in-memory list is already stripped. The next successful save rewrites it.
    }
  }
  return packs;
}

function preservedUnlockRecords(store: Store): unknown[] {
  const parsed = readJson(store, UNLOCK_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => (parseUnlocked(item) ? [] : [stripUnlockSecrets(item)]));
}

export function writeUnlocked(store: Store, packs: UnlockedPack[], options?: { preserve?: boolean }) {
  try {
    if (options?.preserve === false) {
      if (packs.length === 0) {
        store.removeItem(UNLOCK_KEY);
        return;
      }
      store.setItem(UNLOCK_KEY, JSON.stringify(packs.map(packForStorage)));
      return;
    }
    const records = [...packs.map(packForStorage), ...preservedUnlockRecords(store)];
    store.setItem(UNLOCK_KEY, JSON.stringify(records));
  } catch {
    throw new Error(STORAGE_FULL);
  }
}

/** Forget drops every unlock record, including ones the parser cannot read. */
export function forgetUnlocked(store: Store) {
  writeUnlocked(store, [], { preserve: false });
}

/** Persist the catalogue and hashes. Folder ids and Drive links are not written. */
export function packForStorage(pack: UnlockedPack): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    packHash: pack.packHash || (pack.folderId ? packHash(pack.folderId) : ""),
    savedAt: pack.savedAt,
    catalogue: pack.catalogue,
  };
  if (pack.legacyHash) stored.legacyHash = pack.legacyHash;
  if (pack.refreshedAt) stored.refreshedAt = pack.refreshedAt;
  return stored;
}

export function exportSavedJson(decks: SavedDeck[]): string {
  return JSON.stringify({ kind: "printabee-saved-decks", version: 1, decks }, null, 2);
}

export function importSavedJson(text: string): SavedDeck[] {
  const parsed = JSON.parse(text) as unknown;
  const decks = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { decks?: unknown }).decks) ? (parsed as { decks: unknown[] }).decks : null;
  if (!decks) throw new Error("That file isn't a BeeLine saved-deck export.");
  const valid = decks.flatMap((item) => {
    const deck = parseSavedDeck(item);
    return deck ? [deck] : [];
  });
  if (!valid.length) throw new Error("No saved decks were found in that file.");
  return valid;
}

export function mergeSaved(current: SavedDeck[], incoming: SavedDeck[]): SavedDeck[] {
  const map = new Map(current.map((deck) => [deck.id, withStamp(deck)]));
  for (const deck of incoming) map.set(deck.id, withStamp(deck));
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function withStamp(deck: SavedDeck): SavedDeck {
  return { ...deck, updatedAt: deck.updatedAt || FALLBACK_STAMP };
}

/** First 12 hex chars of SHA-256. Not a Drive id. */
export function packHash(folderId: string): string {
  return sha256Hex(folderId).slice(0, 12);
}

/** v0.1.5 folder hash. Still accepted so those saved decks keep resolving. */
export function fnvPackHash(folderId: string): string {
  let a = 0x811c9dc5;
  let b = 0x811c9dc5 ^ folderId.length;
  for (let i = 0; i < folderId.length; i++) {
    const code = folderId.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193);
    b ^= code + i;
    b = Math.imul(b, 0x01000193);
  }
  return ((a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}

export function sha256Hex(message: string): string {
  const data = new TextEncoder().encode(message);
  const bitLength = data.length * 8;
  const withPad = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  withPad.set(data);
  withPad[data.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLength, false);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function isUnlockedPack(item: DeckCatalogue | UnlockedPack): item is UnlockedPack {
  if (!("catalogue" in item)) return false;
  const pack = item as UnlockedPack;
  return typeof pack.packHash === "string" || typeof pack.folderId === "string";
}

function catalogueOf(item: DeckCatalogue | UnlockedPack): { catalogue: DeckCatalogue; pack: UnlockedPack | null } {
  if (isUnlockedPack(item)) return { catalogue: item.catalogue, pack: item };
  return { catalogue: item, pack: null };
}

function hashOf(pack: Pick<UnlockedPack, "packHash" | "folderId">): string {
  return pack.packHash || (pack.folderId ? packHash(pack.folderId) : "");
}

function samePack(left: UnlockedPack, right: UnlockedPack): boolean {
  const rightHash = hashOf(right);
  const rightLegacy = right.legacyHash || (right.folderId ? fnvPackHash(right.folderId) : "");
  return Boolean(
    (rightHash && (left.packHash === rightHash || left.legacyHash === rightHash)) ||
      (rightLegacy && (left.packHash === rightLegacy || left.legacyHash === rightLegacy)) ||
      (left.folderId && right.folderId && left.folderId === right.folderId),
  );
}

/** When a pack's catalogue was read: refreshedAt, else (saves before v0.1.36) savedAt. Milliseconds; 0 when unreadable. */
export function catalogueStamp(pack: Pick<UnlockedPack, "refreshedAt" | "savedAt">): number {
  const at = Date.parse(pack.refreshedAt || pack.savedAt);
  return Number.isFinite(at) ? at : 0;
}

/** The stored pack that is the same folder as `pack`, if any. */
export function findUnlocked(current: UnlockedPack[], pack: UnlockedPack): UnlockedPack | undefined {
  const probe: UnlockedPack = { ...pack, packHash: hashOf(pack) };
  return current.find((item) => samePack(item, probe));
}

/** Re-pasting a folder keeps its place and its first unlock time. A new folder goes last. */
export function upsertUnlocked(current: UnlockedPack[], pack: UnlockedPack): UnlockedPack[] {
  const nextPack: UnlockedPack = { ...pack, packHash: hashOf(pack), refreshedAt: pack.refreshedAt || pack.savedAt };
  const index = current.findIndex((item) => samePack(item, nextPack));
  if (index === -1) return [...current, nextPack];
  const next = current.slice();
  const previous = current[index]!;
  next[index] = { ...nextPack, savedAt: previous.savedAt || nextPack.savedAt, legacyHash: previous.legacyHash ?? nextPack.legacyHash };
  return next;
}

function labeledEdition(edition: Edition, packName: string, existing: Edition[]): Edition {
  const used = new Set(existing.map((item) => item.name));
  let name = edition.name.trim() || "Deluxe";
  if (name === "Deluxe" || name === "Standard" || name === "Partial Foil") name = `${name} · ${packName}`;
  if (!used.has(name)) return { ...edition, name };
  const withPack = name.includes(packName) ? `${name} (2)` : `${name} · ${packName}`;
  if (!used.has(withPack)) return { ...edition, name: withPack };
  let n = 3;
  while (used.has(`${name} (${n})`)) n += 1;
  return { ...edition, name: `${name} (${n})` };
}

export function isDeluxeEdition(edition: Pick<Edition, "id" | "name" | "printType">): boolean {
  if (edition.printType !== "standard") return false;
  if (edition.id === "deluxe" || edition.id.startsWith("deluxe-") || edition.id.includes("-deluxe")) return true;
  return edition.name === "Deluxe" || edition.name.startsWith("Deluxe ·") || edition.name.startsWith("Deluxe ");
}

const LEGACY_DELUXE_NOTE =
  "This deck was saved when every Deluxe edition shared the id “deluxe”. Pick the Deluxe edition you want from the list and save it again. If it isn't listed, unlock that folder first.";

/**
 * v0.1.0–v0.1.2 saved every Deluxe edition as "deluxe". Match only inside
 * draft.deckId. Another game's Deluxe edition is not a match, and nothing is written.
 */
export function resolveLegacyDeluxe(draft: SavedDeck, catalogues: DeckCatalogue[]): { deck: SavedDeck; note: string | null } {
  if (draft.editionId !== "deluxe") return { deck: draft, note: null };
  const deluxe = catalogues
    .filter((catalogue) => catalogue.id === draft.deckId)
    .flatMap((catalogue) => (catalogue.editions ?? []).filter(isDeluxeEdition));
  if (deluxe.length !== 1) return { deck: draft, note: LEGACY_DELUXE_NOTE };
  const edition = deluxe[0]!;
  return {
    deck: {
      ...draft,
      editionId: edition.sourceId ?? edition.id,
      editionName: edition.name,
      packHash: edition.packHash ?? draft.packHash,
    },
    note: null,
  };
}

const MISSING_PACK_NOTE =
  "This deck is tied to a folder that isn't unlocked on this device. Unlock that folder again. Another pack was not used in its place.";

function packOwnsHash(pack: UnlockedPack, hash: string): boolean {
  return pack.packHash === hash || pack.legacyHash === hash || (!!pack.folderId && (packHash(pack.folderId) === hash || fnvPackHash(pack.folderId) === hash));
}

function canonicalPackHash(pack: UnlockedPack): string {
  return pack.packHash || (pack.folderId ? packHash(pack.folderId) : "");
}

/** Inside a pinned pack the saved id is the edition's own id, never the merged suffix. */
function pinnedSourceId(edition: Edition): string {
  return edition.sourceId ?? edition.id;
}

function picksFit(deck: SavedDeck, edition: Edition): boolean {
  const ids = artIdsOf(edition);
  return deck.cards.every((card) => card.pairs.every((pair) => !pair.art || ids.has(pair.art)));
}

function isPaidEdition(edition: Edition): boolean {
  if (edition.printType === "partial_foil" || edition.packHash || edition.origin === "unlocked") return true;
  return isDeluxeEdition(edition);
}

function withoutMissingPicks(deck: SavedDeck, edition: Edition): { deck: SavedDeck; dropped: string[] } {
  const ids = artIdsOf(edition);
  const dropped: string[] = [];
  const cards = deck.cards.flatMap((card) => {
    const found = edition.cards.find((item) => item.id === card.cardId);
    const name = found?.name ?? card.cardId;
    const fallback = found?.faces[0]?.defaultArt?.id ?? "";
    const pairs = card.pairs.flatMap((pair) => {
      if (!pair.art || ids.has(pair.art)) return [pair];
      dropped.push(`${name} (${pair.art})`);
      return fallback ? [{ ...pair, art: fallback }] : [];
    });
    return pairs.length ? [{ ...card, pairs }] : [];
  });
  return { deck: { ...deck, cards }, dropped };
}

/** A blank front means "this card's default art", including after a reload. */
function fillBlankArt(deck: SavedDeck, edition: Edition): SavedDeck {
  const cards = deck.cards.map((card) => {
    const fallback = edition.cards.find((item) => item.id === card.cardId)?.faces[0]?.defaultArt?.id ?? "";
    if (!fallback) return card;
    return { ...card, pairs: card.pairs.map((pair) => (pair.art ? pair : { ...pair, art: fallback })) };
  });
  return { ...deck, cards };
}

function artOwners(edition: Edition): Map<string, string> {
  const owners = new Map<string, string>();
  for (const card of edition.cards) {
    for (const face of card.faces) {
      for (const art of [face.defaultArt, ...(face.alternates ?? [])]) {
        if (art && !owners.has(art.id)) owners.set(art.id, card.id);
      }
    }
  }
  return owners;
}

/** Art ids on the back faces of double-faced cards, keyed to their card. */
function backFaceOwners(edition: Edition): Map<string, string> {
  const owners = new Map<string, string>();
  for (const card of edition.cards) {
    const front = new Set([card.faces[0]?.defaultArt, ...(card.faces[0]?.alternates ?? [])].map((art) => art?.id));
    for (const face of card.faces.slice(1)) {
      for (const art of [face.defaultArt, ...(face.alternates ?? [])]) {
        if (art && !front.has(art.id) && !owners.has(art.id)) owners.set(art.id, card.id);
      }
    }
  }
  return owners;
}

function defaultArtOf(card: { faces: Edition["cards"][number]["faces"] }): string {
  return card.faces[0]?.defaultArt?.id ?? "";
}

function fileBase(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/^standard\s+/i, "").trim();
}

function initialsOf(name: string): string {
  return normalizeKey(name)
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]!)
    .join("");
}

/**
 * The pasted pack (id `p5`, name `P5`) and the shipped Persona 5 catalogue are
 * the same deck: the initials of "Persona 5" are `p5`. A name that matches
 * more than one catalogue is not a guess.
 */
function relatedCatalogues(catalogues: DeckCatalogue[], deck: SavedDeck): DeckCatalogue[] | null {
  const byId = catalogues.filter((catalogue) => catalogue.id === deck.deckId);
  if (byId.length === 1) {
    const primary = byId[0]!;
    const linked = catalogues.filter((catalogue) => {
      if (catalogue.id === primary.id) return false;
      const initials = initialsOf(catalogue.name);
      return initials.length >= 2 && (initials === deck.deckId || initials === normalizeKey(deck.deckName));
    });
    return [primary, ...linked];
  }
  if (byId.length > 1) return null;
  const byName = catalogues.filter((catalogue) => normalizeKey(catalogue.name) === normalizeKey(deck.deckName));
  if (byName.length !== 1) return null;
  return byName;
}

/** Same deck and the same print type only. A PF file in a Deluxe deck, or a paid file in a free deck, is not a match. */
/**
 * A file can also name one face of a double-faced card. "1_2_Token - The Ring
 * Tempts You" is the back of "Token - The Ring // Token - The Ring Tempts You",
 * so it matches that card as its back, like an old Lost Vale row.
 */
function cardByFileName(
  artId: string,
  edition: Edition,
  catalogues: DeckCatalogue[],
  deck: SavedDeck,
): { cardId: string; backArt?: string } | { forbidden: true } | null {
  const related = relatedCatalogues(catalogues, deck);
  if (!related) return null;
  const found: { name: string; printType: Edition["printType"]; paid: boolean }[] = [];
  for (const catalogue of related) {
    for (const other of catalogue.editions) {
      for (const file of other.sourceFiles ?? []) {
        if (file.id === artId) found.push({ name: file.name, printType: other.printType, paid: isPaidEdition(other) });
      }
      if (other === edition || other.id === edition.id) continue;
      for (const card of other.cards) {
        for (const face of card.faces) {
          for (const art of [face.defaultArt, ...(face.alternates ?? [])]) {
            if (art?.id === artId) found.push({ name: art.name, printType: other.printType, paid: isPaidEdition(other) });
          }
        }
      }
    }
  }
  if (!found.length) return null;
  if (found.some((item) => item.printType !== edition.printType || (item.paid && !isPaidEdition(edition)))) return { forbidden: true };
  const keys = [...new Set(found.map((item) => normalizeKey(fileBase(item.name))))];
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  const hits = edition.cards.filter((card) => normalizeKey(card.name) === key || card.id === `extra-${slug(fileBase(found[0]!.name))}` || card.id === `main-${slug(fileBase(found[0]!.name))}`);
  if (hits.length === 1) return { cardId: hits[0]!.id };
  if (hits.length) return null;
  return cardByFaceName(fileBase(found[0]!.name), edition);
}

/** One face of exactly one card, and the face number in the file name (when it has one) agrees. */
function cardByFaceName(base: string, edition: Edition): { cardId: string; backArt?: string } | null {
  const parsed = parsePrintName(base);
  const key = normalizeKey(parsed.stem);
  if (!key) return null;
  const hits: { card: Edition["cards"][number]; index: number }[] = [];
  for (const card of edition.cards) {
    const index = card.faces.findIndex((face) => normalizeKey(face.name) === key);
    if (index >= 0) hits.push({ card, index });
  }
  if (hits.length !== 1) return null;
  const { card, index } = hits[0]!;
  if (parsed.face === 2 && index === 0) return null;
  if (parsed.face === 1 && index !== 0) return null;
  if (index === 0) return { cardId: card.id };
  const backArt = card.faces[index]?.defaultArt?.id;
  return backArt ? { cardId: card.id, backArt } : null;
}

const UPDATED_ART = "Some saved art picks were updated to this edition's files.";

function backToneOf(card: DeckCard, fileId: string): ArtTone | undefined {
  const face = card.faces[1];
  return face ? artsOf(face).find((art) => art.id === fileId)?.tone ?? undefined : undefined;
}

/** True when the deck has a tone and this back face file is tagged with the other one. */
function wrongTone(card: DeckCard, fileId: string, tone: ArtTone | null | undefined): boolean {
  const own = backToneOf(card, fileId);
  return Boolean(tone && own && own !== tone);
}

/** The saved back file when it fits the deck's tone, otherwise the back face's file in that tone. */
function backInTone(card: DeckCard, saved: string | undefined, tone: ArtTone | null | undefined): string | undefined {
  if (saved && !wrongTone(card, saved, tone)) return saved;
  return (tone && card.faces[1] ? toneBackId(card, tone) : "") || saved;
}

/**
 * A v0.1.11 row is one art and one quantity. A file that now belongs to a card
 * already in the deck adds a pair, or adds to that pair when it is the same art.
 * A file that matches nothing is the only thing dropped.
 */
function reconcileSavedCards(deck: SavedDeck, edition: Edition, catalogues: DeckCatalogue[]): { deck: SavedDeck; note: string | null } {
  const known = new Set(edition.cards.map((card) => card.id));
  const owners = artOwners(edition);
  const backs = backFaceOwners(edition);
  const cards = new Map<string, SavedCard>();
  /**
   * A row saved before a back face was paired with its front (TMNT's
   * "1_2 Lost Vale" before it joined Dowsing Dagger, or a v0.1.11 row for
   * P5's "1_2_Token - The Ring Tempts You" found by file name) holds the
   * back's art as its own card. Its copies move onto the paired card, unless that card's
   * front already has copies: the back was the same physical card counted twice.
   */
  const backRows: { cardId: string; back: string; qty: number; locked: boolean }[] = [];
  let dropped = false;
  let updated = false;
  const add = (cardId: string, art: string, qty: number, locked: boolean, back?: string) => {
    const current = cards.get(cardId) ?? { cardId, locked: false, pairs: [] };
    current.locked = current.locked || locked;
    const same = current.pairs.find((pair) => pair.art === art && (pair.back ?? "") === (back ?? ""));
    if (same) same.qty += qty;
    else current.pairs.push({ art, qty, ...(back ? { back } : {}) });
    cards.set(cardId, current);
  };
  for (const row of deck.cards) {
    const pieces = row.pairs.length ? row.pairs : [{ art: "", qty: 0 }];
    let placed = false;
    for (const piece of pieces) {
      if (piece.art && backs.has(piece.art)) {
        backRows.push({ cardId: backs.get(piece.art)!, back: piece.art, qty: piece.qty, locked: row.locked });
        placed = true;
        continue;
      }
      if (piece.art && owners.has(piece.art)) {
        const owner = owners.get(piece.art)!;
        const back = piece.back && owners.get(piece.back) === owner ? piece.back : undefined;
        add(owner, piece.art, piece.qty, row.locked, back);
        placed = true;
        continue;
      }
      if (!piece.art && !known.has(row.cardId) && owners.has(row.cardId)) {
        add(owners.get(row.cardId)!, row.cardId, piece.qty, row.locked);
        placed = true;
        continue;
      }
      const named = piece.art ? cardByFileName(piece.art, edition, catalogues, deck) : null;
      if (named && "forbidden" in named) continue;
      if (named && "cardId" in named) {
        const card = edition.cards.find((item) => item.id === named.cardId);
        if (card && named.backArt) {
          backRows.push({ cardId: card.id, back: named.backArt, qty: piece.qty, locked: row.locked });
          placed = true;
          continue;
        }
        if (card) {
          add(card.id, defaultArtOf(card), piece.qty, row.locked, card.faces[1]?.defaultArt?.id);
          updated = true;
          placed = true;
          continue;
        }
      }
      if (known.has(row.cardId)) {
        const card = edition.cards.find((item) => item.id === row.cardId)!;
        if (piece.art && isPaidEdition(edition)) {
          add(row.cardId, defaultArtOf(card), piece.qty, row.locked, card.faces[1]?.defaultArt?.id);
          updated = true;
        } else add(row.cardId, piece.art, piece.qty, row.locked, piece.back);
        placed = true;
      }
    }
    if (!placed) dropped = true;
  }
  const frontCounted = new Set([...cards.values()].filter((card) => card.pairs.some((pair) => pair.qty > 0)).map((card) => card.cardId));
  for (const row of backRows) {
    const card = edition.cards.find((item) => item.id === row.cardId)!;
    // Only the renamed Hydroelectric pair folds its old back row in the deck's print set. Every other
    // card's back row is handled exactly as before v0.1.28 (TMNT's Lost Vale, X-Men's Joshua, and so on).
    const renamed = isKnownUnprefixedPair(card);
    const back = renamed ? backInTone(card, row.back, deck.tone) : row.back;
    if (frontCounted.has(card.id)) {
      const current = cards.get(card.id)!;
      current.locked = current.locked || row.locked;
      if (renamed) {
        // The old Laboratory row was the same physical card as Specimen's copies. Its back file
        // goes onto those copies when they have no back, or one of the other print set, so a
        // Black and White deck keeps its Black and White Laboratory.
        current.pairs = current.pairs.map((pair) => (!pair.back || wrongTone(card, pair.back, deck.tone) ? { ...pair, ...(back ? { back } : {}) } : pair));
      }
    } else add(card.id, defaultArtOf(card), row.qty, row.locked, back);
    updated = true;
  }
  if (deck.tone) {
    // The renamed pair saved before it had a back face (SxF's Specimen before v0.1.28) has
    // pairs with no back. In a deck with a tone they take the back face's file in that tone,
    // not the face's default file, which is the Color one. A Color deck's pairs are left as they were.
    for (const current of cards.values()) {
      const card = edition.cards.find((item) => item.id === current.cardId);
      if (!card || !isKnownUnprefixedPair(card)) continue;
      // Without a back the pair prints the face's default file, so only a different file is written.
      const toned = card?.faces[1] ? toneBackId(card, deck.tone) : "";
      if (!card || !toned || toned === defaultBackId(card)) continue;
      current.pairs = current.pairs.map((pair) => (pair.back ? pair : { ...pair, back: toned }));
    }
  }
  const notes = [dropped ? "Some saved cards were dropped." : "", updated ? UPDATED_ART : ""].filter(Boolean);
  return { deck: { ...deck, cards: [...cards.values()] }, note: notes.join(" ") || null };
}

function resolvePinned(
  draft: SavedDeck,
  packs: UnlockedPack[],
  catalogues: DeckCatalogue[],
): { deck: SavedDeck; edition: Edition | null; catalogue: DeckCatalogue | null; note: string | null } {
  const pack = packs.find((item) => packOwnsHash(item, draft.packHash!));
  if (!pack) return { deck: draft, edition: null, catalogue: null, note: MISSING_PACK_NOTE };
  const hash = canonicalPackHash(pack);
  const owned = catalogues.flatMap((catalogue) => catalogue.editions).filter((edition) => edition.packHash === hash || edition.packHash === draft.packHash);
  const local = owned.length ? owned : pack.catalogue.editions;
  let edition: Edition | undefined;
  if (draft.editionId === "deluxe") {
    const deluxe = local.filter(isDeluxeEdition);
    if (deluxe.length !== 1) return { deck: draft, edition: null, catalogue: null, note: LEGACY_DELUXE_NOTE };
    edition = deluxe[0];
  } else {
    edition = local.find((item) => item.printType === draft.printType && pinnedSourceId(item) === draft.editionId);
  }
  if (!edition) return { deck: draft, edition: null, catalogue: null, note: MISSING_PACK_NOTE };
  const reconciled = reconcileSavedCards(draft, edition, catalogues);
  return {
    deck: {
      ...fillBlankArt(reconciled.deck, edition),
      editionId: pinnedSourceId(edition),
      editionName: edition.name,
      packHash: hash,
    },
    edition,
    catalogue: pack.catalogue,
    note: reconciled.note,
  };
}

/** Find the pack this deck was saved from, and refresh its label when that edition's name changes. */
export function resolveSavedDeck(
  draft: SavedDeck,
  packs: UnlockedPack[],
  catalogues: DeckCatalogue[],
): { deck: SavedDeck; edition: Edition | null; catalogue: DeckCatalogue | null; note: string | null } {
  if (draft.packHash) return resolvePinned(draft, packs, catalogues);
  let current = draft;
  if (current.editionId === "deluxe") {
    const legacy = resolveLegacyDeluxe(current, catalogues);
    if (legacy.note) return { deck: current, edition: null, catalogue: null, note: legacy.note };
    current = legacy.deck;
  }
  const catalogue = catalogues.find((item) => item.id === current.deckId) ?? null;
  const edition = catalogue?.editions.find((item) => item.printType === current.printType && (item.sourceId ?? item.id) === current.editionId) ?? null;
  if (!edition || !catalogue) return { deck: current, edition: null, catalogue: null, note: null };
  if (!picksFit(current, edition) && isPaidEdition(edition)) {
    return {
      deck: current,
      edition: null,
      catalogue: null,
      note: "This saved deck's art isn't in the edition that shares its id. Unlock the folder it was built from, then open it again.",
    };
  }
  const reconciled = reconcileSavedCards(current, edition, catalogues);
  current = reconciled.deck;
  const droppedNote = reconciled.note;
  if (!picksFit(current, edition)) {
    if (isPaidEdition(edition)) {
      return {
        deck: current,
        edition: null,
        catalogue: null,
        note: "This saved deck's art isn't in the edition that shares its id. Unlock the folder it was built from, then open it again.",
      };
    }
    const cleaned = withoutMissingPicks(current, edition);
    return {
      deck: fillBlankArt(cleaned.deck, edition),
      edition,
      catalogue,
      note: droppedNote ?? `Opened with this edition's default art. These picks aren't in the edition: ${cleaned.dropped.join(", ")}.`,
    };
  }
  return {
    deck: {
      ...fillBlankArt(current, edition),
      editionId: pinnedSourceId(edition),
      editionName: edition.name,
      packHash: edition.packHash ?? current.packHash,
    },
    edition,
    catalogue,
    note: droppedNote,
  };
}

/**
 * Persist a resolution only when it changes the deck. A note means write nothing.
 * A deck whose art is not in the resolved edition is not pinned, so a v0.1.4 save cannot be attached to the wrong pack.
 */
export function migrateSavedDecks(saved: SavedDeck[], packs: UnlockedPack[], catalogues: DeckCatalogue[]): SavedDeck[] | null {
  let changed = false;
  const next = saved.map((deck) => {
    const resolved = resolveSavedDeck(deck, packs, catalogues);
    if (!resolved.edition) return deck;
    const updated = resolved.deck;
    const cardsChanged =
      updated.cards.length !== deck.cards.length ||
      updated.cards.some((card, index) => {
        const previous = deck.cards[index];
        return card.cardId !== previous?.cardId || JSON.stringify(card.pairs) !== JSON.stringify(previous?.pairs);
      });
    if (resolved.note?.includes("Some saved cards were dropped")) return deck;
    if (resolved.note && !cardsChanged) return deck;
    if (!picksFit(deck, resolved.edition) && !cardsChanged) return deck;
    if (cardsChanged || updated.editionId !== deck.editionId || updated.editionName !== deck.editionName || updated.packHash !== deck.packHash) {
      changed = true;
      return { ...updated, updatedAt: deck.updatedAt };
    }
    return deck;
  });
  return changed ? next : null;
}

function ownedEdition(edition: Edition, pack: UnlockedPack | null, id: string, packName: string, existing: Edition[]): Edition {
  // A pack unlocked before a source rename (SxF's Hydroelectric pair) was stored with its faces apart. Pairing is idempotent.
  const paired = pairLooseFaces(edition.cards).cards;
  return labeledEdition(
    {
      ...edition,
      cards: paired,
      id,
      sourceId: edition.sourceId ?? edition.id,
      packHash: pack ? canonicalPackHash(pack) : edition.packHash,
      origin: "unlocked",
    },
    packName,
    existing,
  );
}

/**
 * Shipped standard wins over a re-imported copy of the same free edition.
 * Unlocked packs are numbered by first-unlock time, not by paste order.
 */
export function mergeCatalogues(shipped: DeckCatalogue[], unlocked: Array<DeckCatalogue | UnlockedPack>): DeckCatalogue[] {
  const byKey = new Map<string, DeckCatalogue>();
  for (const deck of shipped) {
    byKey.set(normalizeKey(deck.name), {
      ...deck,
      editions: deck.editions.map((edition) => ({ ...edition, origin: "shipped" as const })),
    });
  }
  const ordered = unlocked
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aTime = isUnlockedPack(a.item) ? a.item.savedAt : "";
      const bTime = isUnlockedPack(b.item) ? b.item.savedAt : "";
      if (aTime !== bTime) {
        if (!aTime) return 1;
        if (!bTime) return -1;
        return aTime < bTime ? -1 : 1;
      }
      return a.index - b.index;
    });
  for (const { item } of ordered) {
    const source = catalogueOf(item);
    const pack = source.pack;
    const deck = source.catalogue;
    const key = normalizeKey(deck.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...deck,
        editions: deck.editions.map((edition) => ownedEdition(edition, pack, edition.id, deck.name, [])),
      });
      continue;
    }
    const editions = [...existing.editions];
    for (const edition of deck.editions) {
      const index = editions.findIndex((candidate) => candidate.id === edition.id && candidate.printType === edition.printType);
      if (index !== -1 && editions[index]?.origin === "shipped") continue;
      if (index === -1) {
        editions.push(ownedEdition(edition, pack, edition.id, deck.name, editions));
        continue;
      }
      const taken = new Set(editions.map((candidate) => candidate.id));
      const id = claimEditionId(edition.id, taken, false);
      editions.push(ownedEdition(edition, pack, id, deck.name, editions));
    }
    byKey.set(key, { ...existing, editions });
  }
  return [...byKey.values()];
}

export function editionKey(deckId: string, edition: Pick<Edition, "id" | "printType">): string {
  return `${deckId}:${edition.printType}:${edition.id}`;
}

function readJson(store: Store, key: string): unknown {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function clampQty(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  return Number.isFinite(raw) ? Math.min(99, Math.max(0, Math.trunc(raw))) : 0;
}

function parseSavedCard(value: unknown): SavedCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  if (typeof card.cardId !== "string" || !card.cardId) return null;
  const locked = card.locked === true;
  if (Array.isArray(card.pairs)) {
    const pairs = card.pairs.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const pair = item as Record<string, unknown>;
      const art = typeof pair.art === "string" ? pair.art.trim() : "";
      const back = typeof pair.back === "string" && pair.back.trim() ? pair.back.trim() : undefined;
      return [{ art, qty: clampQty(pair.qty), ...(back ? { back } : {}) }];
    });
    return pairs.length ? { cardId: card.cardId, locked, pairs } : null;
  }
  let front = "";
  let back = "";
  if (card.arts && typeof card.arts === "object") {
    for (const [faceId, artId] of Object.entries(card.arts)) {
      if (typeof artId !== "string" || !artId.trim()) continue;
      if (/:back$/i.test(faceId)) back = artId.trim();
      else if (!front) front = artId.trim();
      else if (!back) back = artId.trim();
    }
  }
  if (!front) return null;
  return { cardId: card.cardId, locked, pairs: [{ art: front, qty: clampQty(card.qty), ...(back ? { back } : {}) }] };
}

/** Keeps string card id to string file id entries. Nothing (not even an empty map) when there are none, so older decks round-trip unchanged. */
function parseCardBacks(value: unknown): { cardBacks?: Record<string, string> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [cardId, fileId] of Object.entries(value as Record<string, unknown>)) {
    if (!cardId || cardId.length > 200 || cardId === "__proto__" || typeof fileId !== "string") continue;
    const id = fileId.trim();
    if (id && id.length <= 200) out[cardId] = id;
  }
  return Object.keys(out).length ? { cardBacks: out } : {};
}

function parseSavedDeck(value: unknown): SavedDeck | null {
  if (!value || typeof value !== "object") return null;
  const deck = value as Record<string, unknown>;
  if (typeof deck.id !== "string" || typeof deck.name !== "string") return null;
  if (typeof deck.deckId !== "string" || typeof deck.deckName !== "string" || typeof deck.editionId !== "string") return null;
  if (deck.printType !== "standard" && deck.printType !== "partial_foil") return null;
  if (!Array.isArray(deck.cards)) return null;
  return {
    id: deck.id,
    name: deck.name,
    deckId: deck.deckId,
    deckName: deck.deckName,
    editionId: deck.editionId,
    editionName: typeof deck.editionName === "string" ? deck.editionName : "",
    packHash: typeof deck.packHash === "string" && /^[0-9a-f]{12}$/.test(deck.packHash) ? deck.packHash : undefined,
    printType: deck.printType,
    treatment: typeof deck.treatment === "string" ? deck.treatment : null,
    cardbackId: typeof deck.cardbackId === "string" ? deck.cardbackId : null,
    printFlipBacksAsFronts: deck.printFlipBacksAsFronts === true,
    ...(typeof deck.decklistId === "string" && /^[a-z0-9-]{1,80}$/.test(deck.decklistId) ? { decklistId: deck.decklistId } : {}),
    ...(deck.tone === "color" || deck.tone === "bw" ? { tone: deck.tone } : {}),
    ...parseCardBacks(deck.cardBacks),
    cards: deck.cards.flatMap((item) => {
      const card = parseSavedCard(item);
      return card ? [card] : [];
    }),
    updatedAt: typeof deck.updatedAt === "string" && deck.updatedAt ? deck.updatedAt : FALLBACK_STAMP,
  };
}

function noteLevel(value: unknown): CatalogueNote["level"] | null {
  if (value === "ambiguous" || value === "info" || value === "skipped") return value;
  return null;
}

function isArtFile(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const art = value as Record<string, unknown>;
  return typeof art.id === "string" && typeof art.name === "string" && typeof art.thumbId === "string" && typeof art.label === "string";
}

function isFace(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const face = value as Record<string, unknown>;
  if (typeof face.id !== "string" || typeof face.name !== "string") return false;
  if (face.defaultArt != null && !isArtFile(face.defaultArt)) return false;
  return Array.isArray(face.alternates) && face.alternates.every(isArtFile);
}

function isDeckCard(value: unknown): value is DeckCatalogue["editions"][number]["cards"][number] {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.name === "string" &&
    Array.isArray(card.faces) &&
    card.faces.length > 0 &&
    card.faces.every(isFace) &&
    (card.role === "main" || card.role === "token" || card.role === "extra")
  );
}

function parseEntries(value: unknown): DecklistEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name.trim()) return [];
    const qty = clampQty(entry.qty);
    if (qty <= 0) return [];
    return [
      {
        qty,
        name: entry.name,
        ...(typeof entry.set === "string" ? { set: entry.set } : {}),
        ...(typeof entry.number === "string" ? { number: entry.number } : {}),
      },
    ];
  });
}

/** Deck lists stored with an unlocked pack. They hold card names only. */
export function parseDecklists(value: unknown): Decklist[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const list = item as Record<string, unknown>;
    if (typeof list.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(list.id)) return [];
    if (typeof list.label !== "string" || typeof list.fileName !== "string") return [];
    const parsed: Decklist = {
      id: list.id,
      label: list.label,
      fileName: list.fileName,
      ...(typeof list.title === "string" ? { title: list.title } : {}),
      commander: parseEntries(list.commander),
      main: parseEntries(list.main),
      sideboard: parseEntries(list.sideboard),
      ...(list.plain === true ? { plain: true } : {}),
    };
    return parsed.commander.length || parsed.main.length ? [parsed] : [];
  });
}

function isFoilMapCount(value: unknown): value is { found: number; total: number } {
  if (!value || typeof value !== "object") return false;
  const count = value as Record<string, unknown>;
  return Number.isInteger(count.found) && Number.isInteger(count.total) && (count.found as number) >= 0 && (count.found as number) <= (count.total as number);
}

function parseEdition(value: unknown): Edition | null {
  if (!value || typeof value !== "object") return null;
  const edition = value as Record<string, unknown>;
  if (typeof edition.id !== "string" || typeof edition.name !== "string") return null;
  if (edition.printType !== "standard" && edition.printType !== "partial_foil") return null;
  if (!Array.isArray(edition.cards)) return null;
  const backs = Array.isArray(edition.backs)
    ? edition.backs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const back = item as Record<string, unknown>;
        if (typeof back.id !== "string" || typeof back.name !== "string") return [];
        return [{ id: back.id, name: back.name, thumbId: typeof back.thumbId === "string" ? back.thumbId : back.id }];
      })
    : [];
  const notes = Array.isArray(edition.notes)
    ? edition.notes.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const note = item as Record<string, unknown>;
        const level = noteLevel(note.level);
        if (!level || typeof note.name !== "string" || typeof note.reason !== "string") return [];
        const parsed: CatalogueNote = { level, name: note.name, path: typeof note.path === "string" ? note.path : "", reason: note.reason };
        return [parsed];
      })
    : [];
  const decklists = parseDecklists(edition.decklists);
  return {
    id: edition.id,
    name: edition.name,
    printType: edition.printType,
    cards: edition.cards.filter(isDeckCard),
    backs,
    notes,
    ...(decklists.length ? { decklists } : {}),
    origin: edition.origin === "shipped" || edition.origin === "unlocked" ? edition.origin : undefined,
    ...(edition.printType === "partial_foil" && isFoilMapCount(edition.foilMaps) ? { foilMaps: { found: edition.foilMaps.found, total: edition.foilMaps.total } } : {}),
  };
}

export function parseUnlocked(value: unknown): UnlockedPack | null {
  if (!value || typeof value !== "object") return null;
  const pack = value as Record<string, unknown>;
  const folderId = typeof pack.folderId === "string" && pack.folderId ? pack.folderId : undefined;
  const givenHash = typeof pack.packHash === "string" && /^[0-9a-f]{12}$/.test(pack.packHash) ? pack.packHash : "";
  const packHashValue = givenHash || (folderId ? packHash(folderId) : "");
  if (!packHashValue) return null;
  if (!pack.catalogue || typeof pack.catalogue !== "object") return null;
  const catalogue = pack.catalogue as Record<string, unknown>;
  if (typeof catalogue.id !== "string" || typeof catalogue.name !== "string" || !Array.isArray(catalogue.editions)) return null;
  const editions = catalogue.editions.flatMap((item) => {
    const edition = parseEdition(item);
    return edition ? [edition] : [];
  });
  if (!editions.length) return null;
  const legacyHash = typeof pack.legacyHash === "string" && /^[0-9a-f]{12}$/.test(pack.legacyHash) ? pack.legacyHash : folderId ? fnvPackHash(folderId) : undefined;
  return {
    packHash: packHashValue,
    legacyHash: legacyHash && legacyHash !== packHashValue ? legacyHash : undefined,
    savedAt: typeof pack.savedAt === "string" && pack.savedAt ? pack.savedAt : FALLBACK_STAMP,
    ...(typeof pack.refreshedAt === "string" && Number.isFinite(Date.parse(pack.refreshedAt)) ? { refreshedAt: pack.refreshedAt } : {}),
    catalogue: { id: catalogue.id, name: catalogue.name, creator: "Beespair", editions },
  };
}
