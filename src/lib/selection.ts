import type { ArtFile, ArtTone, CardFace, DeckCard, Edition } from "@/lib/types";
import { queryFor } from "@/lib/names";
import { isTokenCard } from "@/lib/tokens";
import type { XmlSlot } from "@/lib/xml";
import { own } from "@/lib/own";

/** One chosen print of a card. A card can hold several, and they are not merged by hand. */
export type ArtQty = {
  /** Front file. Empty means the deck's default front. */
  art: string;
  /** Back file, when this card has a back face. */
  back?: string;
  qty: number;
};

export type SavedCard = {
  cardId: string;
  locked: boolean;
  /** Chosen arts in the order they were added. `art` empty means the deck's default file. */
  pairs: ArtQty[];
};

export function artsOf(face: CardFace): ArtFile[] {
  const all: ArtFile[] = [];
  if (face?.defaultArt) all.push(face.defaultArt);
  const alternates = Array.isArray(face?.alternates) ? face.alternates : [];
  for (const art of alternates) {
    if (art && !all.some((item) => item.id === art.id)) all.push(art);
  }
  return all;
}

export function copyCount(card: SavedCard | undefined): number {
  return card?.pairs.reduce((sum, pair) => sum + (pair.qty > 0 ? pair.qty : 0), 0) ?? 0;
}

export function defaultArtId(card: DeckCard): string {
  return card.faces[0]?.defaultArt?.id ?? card.faces[0]?.alternates[0]?.id ?? "";
}

export function defaultBackId(card: DeckCard): string {
  return card.faces[1]?.defaultArt?.id ?? card.faces[1]?.alternates[0]?.id ?? "";
}

/**
 * The back face file a new pair starts on: the back face's first file in the
 * deck's tone (SxF Color or Black and White), or its default file when the
 * deck has no tone or the face has no file in it. Every new row uses this, so
 * a Black and White deck never starts a double-faced card on a Color back.
 */
export function toneBackId(card: DeckCard, tone: ArtTone | null | undefined): string {
  return toneArtId(card.faces[1], tone) ?? defaultBackId(card);
}

/** A new pair for a card the user adds a copy or an art row to: its default front, on its back face in the deck's tone. */
export function newPair(card: DeckCard, qty: number, tone: ArtTone | null | undefined): ArtQty {
  return onePair(card, qty, defaultArtId(card), toneBackId(card, tone))[0]!;
}

function onePair(card: DeckCard, qty: number, art = defaultArtId(card), back = defaultBackId(card)): ArtQty[] {
  return [{ art, qty, ...(back ? { back } : {}) }];
}

/** Copies the designed deck prints before anyone edits a quantity. */
export function defaultMainCount(edition: Edition): number {
  return edition.cards.filter((card) => card.role === "main").reduce((sum, card) => sum + Math.max(0, card.defaultQty), 0);
}

export function oversizedDeckWarning(edition: Edition): string | null {
  const count = defaultMainCount(edition);
  if (count <= 100) return null;
  return `This deck opens with ${count} main cards, which is more than 100. Nothing was removed.`;
}

/** The designed deck: one copy of every main-deck card, on its deck art. */
export function designedSelection(edition: Edition): SavedCard[] {
  return edition.cards
    .filter((card) => card.role === "main")
    .map((card) => ({
      cardId: card.id,
      locked: false,
      pairs: onePair(card, card.defaultQty),
    }));
}

/** One copy of every card in this edition, including tokens and other extras. */
export function selectAllCards(edition: Edition, previous: SavedCard[], tone?: ArtTone | null): SavedCard[] {
  const prev = new Map(previous.map((card) => [card.cardId, card]));
  return edition.cards.map((card) => {
    const existing = prev.get(card.id);
    const keep = Boolean(existing && (existing.locked || copyCount(existing) > 0));
    return {
      cardId: card.id,
      locked: existing?.locked ?? false,
      pairs: keep ? existing!.pairs : onePair(card, card.bwOnly ? 0 : 1, toneArtId(card.faces[0], tone) ?? defaultArtId(card), toneBackId(card, tone)),
    };
  });
}

/** True when the edition ships Color and Black and White files for the same cards, as SxF does. */
export function hasToneChoice(edition: Pick<Edition, "cards" | "printType">): boolean {
  if (edition.printType !== "standard") return false;
  let color = false;
  let bw = false;
  for (const card of edition.cards) {
    for (const face of card.faces) {
      for (const art of artsOf(face)) {
        if (art.tone === "color") color = true;
        else if (art.tone === "bw") bw = true;
        if (color && bw) return true;
      }
    }
  }
  return false;
}

