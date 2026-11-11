import { TOKEN_LOOKUP } from "@/data/token-lookup";
import { TOKEN_OVERRIDES } from "@/data/token-overrides";
import { normalizeKey, parsePrintName } from "@/lib/names";
import type { DeckCard } from "@/lib/types";
import { own } from "@/lib/own";

/**
 * Which extras are tokens. A one-time cross-reference against Scryfall
 * (scripts/token-lookup.ts) is committed as a static lookup in
 * src/data/token-lookup.ts. The app never calls Scryfall. A name Scryfall did
 * not match, or matched both as a token and as a card, falls back to the
 * folder and name heuristic BeeLine used before: a card from a Tokens folder,
 * or a name that starts with "Token". A few cards were decided by hand
 * (src/data/token-overrides.ts, by deck id and exact card name); those win
 * over both.
 */

export type TokenLookupEntry = {
  /** The name sent to Scryfall. */
  query: string;
  /** Scryfall counts it as a token (layout token, double_faced_token or emblem, or "Token" in its type line). */
  token: boolean;
  /** Scryfall's name for the card it matched. */
  scryfall: string;
  layout: string;
  typeLine: string;
  /** Set when Scryfall has no clear answer: a token and a game card share the exact name, or the only match is not a game card (art card, vanguard). The heuristic decides then. */
  ambiguous?: string;
};

/** A hand decision for one card: the deck's id (public/decks/<id>.json) and the card's exact name. */
export type TokenOverride = { deck: string; card: string; token: boolean };

export type TokenSource = "override" | "scryfall" | "heuristic";
export type TokenVerdict = { token: boolean; source: TokenSource; query: string; entry?: TokenLookupEntry; override?: TokenOverride };

/**
 * The name to look up: no face prefix, no "Token - " or "Extra - " label, no
 * "(theme)" and no trailing art numbers. "Token - Treasure 2" is "Treasure",
 * "Arcane Signet (Bracelet of Hope)" is "Arcane Signet".
 */
export function tokenQueryName(name: string): string {
  let s = parsePrintName(`${name}.png`).stem;
  s = s.replace(/^\d+_/, "");
  s = s.split(/\s*\/\/\s*/).map((part) => part.replace(/^\s*(token|extra)\s*[-–:]\s*/i, "")).join(" // ");
  s = s.replace(/\s*\([^)]*\)/g, " ");
  s = s.replace(/(\s+\d+)+\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

export function tokenLookupKey(name: string): string {
  return normalizeKey(tokenQueryName(name));
}

/** The names a card is looked up by, in order: its front face, then the card name. */
export function tokenQueryNames(card: Pick<DeckCard, "name" | "faces">): string[] {
  const names = [card.faces[0]?.name, card.name].filter((item): item is string => Boolean(item && item.trim()));
  const out: string[] = [];
  for (const name of names) {
    const query = tokenQueryName(name);
    if (query && !out.some((item) => normalizeKey(item) === normalizeKey(query))) out.push(query);
  }
  return out;
}

/** BeeLine's folder and name rule, used when Scryfall has no clear answer. */
export function heuristicIsToken(card: Pick<DeckCard, "name" | "role">): boolean {
  return card.role === "token" || /^\s*token\b/i.test(card.name);
}

/** The hand decision for this card in this deck, if there is one. Only an exact deck id and card name match. */
export function tokenOverride(card: Pick<DeckCard, "name" | "role">, deckId: string | null | undefined, overrides: readonly TokenOverride[] = TOKEN_OVERRIDES): TokenOverride | undefined {
  if (!deckId || card.role === "main") return undefined;
  return overrides.find((item) => item.deck === deckId && item.card === card.name);
}

export function tokenVerdict(
  card: Pick<DeckCard, "name" | "role" | "faces">,
  lookup: Readonly<Record<string, TokenLookupEntry>> = TOKEN_LOOKUP,
  deckId?: string | null,
  overrides: readonly TokenOverride[] = TOKEN_OVERRIDES,
): TokenVerdict {
  const queries = tokenQueryNames(card);
  const override = tokenOverride(card, deckId, overrides);
  if (override) return { token: override.token, source: "override", query: queries[0] ?? card.name, override };
  for (const query of queries) {
    const entry = own(lookup, normalizeKey(query));
    if (entry && !entry.ambiguous) return { token: entry.token, source: "scryfall", query, entry };
  }
  return { token: heuristicIsToken(card), source: "heuristic", query: queries[0] ?? card.name };
}

/** Token or not, for the Token Backs and Alt Back lists. Pass the deck id so hand decisions apply. */
export function isTokenCard(card: Pick<DeckCard, "name" | "role" | "faces">, deckId?: string | null): boolean {
  return tokenVerdict(card, TOKEN_LOOKUP, deckId).token;
}
