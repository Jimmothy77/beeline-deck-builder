/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderView } from "@/components/BuilderView";
import { freshDraft } from "@/lib/draft";
import type { SavedDeck } from "@/lib/storage";
import type { CardFace, CardRole, DeckCard, DeckCatalogue, Edition } from "@/lib/types";

// Made-up ids. None of them is shaped like a Drive id.
function face(id: string, name: string): CardFace {
  return { id: `face-${id}`, name, defaultArt: { id: `art-${id}`, name: `${name}.png`, thumbId: `thumb-${id}`, label: name }, alternates: [] };
}
function card(id: string, name: string, role: CardRole, back?: string): DeckCard {
  const faces = [face(id, name)];
  if (back) faces.push(face(`${id}-b`, back));
  return { id: `card-${id}`, name: back ? `${name} // ${back}` : name, role, faces, defaultQty: role === "main" ? 1 : 0 };
}
function edition({ tokens = 3, extras = 4, backs = true }: { tokens?: number; extras?: number; backs?: boolean } = {}): Edition {
  const cards: DeckCard[] = [card("m1", "Akroma", "main"), card("m2", "Dowsing Dagger", "main", "Lost Vale"), card("m3", "Arcane Signet", "main")];
  for (let i = 1; i <= tokens; i += 1) cards.push(card(`t${i}`, `Token ${i}`, "token"));
  for (let i = 1; i <= extras; i += 1) cards.push(card(`x${i}`, `Extra ${i}`, "extra"));
  return { id: "ed", name: "Standard", printType: "standard", cards, backs: backs ? [{ id: "back-a", name: "card back", thumbId: "thumb-deckback" }, { id: "back-b", name: "Card Back 2", thumbId: "thumb-back-b" }] : [], notes: [] };
}
function deckOf(ed: Edition, id = "test-deck"): DeckCatalogue {
  return { id, name: "Test Deck", creator: "Beespair", editions: [ed] };
}

let host: HTMLDivElement;
let root: Root;
let media: { desktop: boolean; reduced: boolean };
let drafts: SavedDeck[];

function Harness({ ed, deckId }: { ed: Edition; deckId?: string }) {
  const [draft, setDraft] = useState(() => freshDraft(deckOf(ed, deckId), ed, "draft-1", new Date("2026-11-09T00:00:00Z")));
  return (
    <BuilderView
      draft={draft}
      edition={ed}
      onChange={(next) => {
        drafts.push(next);
        setDraft(next);
      }}
      onBack={() => undefined}
      onSave={() => undefined}
      onSaveNew={() => undefined}
      onToast={() => undefined}
    />
  );
}

function render(ed: Edition = edition(), deckId?: string) {
  act(() => root.render(<Harness ed={ed} deckId={deckId} />));
}
const desktopPane = () => document.querySelector("aside")!.previousElementSibling as HTMLElement;
const aside = () => document.querySelector("aside") as HTMLElement;
const flyout = () => document.querySelector<HTMLElement>("[data-flyout]");
const frontButton = (name: string, scope: ParentNode = desktopPane()) => scope.querySelector<HTMLButtonElement>(`button[aria-label="Choose front art 1 for ${name}"]`)!;