/** The face's first file in this tone, or null when the face has none (an always-color card, say). */
export function toneArtId(face: CardFace | undefined, tone: ArtTone | null | undefined): string | null {
  if (!face || !tone) return null;
  return artsOf(face).find((art) => art.tone === tone)?.id ?? null;
}

/**
 * Switch every pick to the Color or Black and White file of the same card.
 * Cards with only one version, such as SxF's always-color manga cards, keep
 * their art. Quantities, locks, and pairs are unchanged.
 */
export function applyTone(edition: Edition, selected: SavedCard[], tone: ArtTone): SavedCard[] {
  const byId = new Map(edition.cards.map((card) => [card.id, card]));
  return selected.map((row) => {
    const card = byId.get(row.cardId);
    if (!card) return row;
    const front = card.faces[0];
    const back = card.faces[1];
    return {
      ...row,
      pairs: row.pairs.map((pair) => {
        const frontArt = front ? chosenArt(front, pair.art) : null;
        const nextFront = frontArt && frontArt.tone && frontArt.tone !== tone ? toneArtId(front, tone) : null;
        const backArt = back ? chosenArt(back, pair.back) : null;
        const nextBack = backArt && backArt.tone && backArt.tone !== tone ? toneArtId(back, tone) : null;
        return { ...pair, ...(nextFront ? { art: nextFront } : {}), ...(nextBack ? { back: nextBack } : {}) };
      }),
    };
  });
}

/**
 * Open a different deck list. Each unlocked main card moves to that list's
 * quantity and keeps the arts it already has: copies are added to its first
 * art, or taken from its last art first, so a second art keeps its own count
 * while the total allows. Locked cards, tokens, and extras stay as they are.
 */
export function applyListQuantities(listed: Edition, previous: SavedCard[], tone?: ArtTone | null): SavedCard[] {
  const mains = listed.cards.filter((card) => card.role === "main");
  const mainIds = new Set(mains.map((card) => card.id));
  const rows = new Map<string, SavedCard>();
  for (const row of previous) {
    const seen = rows.get(row.cardId);
    rows.set(row.cardId, seen ? { ...seen, locked: seen.locked || row.locked, pairs: [...seen.pairs, ...row.pairs] } : row);
  }
  const nextMains: SavedCard[] = mains.map((card) => {
    const existing = rows.get(card.id);
    if (existing?.locked) return existing;
    const target = Math.max(0, card.defaultQty);
    const pairs = (existing?.pairs ?? []).filter((pair) => pair.qty > 0).map((pair) => ({ ...pair }));
    if (!pairs.length) return { cardId: card.id, locked: false, pairs: onePair(card, target, defaultArtId(card), toneBackId(card, tone)) };
    let have = pairs.reduce((sum, pair) => sum + pair.qty, 0);
    if (target >= have) pairs[0]!.qty += target - have;
    for (let i = pairs.length - 1; i >= 0 && have > target; i--) {
      const take = Math.min(pairs[i]!.qty, have - target);
      pairs[i]!.qty -= take;
      have -= take;
    }
    const kept = pairs.filter((pair) => pair.qty > 0);
    return { cardId: card.id, locked: false, pairs: kept.length ? kept : [{ ...pairs[0]!, qty: 0 }] };
  });
  const others = previous.filter((row) => !mainIds.has(row.cardId));
  return [...nextMains, ...others];
}

export function randomizeUnlocked(edition: Edition, previous: SavedCard[], rng: () => number, tone?: ArtTone | null): SavedCard[] {
  const prev = new Map(previous.map((card) => [card.cardId, card]));
  const mains = edition.cards.filter((card) => card.role === "main");
  const nextMains: SavedCard[] = mains.map((card) => {
    const existing = prev.get(card.id);
    const locked = existing?.locked ?? false;
    if (locked && existing) return existing;
    if (card.bwOnly) {
      if (existing && copyCount(existing) > 0) return existing;
      return { cardId: card.id, locked, pairs: onePair(card, 0) };
    }
    let art = defaultArtId(card);
    let back = toneBackId(card, tone);
    const front = card.faces[0];
    if (front) {
      const options = inTone(artsForRandom(front), tone);
      if (options.length) art = options[Math.min(options.length - 1, Math.floor(rng() * options.length))]?.id ?? art;
    }
    const backFace = card.faces[1];
    if (backFace) {
      const options = inTone(artsForRandom(backFace), tone);
      if (options.length) back = options[Math.min(options.length - 1, Math.floor(rng() * options.length))]?.id ?? back;
    }
    // A card the deck list leaves at 0 stays at 0. Without a list every main card's default is 1.
    const qty = existing && copyCount(existing) > 0 ? copyCount(existing) : Math.max(0, card.defaultQty);
    return { cardId: card.id, locked, pairs: onePair(card, qty, art, back) };
  });
  const extras = previous.filter((card) => !mains.some((main) => main.id === card.cardId));
  return [...nextMains, ...extras];
}

