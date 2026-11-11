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
import { DESKTOP_THUMB_WIDTH, FLYOUT_POP_EASING, FLYOUT_POP_FROM_SCALE, FLYOUT_POP_MS, FLYOUT_REDUCED_FADE_MS } from "@/lib/desktop";

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

  it("pops up with the front alone for a one-faced card: no flip, and no back drawn", () => {
    render();
    hover(frontButton("Akroma"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutMotion).toBe("pop");
    expect(layer.dataset.flyoutBack).toBe("none");
    expect(layer.querySelectorAll("[data-face]")).toHaveLength(1);
    expect(layer.querySelector('[data-face="back"]')).toBeNull();
    expect(layer.innerHTML).not.toContain("thumb-deckback");
    expect(layer.style.width).toBe("400px");
  });

  it("shows a double-faced card's own back face beside the front, labelled, at half size", () => {
    render();
    hover(frontButton("Dowsing Dagger // Lost Vale"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutBack).toBe("dfc");
    const back = layer.querySelector<HTMLElement>('[data-face="back"]')!;
    expect(back.querySelector("img")?.getAttribute("src")).toContain("thumb-m2-b");
    expect(back.querySelector("[data-flyout-label]")!.textContent).toBe("Back face");
    expect(back.style.width).toBe("200px");
    expect(layer.querySelector<HTMLElement>('[data-face="front"]')!.style.width).toBe("400px");
    // Side by side, not stacked faces: the back is a sibling after the front, both visible at once.
    expect(back.previousElementSibling?.getAttribute("data-face")).toBe("front");
    expect(layer.className).toContain("flex");
  });

  it("puts the back on the far side when the pop-up opens left of the row", () => {
    render();
    const button = frontButton("Dowsing Dagger // Lost Vale");
    const anchor = button.closest("[data-flyout-anchor]")!;
    anchor.getBoundingClientRect = () => ({ left: 1100, right: 1400, top: 300, bottom: 560, width: 300, height: 260, x: 1100, y: 300, toJSON: () => ({}) });
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    hover(button);
    const layer = flyout()!;
    expect(layer.dataset.flyoutSide).toBe("left");
    expect(layer.style.flexDirection).toBe("row-reverse");
    // Placed with the back counted in: the whole pair (front, gap, half-size back) sits left of the row.
    expect(layer.style.width).toBe("612px");
    expect(Number.parseFloat(layer.style.left) + 612).toBeLessThanOrEqual(1100 - 12);
  });

  it("takes its pop-up timing and easing from desktop.ts and scales in from the thumbnail", () => {
    render();
    const button = frontButton("Akroma");
    button.getBoundingClientRect = () => ({ left: 100, right: 260, top: 200, bottom: 424, width: 160, height: 224, x: 100, y: 200, toJSON: () => ({}) });
    hover(button);
    const layer = flyout()!;
    expect(layer.style.getPropertyValue("--flyout-pop-ms")).toBe(`${FLYOUT_POP_MS}ms`);
    expect(layer.style.getPropertyValue("--flyout-pop-ease")).toBe(FLYOUT_POP_EASING);
    expect(layer.style.getPropertyValue("--flyout-pop-from")).toBe(String(FLYOUT_POP_FROM_SCALE));
    expect(layer.style.getPropertyValue("--flyout-fade-ms")).toBe(`${FLYOUT_REDUCED_FADE_MS}ms`);
    const [x, y] = layer.style.transformOrigin.split(" ").map((part) => Number.parseFloat(part));
    expect(x).toBe(180 - Number.parseFloat(layer.style.left));
    expect(y).toBe(312 - Number.parseFloat(layer.style.top));
  });

  it("closes at once, and the next card gets its own pop-up from the beginning", () => {
    render();
    hover(frontButton("Akroma"));
    const first = flyout()!;
    leave(frontButton("Akroma"));
    expect(flyout()).toBeNull();
    expect(document.querySelectorAll(".beeline-flyout")).toHaveLength(0);
    hover(frontButton("Akroma"));
    expect(flyout()).not.toBe(first);
    // A fast move can deliver the next card's pointerover before this one's pointerout.
    const again = flyout()!;
    hover(frontButton("Arcane Signet"));
    const next = flyout()!;
    expect(next).not.toBe(again);
    expect(again.isConnected).toBe(false);
    expect(next.querySelector('[data-face="front"] img[alt="Arcane Signet"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-flyout]")).toHaveLength(1);
  });

  it("only fades with reduced motion, and still shows the back beside the front", () => {
    media.reduced = true;
    render();
    hover(frontButton("Dowsing Dagger // Lost Vale"));
    const layer = flyout()!;
    expect(layer.dataset.flyoutMotion).toBe("fade");
    expect(layer.querySelector('[data-face="back"] img')?.getAttribute("src")).toContain("thumb-m2-b");
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
      expect(button.className.split(" ")).toContain("w-12");
      expect(button.className.split(" ").filter((name) => /^w-/.test(name))).toEqual(["w-12"]);
    }
    // v0.1.27: the front is 160px (lg:w-40, twice v0.1.26's lg:w-20).
    expect(front.className.split(" ")).toContain(`lg:w-${DESKTOP_THUMB_WIDTH / 4}`);
    // A double-faced card's back takes what is left of the tile beside the front, up to the same 160px, so it never pushes the tile wider.
    expect(back.className.split(" ")).toContain("lg:w-[clamp(4rem,calc(100%_-_10.5rem),10rem)]");
    expect(front.parentElement!.className).toContain("lg:flex-wrap");
    // The count controls go on their own line under the art at desktop width; on phones the break is display:none.
    const brk = front.parentElement!.querySelector('span[aria-hidden="true"]')!;
    expect(brk.className.split(" ")).toEqual(["hidden", "lg:block", "lg:basis-full"]);
    expect(brk.nextElementSibling?.querySelector('[aria-label="More copies of Dowsing Dagger // Lost Vale art 1"]')).not.toBeNull();
  });

  it("wraps the main grid into as many 17rem columns as fit at desktop width, keeping the phone and tablet columns", () => {
    render();
    const grid = desktopPane().querySelector("ul")!;
    const classes = grid.className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]"]));
    expect(classes.filter((name) => /^xl:/.test(name))).toEqual([]);
    const page = document.querySelector("aside")!.parentElement!.parentElement!;
    expect(page.className.split(" ")).toEqual(expect.arrayContaining(["max-w-6xl", "lg:max-w-[96rem]"]));
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
