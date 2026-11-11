/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderView } from "@/components/BuilderView";
import { freshDraft } from "@/lib/draft";
import { selectionToSlots } from "@/lib/selection";
import type { SavedDeck } from "@/lib/storage";
import type { CardFace, CardRole, DeckCard, DeckCatalogue, Edition } from "@/lib/types";
import { loadCardLookup, setCardLookupImportForTests } from "@/lib/use-card-lookup";

// Made-up ids. None of them is shaped like a Drive id. The names are real cards, so the committed card lookup knows them,
// except Turtle Van, which Scryfall has no card for.
function face(id: string, name: string): CardFace {
  return { id: `face-${id}`, name, defaultArt: { id: `art-${id}`, name: `${name}.png`, thumbId: `thumb-${id}`, label: name }, alternates: [] };
}
function card(id: string, name: string, role: CardRole, qty = role === "main" ? 1 : 0, back?: string): DeckCard {
  const faces = [face(id, name)];
  if (back) faces.push(face(`${id}-b`, back));
  return { id: `card-${id}`, name: back ? `${name} // ${back}` : name, role, faces, defaultQty: qty };
}
const EDITION: Edition = {
  id: "ed",
  name: "Standard",
  printType: "standard",
  cards: [
    card("sol", "Sol Ring (Bracelet of Hope)", "main", 2),
    card("sig", "Arcane Signet", "main"),
    card("spec", "Hydroelectric Specimen (Melinda Desmond, Former First Lady)", "main", 1, "Hydroelectric Laboratory (Exclusive Circle)"),
    card("van", "Turtle Van", "main", 3),
    card("tower", "Command Tower", "main", 0),
    card("spirit", "Token - Spirit 1", "token", 2),
    card("greaves", "Lightning Greaves", "extra", 1),
  ],
  backs: [{ id: "back-a", name: "card back", thumbId: "thumb-deckback" }],
  notes: [],
};
const DECK: DeckCatalogue = { id: "test-deck", name: "Test Deck", creator: "Beespair", editions: [EDITION] };

let host: HTMLDivElement;
let root: Root;
let drafts: SavedDeck[];
let toasts: string[];

function Harness() {
  const [draft, setDraft] = useState(() => freshDraft(DECK, EDITION, "draft-1", new Date("2026-11-10T00:00:00Z")));
  return (
    <BuilderView
      draft={draft}
      edition={EDITION}
      onChange={(next) => {
        drafts.push(next);
        setDraft(next);
      }}
      onBack={() => undefined}
      onSave={() => undefined}
      onSaveNew={() => undefined}
      onToast={(message) => toasts.push(message)}
    />
  );
}
async function render() {
  await act(async () => {
    await loadCardLookup();
  });
  act(() => root.render(<Harness />));
}
function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  act(() => (element as HTMLElement).click());
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim().startsWith(text));
const searchBox = () => document.querySelector<HTMLInputElement>('input[aria-label="Search this deck"]')!;
function search(text: string) {
  const box = searchBox();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const total = () => [...document.querySelectorAll("p")].find((item) => /^\d+ cards?/.test(item.textContent?.trim() ?? ""))!.textContent!.trim();
const desktopPane = () => document.querySelector("aside")!.previousElementSibling as HTMLElement;
const tileNames = () => [...desktopPane().querySelectorAll("li[data-flyout-anchor] > div > p")].map((item) => item.textContent);
const sideNames = () => [...document.querySelector("aside")!.querySelectorAll("li[data-flyout-anchor] > p")].map((item) => item.textContent);
/** On desktop the extras sit behind one tile: its summary, or the empty line when the filter leaves none. */
const extrasTile = () => document.querySelector("[data-side-tile-summary]")?.textContent ?? document.querySelector("aside")!.textContent!.match(/No extras match the filter\./)?.[0] ?? null;
function addGreaves() {
  click(document.querySelector('[data-side-tile="extras"] button[aria-haspopup]'));
  click(document.querySelector('button[aria-label="More copies of Lightning Greaves art 1"]'));
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}
const status = () => document.querySelector("[data-clear-undo]")?.textContent ?? null;
const last = () => drafts[drafts.length - 1]!;
const copies = (draft: SavedDeck) => Object.fromEntries(draft.cards.map((item) => [item.cardId, item.pairs.reduce((sum, pair) => sum + pair.qty, 0)]));
/** The cards the order XML would hold for the deck as it is now (the made-up ids here are not Drive-shaped, so the export dialog itself would refuse them). */
function exportedQuantity(): string {
  const slots = selectionToSlots(EDITION, last().cards, { cardback: "back-a" });
  return slots.length ? String(slots.length) : "nothing to export";
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  drafts = [];
  toasts = [];
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Clear all", () => {
  it("sits with the count controls, sets every count to 0 at once, and Undo brings back exactly what was there", async () => {
    await render();
    const row = button("All cards")!.parentElement!;
    expect([...row.querySelectorAll("button")].map((item) => item.textContent?.trim())).toEqual(["All cards", "Random", "Clear all", "Save", "Save as new", "Export XML"]);
    // Give a token and an extra a count, so Clear all has to clear them too.
    click(document.querySelector('button[aria-label="More copies of Token - Spirit 1 art 1"]'));
    addGreaves();
    const before = last();
    expect(total()).toMatch(/^9 cards/);
    expect(exportedQuantity()).toBe("9");
    click(button("Clear all"));
    expect(last().cards).toEqual([]);
    expect(total()).toBe("0 cards");
    expect(exportedQuantity()).toBe("nothing to export");
    expect(status()).toContain("Cleared all: 9 copies of 6 cards set to 0. Every card in this deck is at 0 now, tokens and extras too.");
    expect(button("Clear all")!.disabled).toBe(true);
    click(button("Undo Clear all"));
    expect(last().cards).toEqual(before.cards);
    expect(total()).toMatch(/^9 cards/);
    expect(exportedQuantity()).toBe("9");
    expect(status()).toBeNull();
    expect(toasts).toContain("Restored every count from before Clear all.");
  });

  it("keeps per-card back picks, and drops the Undo once anything else changes", async () => {
    await render();
    click(button("Clear all"));
    expect(status()).not.toBeNull();
    click(document.querySelector('button[aria-label="More copies of Arcane Signet art 1"]'));
    expect(status()).toBeNull();
    expect(button("Undo Clear all")).toBeUndefined();
    expect(copies(last())).toEqual({ "card-sig": 1 });
  });
});

