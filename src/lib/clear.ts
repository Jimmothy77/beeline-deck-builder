import { copyCount, type SavedCard } from "@/lib/selection";

/**
 * Clear all and Clear shown in the deck view. A card at 0 copies has no saved
 * row, the same as after pressing − down to 0, so a cleared deck saves the way
 * an empty one always has. Per-card back picks are kept.
 */
export type ClearScope = "all" | "shown";

/** The saved rows after clearing: every row, or only the rows of the given cards. */
export function clearCounts(selected: SavedCard[], cardIds?: ReadonlySet<string>): SavedCard[] {
  if (!cardIds) return [];
  return selected.filter((card) => !cardIds.has(card.cardId));
}

/** How many cards and copies a clear would set to 0. */
export function clearSummary(selected: SavedCard[], cardIds?: ReadonlySet<string>): { cards: number; copies: number } {
  const hit = selected.filter((card) => (!cardIds || cardIds.has(card.cardId)) && copyCount(card) > 0);
  return { cards: hit.length, copies: hit.reduce((sum, card) => sum + copyCount(card), 0) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The status line after a clear, and its Undo button. The two scopes read differently on purpose. */
export function clearMessage(scope: ClearScope, done: { cards: number; copies: number }): { status: string; undo: string } {
  if (scope === "all") {
    return {
      status: `Cleared all: ${plural(done.copies, "copy", "copies")} of ${plural(done.cards, "card")} set to 0. Every card in this deck is at 0 now, tokens and extras too.`,
      undo: "Undo Clear all",
    };
  }
  return {
    status: `Cleared shown: ${plural(done.copies, "copy", "copies")} of the ${plural(done.cards, "card")} the filter shows set to 0. Cards the filter hides kept their counts.`,
    undo: "Undo Clear shown",
  };
}
