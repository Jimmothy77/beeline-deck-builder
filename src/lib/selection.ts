import type { ArtFile, ArtTone, CardFace, DeckCard, Edition } from "@/lib/types";
import { queryFor } from "@/lib/names";
import type { XmlSlot } from "@/lib/xml";

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
      pairs: keep ? existing!.pairs : onePair(card, card.bwOnly ? 0 : 1, toneArtId(card.faces[0], tone) ?? defaultArtId(card)),
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
export function applyListQuantities(listed: Edition, previous: SavedCard[]): SavedCard[] {
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
    if (!pairs.length) return { cardId: card.id, locked: false, pairs: onePair(card, target) };
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
    let back = defaultBackId(card);
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
  options?: { printFlipBacksAsFronts?: boolean },
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
  for (const card of edition.cards) {
    const pairs = byId.get(card.id);
    if (!pairs) continue;
    const front = card.faces[0];
    if (!front) continue;
    const backFace = card.faces[1];
    for (const pair of pairs) {
    if (pair.qty <= 0) continue;
    const frontArt = chosenArt(front, pair.art);
    if (!frontArt) continue;
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

export function countCopies(selected: SavedCard[]): number {
  return selected.reduce((sum, card) => sum + copyCount(card), 0);
}