describe("the card filter", () => {
  it("reads a Scryfall-style query, shows only the matching cards, and never changes a count", async () => {
    await render();
    const saved = drafts.length;
    search("t:artifact mv<=2");
    expect(tileNames()).toEqual(["Sol Ring (Bracelet of Hope)", "Arcane Signet"]);
    expect(sideNames()).toEqual([]);
    expect(extrasTile()).toBe("1 extra, 0 added");
    expect(document.querySelector("[data-shown-count]")!.textContent).toBe("2 shown · 2 left out: Scryfall has no clear type or mana value for them (unmatched or ambiguous names)");
    search("is:dfc");
    expect(tileNames()).toEqual(["Hydroelectric Specimen (Melinda Desmond, Former First Lady) // Hydroelectric Laboratory (Exclusive Circle)"]);
    search("c:u t:creature pow=1 tou>=4");
    expect(tileNames()).toEqual(["Hydroelectric Specimen (Melinda Desmond, Former First Lady) // Hydroelectric Laboratory (Exclusive Circle)"]);
    search("is:token");
    expect(sideNames()).toEqual(["Token - Spirit 1"]);
    expect(tileNames()).toEqual([]);
    // As on Scryfall, a type matches either face: Hydroelectric Laboratory is a land.
    search("t:land");
    expect(tileNames()).toEqual(["Hydroelectric Specimen (Melinda Desmond, Former First Lady) // Hydroelectric Laboratory (Exclusive Circle)", "Command Tower"]);
    search("qty>0 t:land");
    expect(tileNames()).toEqual(["Hydroelectric Specimen (Melinda Desmond, Former First Lady) // Hydroelectric Laboratory (Exclusive Circle)"]);
    search("qty>0 is:token");
    expect(sideNames()).toEqual([]);
    expect(extrasTile()).toBe("No extras match the filter.");
    search("foo:bar");
    expect(document.querySelector("[data-query-unknown]")!.textContent).toBe("Not understood, so not used: foo:bar");
    expect(drafts.length).toBe(saved);
  });

  it("reads constructor, __proto__, toString and hasOwnProperty as plain words, never as filter keys, colors or rarities", async () => {
    await render();
    const saved = drafts.length;
    const unknown = () => document.querySelector("[data-query-unknown]")?.textContent ?? null;
    for (const word of ["constructor", "__proto__", "toString", "hasOwnProperty", "Constructor"]) {
      search(word);
      expect(tileNames(), word).toEqual([]);
      expect(unknown(), word).toBeNull();
      // A key is letters only: "__proto__:x" is a name search, the others are keys nobody knows.
      const isKey = /^[a-z]+$/i.test(word);
      search(`${word}:x`);
      expect(unknown(), word).toBe(isKey ? `Not understood, so not used: ${word}:x` : null);
      search(`c:${word}`);
      expect(unknown(), word).toBe(`Not understood, so not used: c:${word}`);
      search(`r:${word}`);
      expect(unknown(), word).toBe(`Not understood, so not used: r:${word}`);
      search(`(c:${word} or c:u)`);
      expect(unknown(), word).toBe(`Not understood, so not used: c:${word} or c:u`);
      search(`(${word}:a or ${word}:b)`);
      expect(unknown(), word).toBe(isKey ? `Not understood, so not used: ${word}:a or ${word}:b` : null);
    }
    search("");
    expect(tileNames()).toHaveLength(5);
    expect(drafts.length).toBe(saved);
  });

  it("still finds an unmatched card by name and marks it, and the attribute filters leave it out", async () => {
    await render();
    search("turtle");
    expect(tileNames()).toEqual(["Turtle Van"]);
    expect(desktopPane().querySelector("[data-facts-mark]")!.textContent).toBe("unmatched");
    search("spirit");
    expect(document.querySelector("aside [data-facts-mark]")!.textContent).toBe("ambiguous");
    search("t:creature");
    expect(tileNames()).not.toContain("Turtle Van");
    search("");
    expect(document.querySelector("[data-facts-mark]")).toBeNull();
  });

  it("is the same model in the controls and the query box", async () => {
    await render();
    click(button("Filters"));
    const panel = () => document.querySelector("[data-card-filter]")!;
    click([...panel().querySelectorAll("button")].find((item) => item.textContent === "Artifact"));
    expect(searchBox().value).toBe("t:artifact");
    click([...panel().querySelectorAll("button")].find((item) => item.textContent === "Land"));
    expect(searchBox().value).toBe("(t:artifact or t:land)");
    click([...panel().querySelectorAll("button")].find((item) => item.title === "Colorless"));
    expect(searchBox().value).toBe("c:c (t:artifact or t:land)");
    expect(tileNames()).toEqual(["Sol Ring (Bracelet of Hope)", "Arcane Signet", "Command Tower"]);
    search("r:rare c:u");
    expect([...panel().querySelectorAll('button[aria-pressed="true"]')].map((item) => item.textContent)).toEqual(["U", "any", "any", "Rare"]);
    click(button("Reset filter"));
    expect(searchBox().value).toBe("");
  });
});