/** With a Color or Black and White pick, Random stays in that set. Untagged files are always allowed. */
function inTone(options: ArtFile[], tone: ArtTone | null | undefined): ArtFile[] {
  if (!tone) return options;
  const kept = options.filter((art) => !art.tone || art.tone === tone);
  return kept.length ? kept : options;
}

/** A black-and-white PDF is an alternate the user can pick. Random leaves it alone. */
function artsForRandom(face: CardFace): ArtFile[] {
  const options = artsOf(face);
  const fallback = face.defaultArt;
  if (!fallback || !/\.pdf$/i.test(fallback.name)) return options;
  return options.filter((art) => art.id === fallback.id || !/\.pdf$/i.test(art.name));
}

export function chosenArt(face: CardFace, artId: string | undefined): ArtFile | null {
  const options = artsOf(face);
  return options.find((art) => art.id === artId) ?? options[0] ?? null;
}

/** Rows whose card id is not in this edition. A second row for a known card is kept as more pairs. */
export function droppedSavedCardIds(edition: Edition, selected: SavedCard[]): string[] {
  const known = new Set(edition.cards.map((card) => card.id));
  return selected.filter((row) => !known.has(row.cardId)).map((row) => row.cardId);
}

function combinedPairs(rows: SavedCard[]): ArtQty[] {
  const pairs: ArtQty[] = [];
  for (const row of rows) {
    for (const pair of row.pairs) pairs.push({ art: pair.art, qty: pair.qty, ...(pair.back ? { back: pair.back } : {}) });
  }
  return pairs;
}

export function selectionToSlots(
  edition: Edition,
  selected: SavedCard[],
  options?: {
    printFlipBacksAsFronts?: boolean;
    /** Per-card back overrides (card id to file id). A card without one prints as before. */
    cardBacks?: Readonly<Record<string, string>>;
    /** The deck-wide back. A one-faced card whose override is this same file prints exactly as without it. */
    cardback?: string | null;
  },
): XmlSlot[] {
  const byId = new Map<string, ArtQty[]>();
  for (const row of selected) {
    if (!edition.cards.some((card) => card.id === row.cardId)) continue;
    const list = byId.get(row.cardId) ?? [];
    list.push(...combinedPairs([row]));
    byId.set(row.cardId, list);
  }
  const slots: XmlSlot[] = [];
  const promoteBacks = edition.printType === "partial_foil" && options?.printFlipBacksAsFronts === true;
  const overrides = activeBackOverrides(edition, options?.cardBacks);
  for (const card of edition.cards) {
    const pairs = byId.get(card.id);
    if (!pairs) continue;
    const front = card.faces[0];
    if (!front) continue;
    const backFace = card.faces[1];
    const override = overrides.get(card.id);
    for (const pair of pairs) {
    if (pair.qty <= 0) continue;
    const frontArt = chosenArt(front, pair.art);
    if (!frontArt) continue;
    if (override) {
      // A picked back replaces the deck back and, on a double-faced card, its own back face. It is never promoted to a front.
      const same = !backFace && override.kind === "cardback" && override.id === options?.cardback;
      for (let i = 0; i < Math.max(0, Math.floor(pair.qty)); i++) {
        slots.push({
          front: { id: frontArt.id, name: frontArt.name, query: queryFor(front.name) },
          back: same ? null : { id: override.id, name: override.name, query: override.query },
        });
      }
      continue;
    }
    const backArt = backFace ? chosenArt(backFace, pair.back) : null;
    const backIsPdf = Boolean(backArt && /\.pdf$/i.test(backArt.name));
    const asFront = promoteBacks && backIsPdf && backArt;
    const copies = Math.max(0, Math.floor(pair.qty));
    for (let i = 0; i < copies; i++) {
      slots.push({
        front: { id: frontArt.id, name: frontArt.name, query: queryFor(front.name) },
        back: asFront || !backArt ? null : { id: backArt.id, name: backArt.name, query: queryFor(backFace!.name) },
      });
    }
    if (asFront && backArt) {
      for (let i = 0; i < copies; i++) {
        slots.push({
          front: { id: backArt.id, name: backArt.name, query: queryFor(backFace!.name) },
          back: null,
        });
      }
    }
    }
  }
  return slots;
}

