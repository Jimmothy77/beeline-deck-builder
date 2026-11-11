import { slug } from "@/lib/names";

/**
 * Other names Beespair's folders use for a shipped deck, by slug: the paid edition folders say
 * "2_P5 Deluxe Edition" and "3_Spy x Family Partial Foil Edition", the shipped decks are Persona 5 and SxF.
 * Used for the splash and for naming a deck built from a Standard folder's own name. Saved decks and the
 * unlocked catalogues keep the ids they were made with.
 */
export const DECK_ALIASES: Readonly<Record<string, { id: string; name: string }>> = {
  p5: { id: "persona-5", name: "Persona 5" },
  "spy-x-family": { id: "sxf", name: "SxF" },
};

/** The shipped deck id for a deck id or alias slug ("p5" → "persona-5"); anything else unchanged. */
export function canonicalDeckId(id: string): string {
  return Object.hasOwn(DECK_ALIASES, id) ? DECK_ALIASES[id]!.id : id;
}

/** The shipped deck name for a cleaned folder name ("Spy x Family" → "SxF"); anything else unchanged. */
export function canonicalDeckName(name: string): string {
  const key = slug(name);
  return Object.hasOwn(DECK_ALIASES, key) ? DECK_ALIASES[key]!.name : name;
}
