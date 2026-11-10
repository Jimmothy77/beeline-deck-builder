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
function edition({ tokens = 3, extras = 12, backs = true }: { tokens?: number; extras?: number; backs?: boolean } = {}): Edition {
  const cards: DeckCard[] = [card("m1", "Akroma", "main"), card("m2", "Dowsing Dagger", "main", "Lost Vale"), card("m3", "Arcane Signet", "main")];
  for (let i = 1; i <= tokens; i += 1) cards.push(card(`t${i}`, `Token ${i}`, "token"));
  for (let i = 1; i <= extras; i += 1) cards.push(card(`x${i}`, `Extra ${i}`, "extra"));
  return { id: "ed", name: "Standard", printType: "standard", cards, backs: backs ? [{ id: "back-a", name: "card back", thumbId: "thumb-deckback" }] : [], notes: [] };
}
function deckOf(ed: Edition): DeckCatalogue {
  return { id: "test-deck", name: "Test Deck", creator: "Beespair", editions: [ed] };
}

let host: HTMLDivElement;
let root: Root;
let media: { desktop: boolean; reduced: boolean };
let drafts: SavedDeck[];

function Harness({ ed }: { ed: Edition }) {
  const [draft, setDraft] = useState(() => freshDraft(deckOf(ed), ed, "draft-1", new Date("2026-11-09T00:00:00Z")));
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

function render(ed: Edition = edition()) {
  act(() => root.render(<Harness ed={ed} />));
}
const desktopPane = () => document.querySelector("aside")!.previousElementSibling as HTMLElement;
const aside = () => document.querySelector("aside") as HTMLElement;
const flyout = () => document.querySelector<HTMLElement>("[data-flyout]");
const frontButton = (name: string, scope: ParentNode = desktopPane()) => scope.querySelector<HTMLButtonElement>(`button[aria-label="Choose front art 1 for ${name}"]`)!;
const qtyOf = (cardId: string) => drafts.at(-1)?.cards.find((item) => item.cardId === cardId)?.pairs.reduce((sum, pair) => sum + pair.qty, 0) ?? 0;

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

describe("desktop card flyout", () => {
  it("opens on mouse hover and closes when the pointer leaves", () => {
    render();
    const button = frontButton("Akroma");
    hover(button);
    expect(flyout()).not.toBeNull();
    expect(flyout()!.querySelector('[data-face="front"] img[alt="Akroma"]')?.getAttribute("src")).toContain("thumb-m1");
    leave(button);
    expect(flyout()).toBeNull();
  });

  it("opens on keyboard focus and closes on Escape and on blur", () => {
    render();
    const button = frontButton("Akroma");
    act(() => button.focus());
    expect(flyout()).not.toBeNull();
    press("Escape", document);
    expect(flyout()).toBeNull();
    act(() => button.blur());
    act(() => button.focus());
    expect(flyout()).not.toBeNull();
    act(() => button.blur());
    expect(flyout()).toBeNull();
  });

  it("does not open for touch, or below the desktop width", () => {
    render();
    hover(frontButton("Akroma"), "touch");
    expect(flyout()).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    media.desktop = false;
    render();
    hover(frontButton("Akroma"));
    expect(flyout()).toBeNull();
    act(() => frontButton("Akroma").focus());
    expect(flyout()).toBeNull();
  });

  it("flips front, back, front, back and ends on the front, using the deck card back", () => {
    render();
    hover(frontButton("Akroma"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutMode).toBe("cardback");
    expect(layer.dataset.flyoutFaces?.split(" ").at(-1)).toBe("front");
    expect(layer.dataset.flyoutFaces).toBe("front back front back front");
    expect(layer.style.getPropertyValue("--flyout-turn")).toBe("720deg");
    expect(layer.querySelector('[data-face="back"] img')?.getAttribute("src")).toContain("thumb-deckback");
  });

  it("uses a double-faced card's own back face", () => {
    render();
    hover(frontButton("Dowsing Dagger // Lost Vale"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutMode).toBe("dfc");
    expect(layer.querySelector('[data-face="back"] img')?.getAttribute("src")).toContain("thumb-m2-b");
  });

  it("spins with the front on both sides when the deck has no card back", () => {
    render(edition({ backs: false }));
    hover(frontButton("Akroma"));
    expect(flyout()!.dataset.flyoutMode).toBe("spin");
    expect(flyout()!.querySelector('[data-face="back"] img')?.getAttribute("src")).toContain("thumb-m1");
  });

  it("does no flips with reduced motion", () => {
    media.reduced = true;
    render();
    hover(frontButton("Dowsing Dagger // Lost Vale"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutMode).toBe("fade");
    expect(layer.dataset.flyoutFaces).toBe("front");
    expect(layer.querySelector('[data-face="back"]')).toBeNull();
    expect(layer.style.getPropertyValue("--flyout-turn")).toBe("0deg");
  });

  it("never takes the pointer, so the - / + buttons still work while it shows", () => {
    render();
    const tile = frontButton("Arcane Signet").closest("[data-flyout-anchor]")!;
    hover(frontButton("Arcane Signet"));
    const layer = flyout()!;
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.contains(tile)).toBe(false);
    expect(tile.contains(layer)).toBe(false);
    click(tile.querySelector('[aria-label="More copies of Arcane Signet art 1"]')!);
    expect(qtyOf("card-m3")).toBe(2);
  });
});

describe("desktop art size", () => {
  it("makes main-deck art bigger at desktop width and leaves the phone size alone", () => {
    render();
    const front = frontButton("Dowsing Dagger // Lost Vale");
    const back = desktopPane().querySelector<HTMLButtonElement>('button[aria-label="Choose back art 1 for Dowsing Dagger // Lost Vale"]')!;
    for (const button of [front, back]) {
      expect(button.className.split(" ")).toEqual(expect.arrayContaining(["w-12", "lg:w-20"]));
      expect(button.className.split(" ").filter((name) => /^w-/.test(name))).toEqual(["w-12"]);
    }
    expect(front.parentElement!.className).toContain("lg:flex-wrap");
  });

  it("closes the flyout when its card leaves the list while hovered", async () => {
    render();
    hover(frontButton("Akroma"));
    expect(flyout()).not.toBeNull();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search this deck"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Arcane");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(desktopPane().querySelector('button[aria-label="Choose front art 1 for Akroma"]')).toBeNull();
    await tick();
    expect(flyout()).toBeNull();
  });

  it("closes the flyout when the page scrolls", () => {
    render();
    hover(frontButton("Akroma"));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(flyout()).toBeNull();
  });
});

describe("Back to top", () => {
  const button = () => document.querySelector<HTMLButtonElement>("[data-back-to-top]");

  it("is hidden at the very top and shows after scrolling", () => {
    render();
    expect(button()).toBeNull();
    act(() => {
      (window as { scrollY: number }).scrollY = 400;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(button()).not.toBeNull();
    expect(button()!.textContent).toContain("Back to top");
    expect(button()!.className).toContain("hidden");
    expect(button()!.className).toContain("lg:inline-flex");
    act(() => {
      (window as { scrollY: number }).scrollY = 0;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(button()).toBeNull();
  });

  it("scrolls smoothly to the top, or instantly with reduced motion, and moves focus up", () => {
    render();
    act(() => {
      (window as { scrollY: number }).scrollY = 400;
      window.dispatchEvent(new Event("scroll"));
    });
    click(button()!);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    expect(document.activeElement?.textContent).toContain("Decks");
    media.reduced = true;
    click(button()!);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });
});

describe("Extras and Tokens side tiles", () => {
  const tile = (kind: string) => aside().querySelector<HTMLElement>(`[data-side-tile="${kind}"]`);
  const openButton = (title: string) => [...aside().querySelectorAll("button")].find((item) => item.textContent?.trim() === `Click for ${title}`)!;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it("shows a tile with the count in place of the long extras column", () => {
    render();
    expect(tile("extras")!.querySelector("[data-side-tile-summary]")!.textContent).toBe("12 extras, 0 added");
    expect(aside().querySelectorAll('button[aria-label^="Choose art"]')).toHaveLength(3);
    expect(tile("tokens")).toBeNull();
  });

  it("gives tokens their own tile past 8", () => {
    render(edition({ tokens: 9 }));
    expect(tile("tokens")!.querySelector("[data-side-tile-summary]")!.textContent).toBe("9 tokens, 0 added");
    expect(openButton("Tokens")).toBeDefined();
  });

  it("opens an accessible overlay with every extra, and Escape returns focus to the tile button", async () => {
    render();
    const trigger = openButton("Extras");
    act(() => trigger.focus());
    click(trigger);
    const open = dialog()!;
    expect(open.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(open.getAttribute("aria-labelledby")!)!.textContent).toBe("Extras");
    expect(open.querySelectorAll('button[aria-label^="Choose art"]')).toHaveLength(12);
    expect(open.contains(document.activeElement)).toBe(true);
    expect(flyout()).toBeNull();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
    press("Escape");
    await tick();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(openButton("Extras"));
  });

  it("closes with the X button and with a click outside", async () => {
    render();
    click(openButton("Extras"));
    click(dialog()!.querySelector('[data-slot="dialog-close"]')!);
    await tick();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(openButton("Extras"));
    click(openButton("Extras"));
    await tick();
    await tick();
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]')!;
    act(() => {
      backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    await tick();
    expect(dialog()).toBeNull();
  });

  it("keeps counts edited in the overlay in the deck", () => {
    render();
    click(openButton("Extras"));
    click(dialog()!.querySelector('[aria-label="More copies of Extra 2 art 1"]')!);
    click(dialog()!.querySelector('[aria-label="More copies of Extra 2 art 1"]')!);
    expect(qtyOf("card-x2")).toBe(2);
    expect(dialog()!.querySelector('[data-slot="dialog-description"]')!.textContent).toContain("12 extras, 1 added");
    press("Escape");
    expect(tile("extras")!.querySelector("[data-side-tile-summary]")!.textContent).toBe("12 extras, 1 added");
    click(openButton("Extras"));
    expect(dialog()!.querySelector('[aria-label="More copies of Extra 2 art 1"]')!.previousElementSibling!.textContent).toBe("2");
  });

  it("opens the card flyout inside the overlay, and the first Escape closes only the flyout", () => {
    render();
    click(openButton("Extras"));
    const art = dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Choose art 1 for Extra 3"]')!;
    hover(art);
    expect(flyout()).not.toBeNull();
    expect(flyout()!.className).toContain("pointer-events-none");
    click(dialog()!.querySelector('[aria-label="More copies of Extra 3 art 1"]')!);
    expect(qtyOf("card-x3")).toBe(1);
    hover(art);
    press("Escape");
    expect(flyout()).toBeNull();
    expect(dialog()).not.toBeNull();
    press("Escape");
    expect(dialog()).toBeNull();
  });

  it("leaves the phone and tablet Add cards tab as the full list, with no tile", () => {
    media.desktop = false;
    render();
    const tabs = document.querySelector('[role="tablist"]')!.parentElement!;
    const addTab = [...tabs.querySelectorAll('[role="tab"]')].find((item) => item.textContent === "Add cards")!;
    act(() => {
      addTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(tabs.querySelector("[data-side-tile]")).toBeNull();
    expect(tabs.querySelectorAll('button[aria-label^="Choose art"]')).toHaveLength(15);
    expect(tabs.className).toContain("lg:hidden");
  });
});