/** Which list a per-card back came from in the card editor. */
export type BackKind = "cardback" | "alt" | "token";

/** A file that can be printed on the back of one card instead of the deck-wide back. */
export type BackOption = { kind: BackKind; id: string; name: string; thumbId: string; label: string; query: string; cardId?: string };

export const BACK_KINDS: readonly BackKind[] = ["cardback", "alt", "token"];

/**
 * What the card editor offers as a back for `cardId`: the edition's card
 * backs, the front art of every extra that is not a token, and the front art
 * of every token. Extras and tokens are the edition's non-main cards; which
 * of them are tokens comes from the static Scryfall lookup, with the folder
 * and name rule for names it has no clear answer for. A card is never offered
 * as its own back. With a tone (SxF Color or Black and White), files of the
 * other tone are left out.
 */
export function backOptions(
  edition: Pick<Edition, "cards" | "backs">,
  cardId: string,
  tone?: ArtTone | null,
  tokenTest: (card: DeckCard) => boolean = isTokenCard,
): Record<BackKind, BackOption[]> {
  const out: Record<BackKind, BackOption[]> = { cardback: [], alt: [], token: [] };
  for (const back of edition.backs) out.cardback.push({ kind: "cardback", id: back.id, name: back.name, thumbId: back.thumbId, label: back.name, query: queryFor(back.name) });
  for (const card of edition.cards) {
    if (card.role === "main" || card.id === cardId) continue;
    const face = card.faces[0];
    if (!face) continue;
    const kind: BackKind = tokenTest(card) ? "token" : "alt";
    for (const art of inTone(artsOf(face), tone)) {
      out[kind].push({ kind, id: art.id, name: art.name, thumbId: art.thumbId, label: art.label || card.name, query: queryFor(face.name), cardId: card.id });
    }
  }
  return out;
}

/** The back a card's override points at, or null when there is none or it is not in this edition (then the card prints as if unset). */
export function resolveBackOverride(
  edition: Pick<Edition, "cards" | "backs">,
  cardId: string,
  fileId: string | undefined,
  tokenTest: (card: DeckCard) => boolean = isTokenCard,
): BackOption | null {
  if (!fileId) return null;
  const options = backOptions(edition, cardId, null, tokenTest);
  for (const kind of BACK_KINDS) {
    const hit = options[kind].find((option) => option.id === fileId);
    if (hit) return hit;
  }
  return null;
}

/** Overrides for cards in this edition that resolve, keyed by card id. */
export function activeBackOverrides(
  edition: Pick<Edition, "cards" | "backs">,
  cardBacks: Readonly<Record<string, string>> | undefined,
  tokenTest: (card: DeckCard) => boolean = isTokenCard,
): Map<string, BackOption> {
  const out = new Map<string, BackOption>();
  if (!cardBacks) return out;
  for (const card of edition.cards) {
    const hit = resolveBackOverride(edition, card.id, own(cardBacks, card.id), tokenTest);
    if (hit) out.set(card.id, hit);
  }
  return out;
}

/**
 * Per-card back picks after a tone switch. A pick on a Color or Black and
 * White file of an extra or token moves to that card's file in the new tone,
 * the way applyTone moves fronts and back faces. Card backs, untagged files,
 * and files with no version in the new tone stay put. Without picks, or when
 * nothing moves, the same object comes back, so a deck without picks is
 * saved exactly as before.
 */
export function toneCardBacks(
  edition: Pick<Edition, "cards">,
  cardBacks: Readonly<Record<string, string>> | undefined,
  tone: ArtTone,
): Readonly<Record<string, string>> | undefined {
  if (!cardBacks) return cardBacks;
  const owners = new Map<string, CardFace>();
  for (const card of edition.cards) {
    if (card.role === "main") continue;
    const face = card.faces[0];
    if (face) for (const art of artsOf(face)) if (!owners.has(art.id)) owners.set(art.id, face);
  }
  let moved = false;
  const next: Record<string, string> = {};
  for (const [cardId, fileId] of Object.entries(cardBacks)) {
    const face = owners.get(fileId);
    const art = face ? artsOf(face).find((item) => item.id === fileId) : undefined;
    const other = face && art?.tone && art.tone !== tone ? toneArtId(face, tone) : null;
    next[cardId] = other ?? fileId;
    if (other) moved = true;
  }
  return moved ? next : cardBacks;
}

export function countCopies(selected: SavedCard[]): number {
  return selected.reduce((sum, card) => sum + copyCount(card), 0);
}