function hover(element: Element, pointerType = "mouse") {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
  });
}
function leave(element: Element) {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
  });
}
function press(key: string, target: EventTarget = document.activeElement ?? document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}
function click(element: Element) {
  act(() => {
    (element as HTMLElement).click();
  });
}
async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  media = { desktop: true, reduced: false };
  drafts = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? media.desktop : query.includes("reduced-motion") ? media.reduced : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
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

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const section = () => dialog()!.querySelector<HTMLElement>("[data-back-override]")!;
const kindButton = (label: string) => [...section().querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((item) => item.textContent?.startsWith(label))!;
const optionButtons = () => [...section().querySelectorAll<HTMLButtonElement>("ul button")];
const labels = () => optionButtons().map((item) => [item.querySelector("[data-back-label]")!.textContent, item.querySelector('[data-slot="badge"]')?.textContent ?? null]);
const option = (label: string) => optionButtons().find((item) => item.querySelector("[data-back-label]")!.textContent === label)!;
const lastBacks = () => drafts.at(-1)?.cardBacks;

describe("per-card back in the card editor", () => {
  it("offers Card Back, Alt Back and Token Backs, with the deck back marked and no pick to start", () => {
    render();
    click(frontButton("Akroma"));
    expect([...section().querySelectorAll('[role="group"] button')].map((item) => item.textContent)).toEqual(["Card Back 2", "Alt Back 4", "Token Backs 3"]);
    expect(kindButton("Card Back").getAttribute("aria-pressed")).toBe("true");
    expect(labels()).toEqual([
      ["card back", "Deck back"],
      ["Card Back 2", null],
    ]);
    expect(section().querySelector("[data-back-status]")!.textContent).toBe("Every copy prints with the deck back, card back.");
    expect(section().querySelector('[role="note"]')).toBeNull();
    click(kindButton("Alt Back"));
    expect(labels().map(([label]) => label)).toEqual(["Extra 1", "Extra 2", "Extra 3", "Extra 4"]);
    click(kindButton("Token Backs"));
    expect(labels().map(([label]) => label)).toEqual(["Token 1", "Token 2", "Token 3"]);
  });

  it("saves a pick, shows it on the tile and in the flyout, and clears it", async () => {
    render();
    click(frontButton("Akroma"));
    click(kindButton("Token Backs"));
    click(option("Token 2"));
    expect(lastBacks()).toEqual({ "card-m1": "art-t2" });
    expect(option("Token 2").getAttribute("aria-pressed")).toBe("true");
    expect(section().querySelector("[data-back-status]")!.textContent).toBe("Every copy prints with Token 2 on the back.");
    press("Escape");
    await tick();
    const tile = frontButton("Akroma").closest("li[data-flyout-anchor]")!;
    expect(tile.querySelector("[data-custom-back]")!.textContent).toBe("Back: Token 2");
    expect(desktopPane().querySelectorAll("[data-custom-back]")).toHaveLength(1);
    hover(frontButton("Akroma"));
    expect(flyout()!.dataset.flyoutBack).toBe("custom");
    expect(flyout()!.querySelector('[data-face="back"] img')?.getAttribute("src")).toContain("thumb-t2");
    expect(flyout()!.querySelector("[data-flyout-label]")!.textContent).toBe("Chosen back");
    leave(frontButton("Akroma"));
    click(frontButton("Akroma"));
    expect(kindButton("Token Backs").getAttribute("aria-pressed")).toBe("true");
    click([...section().querySelectorAll("button")].find((item) => item.textContent === "Use the deck back")!);
    expect(drafts.at(-1)).not.toHaveProperty("cardBacks");
    expect(section().querySelector("[data-back-status]")!.textContent).toBe("Every copy prints with the deck back, card back.");
  });

  it("keeps a double-faced card's own back unless picked, says so, and a pick replaces that face", async () => {
    render();
    click(frontButton("Dowsing Dagger // Lost Vale"));
    expect(section().querySelector("[data-back-status]")!.textContent).toBe("Every copy prints with its own back face, Lost Vale.");
    expect(section().querySelector('[role="note"]')!.textContent).toContain("A pick replaces Lost Vale on every copy");
    click(option("Card Back 2"));
    expect(lastBacks()).toEqual({ "card-m2": "back-b" });
    press("Escape");
    await tick();
    const backThumb = desktopPane().querySelector('button[aria-label="Choose back art 1 for Dowsing Dagger // Lost Vale"]')!;
    expect(backThumb.textContent).toBe("Card Back 2");
    hover(frontButton("Dowsing Dagger // Lost Vale"));
    expect(flyout()!.dataset.flyoutBack).toBe("custom");
    expect(flyout()!.querySelectorAll('[data-face="back"]')).toHaveLength(1);
    leave(frontButton("Dowsing Dagger // Lost Vale"));
    click(frontButton("Dowsing Dagger // Lost Vale"));
    click([...section().querySelectorAll("button")].find((item) => item.textContent === "Use its own back face")!);
    expect(drafts.at(-1)).not.toHaveProperty("cardBacks");
  });

  it("does not offer a token as its own back", () => {
    render();
    click(aside().querySelector('button[aria-label="More copies of Token 1 art 1"]')!);
    click(aside().querySelector('button[aria-label="Choose art 1 for Token 1"]')!);
    expect(section()).not.toBeNull();
    click(kindButton("Token Backs"));
    expect(labels().map(([label]) => label)).toEqual(["Token 2", "Token 3"]);
  });

  it("adds nothing to a tile or the page without a pick", () => {
    render();
    expect(document.querySelectorAll("[data-custom-back]")).toHaveLength(0);
    expect(document.querySelector("[data-back-override]")).toBeNull();
  });
});

describe("Color and Black and White decks (SxF-style print sets)", () => {
  type Tone = "color" | "bw";
  const art = (id: string, name: string, tone?: Tone) => ({ id: `art-${id}`, name: `${name}.png`, thumbId: `thumb-${id}`, label: name, ...(tone ? { tone } : {}) });
  const twoTone = (id: string, name: string) => ({ id: `face-${id}`, name, defaultArt: art(`${id}-c`, name, "color"), alternates: [art(`${id}-w`, name, "bw")] });
  function toned(): Edition {
    const plain = (id: string, name: string) => ({ id: `face-${id}`, name, defaultArt: art(id, name), alternates: [] });
    const cards: DeckCard[] = [
      { id: "card-m1", name: "Akroma", role: "main", defaultQty: 1, faces: [plain("m1", "Akroma")] },
      { id: "card-m2", name: "Specimen // Laboratory", role: "main", defaultQty: 1, faces: [plain("m2", "Specimen"), twoTone("m2-b", "Laboratory")] },
      { id: "card-t1", name: "Token - Ring // Tempts", role: "token", defaultQty: 0, faces: [plain("t1", "Token - Ring"), twoTone("t1-b", "Tempts")] },
      { id: "card-t2", name: "Token - Gold", role: "token", defaultQty: 0, faces: [twoTone("t2", "Token - Gold")] },
    ];
    return { id: "ed", name: "Standard", printType: "standard", cards, backs: [{ id: "back-a", name: "card back", thumbId: "thumb-deckback" }], notes: [] };
  }
  const toneButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Print set"] button')].find((item) => item.textContent?.trim() === label)!;
  const rowOf = (cardId: string) => drafts.at(-1)!.cards.find((item) => item.cardId === cardId)!;

  it("starts a new art row and a newly added card on the back face in the deck's tone", () => {
    render(toned());
    click(toneButton("Black and White"));
    expect(drafts.at(-1)!.tone).toBe("bw");
    const add = [...desktopPane().querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "Add another art" && item.closest("li")?.textContent?.includes("Specimen"))!;
    click(add);
    expect(rowOf("card-m2").pairs.map((pair) => pair.back)).toEqual(["art-m2-b-w", "art-m2-b-w"]);
    click(document.querySelector('button[aria-label="More copies of Token - Ring // Tempts art 1"]')!);
    expect(rowOf("card-t1").pairs).toEqual([{ art: "art-t1", qty: 1, back: "art-t1-b-w" }]);
  });

  it("moves a picked back to the same card's file in the new tone", () => {
    render(toned());
    click(frontButton("Akroma"));
    click(kindButton("Token Backs"));
    click(option("Token - Gold"));
    expect(lastBacks()).toEqual({ "card-m1": "art-t2-c" });
    click(toneButton("Black and White"));
    expect(drafts.at(-1)!.tone).toBe("bw");
    expect(lastBacks()).toEqual({ "card-m1": "art-t2-w" });
    click(toneButton("Color"));
    expect(lastBacks()).toEqual({ "card-m1": "art-t2-c" });
  });

  it("switches tone without adding a cardBacks key to a deck with no picks", () => {
    render(toned());
    click(toneButton("Black and White"));
    expect("cardBacks" in drafts.at(-1)!).toBe(false);
  });
});

describe("hand token overrides in the card editor", () => {
  it("uses the deck's hand decisions: Persona 5's Lands is an Alt Back even from a Tokens folder", () => {
    const ed = edition({ tokens: 1, extras: 1 });
    ed.cards.push(card("t9", "Lands", "token"));
    render(ed, "persona-5");
    click(frontButton("Akroma"));
    expect(kindButton("Alt Back").textContent).toBe("Alt Back 2");
    click(kindButton("Alt Back"));
    expect(labels().map(([label]) => label)).toEqual(["Extra 1", "Lands"]);
    click(option("Lands"));
    expect(section().querySelector("[data-back-status]")!.textContent).toContain("Lands");
    expect(kindButton("Alt Back").getAttribute("aria-pressed")).toBe("true");
    press("Escape");
    expect(dialog()).toBeNull();
    click(frontButton("Akroma"));
    expect(kindButton("Alt Back").getAttribute("aria-pressed")).toBe("true");
  });
});
