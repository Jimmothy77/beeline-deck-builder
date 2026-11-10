import { describe, expect, it } from "vitest";
import { clearCounts, clearMessage, clearSummary } from "@/lib/clear";
import type { SavedCard } from "@/lib/selection";

const row = (cardId: string, ...qty: number[]): SavedCard => ({ cardId, locked: false, pairs: qty.map((n, index) => ({ art: `${cardId}-${index}`, qty: n })) });
const rows = [row("a", 2, 1), row("b", 1), row("c", 0), row("t", 4), { ...row("l", 2), locked: true }];

describe("Clear all and Clear shown", () => {
  it("Clear all leaves no row at all; Clear shown drops only the shown cards' rows and keeps the rest as they were", () => {
    expect(clearCounts(rows)).toEqual([]);
    // Locked cards and cards already at 0 go too, the same as pressing − down to 0.
    const kept = clearCounts(rows, new Set(["a", "t", "c", "l"]));
    expect(kept).toEqual([rows[1]]);
    expect(kept[0]).toBe(rows[1]);
    expect(clearCounts(rows, new Set())).toEqual(rows);
  });

  it("counts the cards and copies a clear would set to 0, skipping cards already at 0", () => {
    expect(clearSummary(rows)).toEqual({ cards: 4, copies: 10 });
    expect(clearSummary(rows, new Set(["a", "c"]))).toEqual({ cards: 1, copies: 3 });
    expect(clearSummary([])).toEqual({ cards: 0, copies: 0 });
  });

  it("says which clear it was, in the status line and on the Undo button", () => {
    expect(clearMessage("all", { cards: 3, copies: 8 })).toEqual({ status: "Cleared all: 8 copies of 3 cards set to 0. Every card in this deck is at 0 now, tokens and extras too.", undo: "Undo Clear all" });
    expect(clearMessage("shown", { cards: 1, copies: 1 })).toEqual({ status: "Cleared shown: 1 copy of the 1 card the filter shows set to 0. Cards the filter hides kept their counts.", undo: "Undo Clear shown" });
  });
});
