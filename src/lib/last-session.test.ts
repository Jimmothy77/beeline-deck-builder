import { describe, expect, it } from "vitest";
import { LAST_SESSION_KEY, loadLastSession, loadSaved, writeLastSession, type SavedDeck } from "@/lib/storage";

function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const deck = (id: string, updatedAt: string, extra: Partial<SavedDeck> = {}): SavedDeck => ({
  id,
  name: `Deck ${id}`,
  deckId: "tmnt",
  deckName: "TMNT",
  editionId: "standard",
  editionName: "Standard",
  printType: "standard",
  treatment: null,
  cardbackId: "backimage1234",
  cards: [{ cardId: "sol", locked: false, pairs: [{ art: "solringfile1", qty: 3, back: "solbackfile1" }] }],
  cardBacks: { sol: "solbackfile1" },
  updatedAt,
  ...extra,
});

describe("Continue where you left off", () => {
  it("is nothing when nothing is saved", () => {
    expect(loadLastSession(memoryStore(), [])).toBeNull();
    expect(loadLastSession(memoryStore({ [LAST_SESSION_KEY]: "{broken" }), [])).toBeNull();
    expect(loadLastSession(memoryStore({ [LAST_SESSION_KEY]: JSON.stringify({ id: "x" }) }), [])).toBeNull();
  });

  it("keeps the deck being built with its counts and back picks, and prefers it to any saved deck", () => {
    const store = memoryStore();
    const building = deck("draft", "2026-11-01T00:00:00.000Z");
    writeLastSession(store, building);
    expect(store.data.get(LAST_SESSION_KEY)).toBe(JSON.stringify(building));
    const loaded = loadLastSession(store, [deck("newer", "2026-11-10T00:00:00.000Z")])!;
    expect(loaded.id).toBe("draft");
    expect(loaded.cards[0]!.pairs[0]).toEqual({ art: "solringfile1", qty: 3, back: "solbackfile1" });
    expect(loaded.cardBacks).toEqual({ sol: "solbackfile1" });
  });

  it("falls back to the newest saved deck for saves from before v0.1.35", () => {
    const saved = [deck("a", "2026-10-01T00:00:00.000Z"), deck("b", "2026-11-05T00:00:00.000Z"), deck("c", "2026-11-02T00:00:00.000Z")];
    expect(loadLastSession(memoryStore(), saved)!.id).toBe("b");
    expect(loadLastSession(memoryStore(), [saved[0]!])!.id).toBe("a");
  });

  it("reads an old-format deck the same way the saved list does", () => {
    const old = { ...deck("old", "2026-01-01T00:00:00.000Z"), cards: [{ cardId: "sol", qty: 2, locked: false, arts: { front: "solringfile1" } }] };
    const store = memoryStore({ [LAST_SESSION_KEY]: JSON.stringify(old), "printabee.savedDecks.v1": JSON.stringify([old]) });
    expect(loadLastSession(store, [])).toEqual(loadSaved(store)[0]);
    expect(loadLastSession(store, [])!.cards[0]!.pairs[0]!.qty).toBe(2);
  });

  it("never throws when storage is full or blocked", () => {
    const store = { getItem: () => null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); }, removeItem: () => undefined };
    expect(() => writeLastSession(store, deck("a", "2026-11-01T00:00:00.000Z"))).not.toThrow();
  });
});
