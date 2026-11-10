// Hand-kept token decisions for names the Scryfall cross-reference had no clear answer for.
// They win over the lookup in token-lookup.ts and over the folder and name heuristic.
// scripts/token-lookup.ts never rewrites this file; its --check fails when an entry matches no card.
// Each entry is a deck id and an exact card name from public/decks/<deck>.json (a token or extra, never a main card).
import type { TokenOverride } from "@/lib/tokens";

export const TOKEN_OVERRIDES: readonly TokenOverride[] = [
  { deck: "persona-5", card: "Raphael", token: true },
  { deck: "persona-5", card: "Thor", token: true },
  { deck: "persona-5", card: "Titania", token: true },
  { deck: "persona-5", card: "Lands", token: false },
  { deck: "silksong", card: "Blood (Infection)", token: true },
  { deck: "vader", card: "Shapeshifter 1", token: true },
  { deck: "vader", card: "Shapeshifter 2", token: true },
  { deck: "vader", card: "Shapeshifter 3", token: true },
  { deck: "vader", card: "Shapeshifter 4", token: true },
  { deck: "vader", card: "Shapeshifter 5", token: true },
  { deck: "vader", card: "Shapeshifter 6", token: true },
  { deck: "vader", card: "Shapeshifter 7", token: true },
  { deck: "vader", card: "Shapeshifter 8", token: true },
  { deck: "vader", card: "Shapeshifter 9", token: true },
];
