/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { Tour } from "@/components/Tour";
import { freshDraft } from "@/lib/draft";
import { writeSaved } from "@/lib/storage";
import { splashKey } from "@/lib/splash";
import { shouldOfferTour, TOUR_IN_DECK_INTRO, TOUR_KEY, TOUR_STEPS } from "@/lib/tour";
import type { DeckCatalogue } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const deckFile = (id: string) => readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8");
const TMNT = JSON.parse(deckFile("tmnt")) as DeckCatalogue;

let host: HTMLDivElement;
let reactRoot: Root;

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
async function mount() {
  await act(async () => {
    reactRoot.render(<App />);
  });
  for (let i = 0; i < 5; i += 1) await settle();
}
async function remount() {
  act(() => reactRoot.unmount());
  reactRoot = createRoot(host);
  await mount();
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text);
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => (element as HTMLElement).click());
  await settle();
}
async function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await settle();
}
const prompt = () => document.querySelector("[data-tour-prompt]");
const stepId = () => document.querySelector("[data-tour-step]")?.getAttribute("data-tour-step") ?? null;
const inBuilder = () => Boolean(document.querySelector('input[aria-label="Search this deck"]'));
const total = () => [...document.querySelectorAll("p")].find((item) => /^\d+ cards?/.test(item.textContent?.trim() ?? ""))?.textContent?.trim() ?? null;
/** Every localStorage key but the tour's own, as stored. */
const otherKeys = () => Object.fromEntries(Object.keys(localStorage).filter((key) => key !== TOUR_KEY).sort().map((key) => [key, localStorage.getItem(key)]));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // The deck splash has its own tests (splash.test.tsx); here both decks have already had theirs this session.
  sessionStorage.setItem(splashKey("tmnt"), "1");
  sessionStorage.setItem(splashKey("x-men"), "1");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/").pop()!;
    if (name === "index.json") return new Response(JSON.stringify({ decks: [{ id: "tmnt", name: "TMNT", file: "decks/tmnt.json" }, { id: "x-men", name: "X-Men", file: "decks/x-men.json" }] }));
    return new Response(deckFile(name.replace(/\.json$/, "")));
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});
afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the first-run prompt", () => {
  it("shows on first load only, and No thanks is remembered so it never shows on its own again", async () => {
    await mount();
    expect(prompt()?.textContent).toContain("New to BeeLine? Want a quick tour?");
    expect(document.activeElement?.textContent?.trim()).toBe("Take the tour");
    await click(button("No thanks"));
    expect(prompt()).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("declined");
    await remount();
    expect(prompt()).toBeNull();
    expect(button("Take the tour")?.hasAttribute("data-tour-button")).toBe(true);
  });

  it("is answered No thanks by Esc, and Take the tour is remembered too", async () => {
    await mount();
    await press("Escape", document.body);
    expect(prompt()).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("declined");
    localStorage.clear();
    await remount();
    await click(button("Take the tour"));
    expect(localStorage.getItem(TOUR_KEY)).toBe("taken");
    expect(stepId()).toBe("deck");
    await press("Escape");
    await remount();
    expect(prompt()).toBeNull();
  });

  it("stays away when storage can't be read", () => {
    expect(shouldOfferTour({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })).toBe(false);
    expect(shouldOfferTour({ getItem: () => null, setItem: () => undefined })).toBe(true);
  });
});