describe("Clear shown", () => {
  it("only appears while filtering, zeroes only the shown cards, says so, and Undo restores them", async () => {
    await render();
    expect(button("Clear shown")).toBeUndefined();
    addGreaves();
    const before = last();
    search("t:artifact");
    expect(button("Clear shown")!.textContent!.trim()).toBe("Clear shown (3)");
    click(button("Clear shown"));
    expect(copies(last())).toEqual({ "card-spec": 1, "card-van": 3, "card-tower": 0 });
    expect(status()).toContain("Cleared shown: 4 copies of the 3 cards the filter shows set to 0. Cards the filter hides kept their counts.");
    expect(button("Undo Clear shown")).toBeDefined();
    expect(total()).toMatch(/^4 cards/);
    expect(exportedQuantity()).toBe("4");
    click(button("Undo Clear shown"));
    expect(last().cards).toEqual(before.cards);
    expect(total()).toMatch(/^8 cards/);
    expect(exportedQuantity()).toBe("8");
    // Clear all, even while filtering, still means every card.
    const row = button("All cards")!.parentElement!;
    expect([...row.querySelectorAll("button")].map((item) => item.textContent?.trim())).toEqual(["All cards", "Random", "Clear all", "Clear shown (3)", "Save", "Save as new", "Export XML"]);
    click(button("Clear all"));
    expect(last().cards).toEqual([]);
    expect(status()).toContain("Cleared all: 8 copies of 5 cards set to 0. Every card in this deck is at 0 now, tokens and extras too.");
  });
});

describe("when the card data can't load", () => {
  afterEach(() => setCardLookupImportForTests(null));

  it("says so instead of 'Loading card data…', keeps the attribute filters from hiding every card, and loads on Try again", async () => {
    let fail = true;
    const real = () => import("@/data/card-lookup");
    setCardLookupImportForTests(() => (fail ? Promise.reject(new Error("chunk failed")) : real()));
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    search("t:artifact");
    const note = () => document.querySelector("[data-lookup-failed]")?.textContent ?? null;
    expect(note()).toBe("The card data couldn't load, so the type filter is not applied: the list shows every card that matches the rest of the search. Try again, or reload the page if that doesn't work.");
    expect(document.body.textContent).not.toContain("Loading card data…");
    // Not "0 shown": the type part is set aside, so every main card is still listed.
    expect(tileNames()).toHaveLength(5);
    search("t:artifact sol");
    expect(tileNames()).toEqual(["Sol Ring (Bracelet of Hope)"]);
    search("c:u mv<=3");
    expect(note()).toContain("the color and mana value filters are not applied");
    search("");
    expect(note()).toBe("The card data couldn't load, so the color, type, mana value, rarity, rules text, power and toughness filters can't be used right now. Try again, or reload the page if that doesn't work.");
    // The failed load was not cached: Try again loads it.
    fail = false;
    await act(async () => {
      button("Try again")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await loadCardLookup();
    });
    expect(note()).toBeNull();
    search("t:artifact mv<=2");
    expect(tileNames()).toEqual(["Sol Ring (Bracelet of Hope)", "Arcane Signet"]);
    expect(drafts).toEqual([]);
  });

  it("forgets a failed load, so the next call tries the import again", async () => {
    const calls: string[] = [];
    setCardLookupImportForTests(() => {
      calls.push("import");
      return calls.length === 1 ? Promise.reject(new Error("offline")) : import("@/data/card-lookup");
    });
    await expect(loadCardLookup()).rejects.toThrow("offline");
    const lookup = await loadCardLookup();
    expect(lookup["sol ring"]).toBeDefined();
    expect(calls).toEqual(["import", "import"]);
    await loadCardLookup();
    expect(calls).toHaveLength(2);
  });
});
