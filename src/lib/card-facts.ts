import { normalizeKey } from "@/lib/names";
import { tokenQueryNames } from "@/lib/tokens";
import type { DeckCard } from "@/lib/types";

/**
 * Card facts for the deck filter: colors, type line, mana value, rarity,
 * rules text and power/toughness. A one-time cross-reference against
 * Scryfall (scripts/card-lookup.ts) is committed as a static lookup in
 * src/data/card-lookup.ts, the same way as the token lookup. The app never
 * calls Scryfall. A field is absent when Scryfall has no value for it, or
 * when several Scryfall cards share the name and don't agree on it.
 */

export type ColorLetter = "W" | "U" | "B" | "R" | "G";
export const COLOR_ORDER: readonly ColorLetter[] = ["W", "U", "B", "R", "G"];

export type CardFacts = {
  /** The name sent to Scryfall. */
  query: string;
  /** Scryfall's name for the card it matched. */
  scryfall: string;
  layout: string;
  /** Card colors in WUBRG order; empty for a colorless card. A double-faced card has the colors of both faces. */
  colors?: ColorLetter[];
  typeLine?: string;
  cmc?: number;
  rarity?: string;
  /** Rules text; the faces of a double-faced card are joined with a line "//". */
  oracle?: string;
  /** Front face's power and toughness, as Scryfall writes them ("*", "1+*"). */
  power?: string;
  toughness?: string;
  /** Matched by a second look-up: "The <name>" exactly, or Scryfall's fuzzy name match (a missing accent or a typo in the file name). */
  fuzzy?: true;
  /** Set when Scryfall has no single answer for the name. Only the facts every match agrees on are kept. */
  ambiguous?: string;
};

export type ScryfallFace = { name: string; type_line?: string; colors?: string[]; oracle_text?: string; power?: string; toughness?: string };
export type ScryfallCard = ScryfallFace & { layout: string; cmc?: number; rarity?: string; card_faces?: ScryfallFace[] };

const FIELDS = ["colors", "typeLine", "cmc", "rarity", "oracle", "power", "toughness"] as const;

function sortColors(list: Iterable<string>): ColorLetter[] {
  const set = new Set(list);
  return COLOR_ORDER.filter((color) => set.has(color));
}

/** The facts BeeLine keeps from one Scryfall card. */
export function factsFromScryfall(card: ScryfallCard): Omit<CardFacts, "query"> {
  const faces = card.card_faces ?? [];
  const colors = card.colors ?? (faces.some((face) => face.colors) ? faces.flatMap((face) => face.colors ?? []) : undefined);
  const typeLine = card.type_line ?? (faces.length ? faces.map((face) => face.type_line ?? "").join(" // ") : undefined);
  const oracle = card.oracle_text ?? (faces.length ? faces.map((face) => face.oracle_text ?? "").join("\n//\n") : undefined);
  const power = card.power ?? faces[0]?.power;
  const toughness = card.toughness ?? faces[0]?.toughness;
  return {
    scryfall: card.name,
    layout: card.layout,
    ...(colors ? { colors: sortColors(colors) } : {}),
    ...(typeLine !== undefined ? { typeLine } : {}),
    ...(typeof card.cmc === "number" ? { cmc: card.cmc } : {}),
    ...(card.rarity ? { rarity: card.rarity } : {}),
    ...(oracle !== undefined ? { oracle } : {}),
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
  };
}

/** One entry from several Scryfall cards that share a name: only the facts they all agree on. */
export function mergeFacts(list: Omit<CardFacts, "query">[]): Omit<CardFacts, "query"> {
  const [first, ...rest] = list;
  if (!first) throw new Error("mergeFacts needs at least one card");
  if (!rest.length) return first;
  const out: Omit<CardFacts, "query"> = { scryfall: first.scryfall, layout: first.layout };
  const differ: string[] = [];
  for (const field of FIELDS) {
    const value = JSON.stringify(first[field]);
    if (rest.every((item) => JSON.stringify(item[field]) === value)) {
      if (first[field] !== undefined) Object.assign(out, { [field]: first[field] });
    } else differ.push(field);
  }
  if (!differ.length) return out;
  const names = [...new Set(list.map((item) => `${item.scryfall} (${item.layout})`))];
  out.ambiguous = `${list.length} different Scryfall cards share this name (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", ..." : ""}); they differ in ${differ.join(", ")}`;
  return out;
}

export type FactsStatus = "matched" | "ambiguous" | "unmatched";
export type ResolvedFacts = { status: FactsStatus; facts: CardFacts | null };

/** A card's facts: the first of its names (front face, then card name) with a clear entry, else the first ambiguous one. */
export function factsFor(card: Pick<DeckCard, "name" | "faces">, lookup: Readonly<Record<string, CardFacts>>): ResolvedFacts {
  let fallback: CardFacts | null = null;
  for (const query of tokenQueryNames(card)) {
    const entry = lookup[normalizeKey(query)];
    if (entry && !entry.ambiguous) return { status: "matched", facts: entry };
    if (entry && !fallback) fallback = entry;
  }
  return fallback ? { status: "ambiguous", facts: fallback } : { status: "unmatched", facts: null };
}