describe("the tour", () => {
  it("has six steps: a deck, unlock, art and backs, search, Filters, Clear all / Clear shown", () => {
    expect(TOUR_STEPS.map((step) => [step.id, step.view])).toEqual([["deck", "home"], ["unlock", "home"], ["art", "builder"], ["search", "builder"], ["filters", "builder"], ["clear", "builder"]]);
    expect(TOUR_STEPS[3]!.body).toContain("t:creature c:g mv<=3");
    expect(TOUR_STEPS[2]!.body).toContain("Card Back, Alt Back or Token Backs");
  });

  it("walks every step with Next and Back, opens a deck as an unsaved preview for the deck view, and leaves saves and counts alone", async () => {
    const saved = { ...freshDraft(TMNT, TMNT.editions[0]!, "saved-1", new Date("2026-11-01T00:00:00Z")), name: "My TMNT" };
    writeSaved(localStorage, [saved]);
    const before = otherKeys();
    await mount();
    await click(button("Take the tour"));
    const seen: string[] = [stepId()!];
    expect(document.querySelector("[data-tour-step]")!.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent?.trim()).toBe("Next");
    await click(button("Next"));
    seen.push(stepId()!);
    await click(button("Next"));
    seen.push(stepId()!);
    expect(inBuilder()).toBe(true);
    expect(document.querySelector("[data-tour-note]")!.textContent).toBe("The tour opened TMNT to show this. Nothing is saved, and you go back where you were when the tour ends.");
    expect(total()).toMatch(/^100 cards/);
    await click(button("Back"));
    expect(stepId()).toBe("unlock");
    expect(inBuilder()).toBe(false);
    for (let i = 0; i < 4; i += 1) {
      await click(button("Next"));
      seen.push(stepId()!);
    }
    expect(seen).toEqual(["deck", "unlock", "art", "art", "search", "filters", "clear"]);
    expect(total()).toMatch(/^100 cards/);
    await click(button("Done"));
    expect(stepId()).toBeNull();
    expect(inBuilder()).toBe(false);
    // Started from the prompt, whose buttons are gone now: focus lands on the Tour button, not the page.
    expect(document.activeElement?.getAttribute("data-tour-button")).toBe("");
    // The preview is gone: no "You were building" banner, and nothing was saved or changed.
    expect(document.body.textContent).not.toContain("You were building");
    expect(otherKeys()).toEqual(before);
    expect(document.body.textContent).toContain("My TMNT");
  });

  it("replays from the Tour button in the middle of a deck with only the deck steps, keeping the search, the Clear undo and every count", async () => {
    localStorage.setItem(TOUR_KEY, "declined");
    await mount();
    await click(button("Build"));
    await click(document.querySelector('button[aria-label^="More copies of"]'));
    expect(total()).toMatch(/^101 cards/);
    await click(button("Clear all"));
    expect(total()).toMatch(/^0 cards/);
    expect(button("Undo Clear all")).toBeTruthy();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search this deck"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "turtle");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = otherKeys();
    await click(button("Take the tour"));
    // It starts on the deck steps and never goes to the deck list, so the deck view is never unmounted.
    expect(stepId()).toBe("art");
    expect(document.querySelector("[data-tour-step]")!.textContent).toContain("Step 1 of 4");
    expect(document.querySelector("[data-tour-intro]")!.textContent).toBe(TOUR_IN_DECK_INTRO);
    const seen = [stepId()];
    for (let i = 0; i < 3; i += 1) {
      await click(button("Next"));
      expect(inBuilder()).toBe(true);
      expect(document.querySelector('input[aria-label="Search this deck"]')).toBe(search);
      seen.push(stepId());
    }
    expect(seen).toEqual(["art", "search", "filters", "clear"]);
    expect(document.querySelector("[data-tour-intro]")).toBeNull();
    await click(button("Done"));
    expect(inBuilder()).toBe(true);
    expect(document.querySelector('input[aria-label="Search this deck"]')).toBe(search);
    expect(search.value).toBe("turtle");
    expect(button("Undo Clear all")).toBeTruthy();
    await click(button("Undo Clear all"));
    expect(total()).toMatch(/^101 cards/);
    expect(localStorage.getItem(TOUR_KEY)).toBe("declined");
    expect(Object.keys(otherKeys())).toEqual(Object.keys(before));
  });

  it("starts at step 1 with all six steps from the deck list", async () => {
    localStorage.setItem(TOUR_KEY, "declined");
    await mount();
    await click(button("Take the tour"));
    expect(stepId()).toBe("deck");
    expect(document.querySelector("[data-tour-step]")!.textContent).toContain("Step 1 of 6");
    expect(document.querySelector("[data-tour-intro]")).toBeNull();
  });

  it("keeps Tab and Enter away from Clear all and Save: the page is inert, a backdrop press keeps focus, and focus can't leave the caption", async () => {
    localStorage.setItem(TOUR_KEY, "declined");
    await mount();
    await click(button("Build"));
    const before = total();
    const savedBefore = otherKeys();
    await click(button("Take the tour"));
    const caption = document.querySelector("[data-tour-step]")!;
    // Everything but the tour's own overlay is inert.
    expect(host.hasAttribute("inert")).toBe(true);
    const overlay = document.querySelector("[data-tour-overlay]")!;
    expect(overlay.hasAttribute("inert")).toBe(false);
    // Pressing the backdrop doesn't take focus to <body>.
    const backdrop = document.querySelector("[data-tour-backdrop]")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => backdrop.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(caption.contains(document.activeElement)).toBe(true);
    // Even if focus does land on the page (a browser without inert), it goes straight back to the caption.
    const clearAll = button("Clear all")!;
    const save = button("Save")!;
    await act(async () => clearAll.focus());
    expect(caption.contains(document.activeElement)).toBe(true);
    await act(async () => save.focus());
    expect(caption.contains(document.activeElement)).toBe(true);
    // Focus on <body>: Tab and Enter go to the caption, not the page.
    await act(async () => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => document.body.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(caption.contains(document.activeElement)).toBe(true);
    await act(async () => (document.activeElement as HTMLElement).blur());
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => document.body.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(total()).toBe(before);
    expect(button("Undo Clear all")).toBeUndefined();
    await press("Escape");
    // Closed: the page is reachable again and nothing changed.
    expect(host.hasAttribute("inert")).toBe(false);
    expect(total()).toBe(before);
    expect(otherKeys()).toEqual(savedBefore);
  });

  it("shows the deck you were building for the deck-view steps, then goes back to the deck list where the tour started", async () => {
    localStorage.setItem(TOUR_KEY, "declined");
    await mount();
    await click(button("Build"));
    await click(document.querySelector('button[aria-label^="More copies of"]'));
    await click(button("Decks"));
    expect(inBuilder()).toBe(false);
    expect(document.body.textContent).toContain("You were building");
    const before = otherKeys();
    await click(button("Take the tour"));
    await click(button("Next"));
    await click(button("Next"));
    expect(inBuilder()).toBe(true);
    expect(document.querySelector("[data-tour-note]")).toBeNull();
    expect(total()).toMatch(/^101 cards/);
    for (let i = 0; i < 3; i += 1) await click(button("Next"));
    await click(button("Done"));
    expect(stepId()).toBeNull();
    expect(inBuilder()).toBe(false);
    expect(document.body.textContent).toContain("You were building");
    await click(button("Continue"));
    expect(total()).toMatch(/^101 cards/);
    expect(otherKeys()).toEqual(before);
  });

  it("closes on Esc at any step, keeps the key from the page, and gives focus back", async () => {
    localStorage.setItem(TOUR_KEY, "taken");
    await mount();
    const tourButton = button("Take the tour")!;
    tourButton.focus();
    await click(tourButton);
    await click(button("Next"));
    await click(button("Next"));
    expect(stepId()).toBe("art");
    const pageSaw = vi.fn();
    document.addEventListener("keydown", pageSaw);
    await press("Escape");
    document.removeEventListener("keydown", pageSaw);
    expect(stepId()).toBeNull();
    expect(pageSaw).not.toHaveBeenCalled();
    expect(inBuilder()).toBe(false);
    expect(document.activeElement?.getAttribute("data-tour-button")).toBe("");
  });

  it("stays out of the way on a phone: the Tour button sits at the end of the page there, floating only from sm up", async () => {
    localStorage.setItem(TOUR_KEY, "declined");
    await mount();
    await click(button("Build"));
    const tour = document.querySelector<HTMLElement>("[data-tour-button]")!;
    const classes = tour.className.split(" ");
    // In the normal flow below sm (so it can't cover a card tile), fixed in the corner from sm up.
    expect(classes).toEqual(expect.arrayContaining(["relative", "sm:fixed", "sm:bottom-4", "sm:left-4"]));
    expect(classes).not.toContain("fixed");
    expect(classes.filter((name) => /^(bottom|left|z)-/.test(name))).toEqual([]);
    // After the page content, not inside it.
    expect(tour.parentElement).toBe(host.firstElementChild);
    expect(tour.previousElementSibling?.contains(document.querySelector('input[aria-label="Search this deck"]'))).toBe(true);
  });

  it("keeps Tab inside the caption", async () => {
    localStorage.setItem(TOUR_KEY, "taken");
    await mount();
    await click(button("Take the tour"));
    await click(button("Next"));
    const caption = document.querySelector("[data-tour-step]")!;
    const next = button("Next")!;
    next.focus();
    await press("Tab", next);
    expect(document.activeElement?.textContent?.trim()).toBe("Skip tour");
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(next);
    expect(caption.contains(document.activeElement)).toBe(true);
  });

  it("shows a step whose control isn't on screen as a plain caption, and Next still moves on", async () => {
    const onClose = vi.fn();
    await act(async () => {
      reactRoot.render(
        <Tour
          steps={[
            { id: "gone", view: "builder", title: "Not here", body: "A control that isn't rendered.", targets: ["[data-nothing-here]"] },
            { id: "here", view: "home", title: "Here", body: "The body.", targets: ["body"] },
          ]}
          onNeedView={() => ({ ok: true })}
          onClose={onClose}
        />,
      );
    });
    await settle(1200);
    expect(document.querySelector("[data-tour-ring]")).toBeNull();
    expect(document.querySelector("[data-tour-missing]")!.textContent).toBe("This control is in the deck view, on the Deck tab. Open a deck to see it there.");
    await click(button("Next"));
    expect(stepId()).toBe("here");
    expect(document.querySelector("[data-tour-ring]")).not.toBeNull();
    await click(button("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
