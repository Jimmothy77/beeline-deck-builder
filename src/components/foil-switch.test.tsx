/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderView } from "@/components/BuilderView";
import { freshDraft } from "@/lib/draft";
import { kpdhLikeTree } from "@/lib/fixtures/foil-maps-tree";
import { FOIL_CAPTION, FOIL_MAPS_MISSING_NOTE, FOIL_SESSION_KEY, NO_FOIL_MAP } from "@/lib/foil-maps";
import { catalogueFromTree } from "@/lib/group";
import type { DeckCatalogue, Edition } from "@/lib/types";

// Made-up ids from the fixture. None of them is shaped like a Drive id.
const catalogue = catalogueFromTree(kpdhLikeTree());
const partial: Edition = { ...catalogue.editions.find((edition) => edition.printType === "partial_foil")!, origin: "unlocked" };
const deluxeViaPartial: Edition = { ...catalogue.editions.find((edition) => edition.printType === "standard")!, origin: "unlocked" };
const oldPartial: Edition = { ...partial, foilMaps: undefined };
const shippedStandard: Edition = { ...deluxeViaPartial, id: "standard", name: "Standard", origin: "shipped" };

let host: HTMLDivElement;
let root: Root;
let media: { desktop: boolean };

function Harness({ ed }: { ed: Edition }) {
  const deck: DeckCatalogue = { ...catalogue, editions: [ed] };
  const [draft, setDraft] = useState(() => freshDraft(deck, ed, "draft-1", new Date("2026-11-12T00:00:00Z")));
  return <BuilderView draft={draft} edition={ed} onChange={setDraft} onBack={() => undefined} onSave={() => undefined} onSaveNew={() => undefined} onToast={() => undefined} />;
}
async function render(ed: Edition) {
  act(() => root.render(<Harness key={ed.id + String(ed.foilMaps?.found)} ed={ed} />));
  await settle();
}
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
const toggle = () => document.querySelector<HTMLButtonElement>('[data-foil-switch] [role="switch"]');
const caption = () => document.querySelector<HTMLElement>("[data-foil-caption]");
const thumbSrc = (alt: string, scope: ParentNode = document) => scope.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)?.getAttribute("src") ?? "";
const frontButton = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Choose front art 1 for ${name}"]`)!;
const flyout = () => document.querySelector<HTMLElement>("[data-flyout]");
/** jsdom never loads images; firing load frees each thumbnail's slot in the load gate, as a browser would. */
async function loadAll() {
  act(() => {
    for (const img of document.querySelectorAll("img")) img.dispatchEvent(new Event("load"));
  });
  await settle();
}
async function click(element: Element) {
  act(() => (element as HTMLElement).click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  media = { desktop: true };
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? media.desktop : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  // Every thumbnail is on screen at once, so its img (and src) renders.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
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

describe("Show foiled area", () => {
  it("appears only on an unlocked Partial Foil edition", async () => {
    await render(partial);
    expect(toggle()).not.toBeNull();
    await render(shippedStandard);
    expect(toggle()).toBeNull();
    await render(deluxeViaPartial);
    expect(toggle()).toBeNull();
    await render({ ...partial, origin: "shipped" });
    expect(toggle()).toBeNull();
  });

  it("is an accessible switch, off by default, that a keyboard can reach", async () => {
    await render(partial);
    const button = toggle()!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-checked")).toBe("false");
    expect(button.textContent).toContain("Show foiled area");
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    await click(button);
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
  });

  it("shows the caption only while on, tied to the switch by aria-describedby", async () => {
    await render(partial);
    expect(caption()).toBeNull();
    expect(toggle()!.hasAttribute("aria-describedby")).toBe(false);
    await click(toggle()!);
    const shown = caption()!;
    expect(shown.textContent).toBe(FOIL_CAPTION);
    expect(shown.id).not.toBe("");
    expect(toggle()!.getAttribute("aria-describedby")).toBe(shown.id);
    expect(document.getElementById(toggle()!.getAttribute("aria-describedby")!)).toBe(shown);
    await click(toggle()!);
    expect(caption()).toBeNull();
    expect(toggle()!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("swaps thumbnails to the masks and back, and tags a card that has none", async () => {
    await render(partial);
    expect(thumbSrc("Sol Ring")).toContain("fm-d-sol-00");
    expect(document.querySelector("[data-thumb-tag]")).toBeNull();
    await click(toggle()!);
    expect(thumbSrc("Sol Ring")).toContain("fm-m-sol-00");
    expect(thumbSrc("Akroma's Will (The Honmoon)")).toContain("fm-m-akroma-00");
    const tags = [...document.querySelectorAll("[data-thumb-tag]")].map((tag) => tag.textContent);
    expect(tags).toContain(NO_FOIL_MAP);
    const signetTag = frontButton("Arcane Signet").querySelector("[data-thumb-tag]");
    expect(signetTag?.textContent).toBe(NO_FOIL_MAP);
    expect(frontButton("Sol Ring").querySelector("[data-thumb-tag]")).toBeNull();
    await click(toggle()!);
    expect(thumbSrc("Sol Ring")).toContain("fm-d-sol-00");
    expect(document.querySelector("[data-thumb-tag]")).toBeNull();
  });

  it("puts the mask in the desktop hover flyout when on", async () => {
    await render(partial);
    await click(toggle()!);
    act(() => {
      frontButton("Sol Ring").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    });
    await settle();
    expect(flyout()).not.toBeNull();
    expect(flyout()!.querySelector("img")?.getAttribute("src")).toContain("fm-m-sol-00");
  });

  it("on a phone, a tapped card's art picker follows the switch", async () => {
    media.desktop = false;
    await render(partial);
    await click(toggle()!);
    await loadAll();
    await click(frontButton("Sol Ring"));
    await loadAll();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("img")?.getAttribute("src")).toContain("fm-m-sol-00");
  });

  it("remembers the switch for the session across decks and reloads", async () => {
    await render(partial);
    await click(toggle()!);
    expect(window.sessionStorage.getItem(FOIL_SESSION_KEY)).toBe("1");
    act(() => root.unmount());
    root = createRoot(host);
    await render(partial);
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    expect(caption()).not.toBeNull();
    await click(toggle()!);
    expect(window.sessionStorage.getItem(FOIL_SESSION_KEY)).not.toBe("1");
  });

  it("tells the user in one line when an older unlock has no foil maps yet", async () => {
    await render(oldPartial);
    expect(document.querySelector("[data-foil-missing]")).toBeNull();
    await click(toggle()!);
    expect(document.querySelector("[data-foil-missing]")?.textContent).toBe(FOIL_MAPS_MISSING_NOTE);
    expect(thumbSrc("Sol Ring")).toContain("fm-d-sol-00");
    await render(partial);
    expect(document.querySelector("[data-foil-missing]")).toBeNull();
  });
});
