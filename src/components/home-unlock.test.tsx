/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { RESTORE_WARNING } from "@/components/RestoreCode";
import { PARTIAL_FOIL_NOTICE } from "@/components/HomeView";
import { freshDraft } from "@/lib/draft";
import { allPartialFoilPacks } from "@/lib/fixtures/all-pf-packs";
import { RESTORE_ERRORS } from "@/lib/restore-code";
import { MAP_LINK_GENERIC } from "@/lib/pf-map";
import { LAST_SESSION_KEY, packForStorage, packHash, sha256Hex, UNLOCK_KEY, writeSaved, type SavedDeck } from "@/lib/storage";
import { splashKey } from "@/lib/splash";
import { TOUR_KEY } from "@/lib/tour";
import { unlockPlace } from "@/lib/unlock-place";
import type { DeckCatalogue } from "@/lib/types";

// Fixtures: public Standard catalogues relabelled, and folder ids made up at run time. No paid id is in this file.
const root = path.resolve(import.meta.dirname, "../..");
const deckFile = (id: string) => readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8");
const TMNT = JSON.parse(deckFile("tmnt")) as DeckCatalogue;
const fakeFolder = (n: number) => ["fake", "folder", String(n)].join("-");
const fakePack = (n: number, name: string) => ({
  packHash: packHash(fakeFolder(n)),
  savedAt: `2026-11-0${n}T00:00:00.000Z`,
  catalogue: { ...TMNT, id: `fake-${n}`, name, editions: TMNT.editions.map((edition) => ({ ...edition, id: `deluxe-${n}`, name: "Deluxe" })) },
});

let host: HTMLDivElement;
let reactRoot: Root;
let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null; disconnected: boolean }>;
let reduced = false;

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
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Reading a code runs through a decompression stream, which takes a few turns of the event loop.
  for (let i = 0; i < 50 && form.querySelector("button[type=submit]")?.textContent === "Restoring…"; i += 1) await settle(5);
  await settle();
}
/** Making a code runs through a compression stream, which takes a few turns of the event loop. */
async function untilShown(find: () => Element | null) {
  for (let i = 0; i < 100 && !find(); i += 1) await settle(5);
}
const unlockSection = () => document.querySelector<HTMLElement>('[data-tour="unlock"]')!;
const floating = () => document.querySelector<HTMLButtonElement>("[data-unlock-here]");
const total = () => [...document.querySelectorAll("p")].find((item) => /^\d+ cards?/.test(item.textContent?.trim() ?? ""))?.textContent?.trim() ?? null;
const inBuilder = () => Boolean(document.querySelector('input[aria-label="Search this deck"]'));
async function observe(isIntersecting: boolean, top: number) {
  await act(async () => {
    for (const observer of observers.filter((item) => !item.disconnected && item.target === unlockSection())) {
      observer.callback([{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(TOUR_KEY, "declined");
  sessionStorage.setItem(splashKey("tmnt"), "1");
  sessionStorage.setItem(splashKey("x-men"), "1");
  reduced = false;
  observers = [];
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") || (reduced && query.includes("reduce")), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: { callback: IntersectionObserverCallback; target: Element | null; disconnected: boolean };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, target: null, disconnected: false };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
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
  vi.restoreAllMocks();
});

describe("Continue where you left off", () => {
  it("is hidden when nothing is saved", async () => {
    await mount();
    expect(document.querySelector("[data-resume]")).toBeNull();
    expect(document.body.textContent).not.toContain("Continue where you left off");
  });

  it("survives a reload and reopens the deck with its counts", async () => {
    await mount();
    await click(button("Build"));
    await click(document.querySelector('button[aria-label^="More copies of"]'));
    expect(total()).toMatch(/^101 cards/);
    await remount();
    const resume = document.querySelector("[data-resume]")!;
    expect(resume.querySelector("h2")!.textContent).toBe("Continue where you left off");
    expect(resume.textContent).toContain("TMNT · Standard · 101 cards");
    await click(button("Continue"));
    expect(inBuilder()).toBe(true);
    expect(total()).toMatch(/^101 cards/);
  });

  it("keeps the deck-wide back and per-card back picks", async () => {
    const edition = TMNT.editions[0]!;
    const draft = freshDraft(TMNT, edition, "draft-1", new Date("2026-11-02T00:00:00Z"));
    const first = draft.cards[0]!;
    const picked: SavedDeck = {
      ...draft,
      cardbackId: edition.backs[0]!.id,
      cardBacks: { [first.cardId]: edition.backs[1]!.id },
      cards: [{ ...first, pairs: [{ ...first.pairs[0]!, qty: 3 }] }, ...draft.cards.slice(1)],
    };
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(picked));
    await mount();
    expect(document.querySelector("[data-resume]")!.textContent).toContain("102 cards");
    await click(button("Continue"));
    expect(total()).toMatch(/^102 cards/);
    const stored = JSON.parse(localStorage.getItem(LAST_SESSION_KEY)!) as SavedDeck;
    expect(stored.cardbackId).toBe(edition.backs[0]!.id);
    expect(stored.cardBacks).toEqual({ [first.cardId]: edition.backs[1]!.id });
    expect(stored.cards[0]!.pairs[0]!.qty).toBe(3);
  });

  it("offers the deck opened on this visit over the one from last time", async () => {
    const earlier = { ...freshDraft(TMNT, TMNT.editions[0]!, "earlier", new Date("2026-11-01T00:00:00Z")), name: "Earlier TMNT" };
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(earlier));
    await mount();
    expect(document.querySelector("[data-resume] strong")!.textContent).toBe("Earlier TMNT");
    const builds = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.trim() === "Build");
    await click(builds[1]);
    await click(button("Decks"));
    expect(document.querySelector("[data-resume] strong")!.textContent).toBe("X-Men · Standard");
    expect(JSON.parse(localStorage.getItem(LAST_SESSION_KEY)!).deckId).toBe("x-men");
  });

  it("offers the newest saved deck for saves made before there was a Continue record", async () => {
    const older = { ...freshDraft(TMNT, TMNT.editions[0]!, "s-1", new Date("2026-10-01T00:00:00Z")), name: "Old TMNT" };
    const newer = { ...freshDraft(TMNT, TMNT.editions[0]!, "s-2", new Date("2026-11-01T00:00:00Z")), name: "New TMNT" };
    writeSaved(localStorage, [older, newer]);
    await mount();
    expect(document.querySelector("[data-resume] strong")!.textContent).toBe("New TMNT");
    await click(button("Continue"));
    expect(inBuilder()).toBe(true);
  });

  it("says why when the deck's paid folder isn't on this device", async () => {
    const pack = fakePack(1, "Fake Deck");
    const draft = { ...freshDraft(pack.catalogue as DeckCatalogue, pack.catalogue.editions[0]!, "p-1"), packHash: pack.packHash };
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(draft));
    await mount();
    await click(button("Continue"));
    expect(inBuilder()).toBe(false);
    expect(document.querySelector('[role="alert"]')!.textContent).toMatch(/^This deck is tied to a folder that is/);
  });
});

describe("unlock notices", () => {
  it("says a Partial Foil link also unlocks that deck's Deluxe files, inside the unlock box", async () => {
    await mount();
    const notice = unlockSection().querySelector("[data-partial-foil-notice]")!;
    expect(notice.textContent).toBe(PARTIAL_FOIL_NOTICE);
    expect(PARTIAL_FOIL_NOTICE).toBe("A Partial Foil link also unlocks that deck's Deluxe files.");
  });
});

describe("Unlock Here button", () => {
  it("shows only while the unlock section is out of view, with arrows toward it", async () => {
    await mount();
    expect(observers.some((item) => item.target === unlockSection())).toBe(true);
    expect(floating()).toBeNull();
    await observe(false, 1200);
    expect(floating()!.getAttribute("data-unlock-here")).toBe("below");
    expect(floating()!.querySelectorAll(".lucide-chevrons-down").length).toBe(2);
    await observe(true, 300);
    expect(floating()).toBeNull();
    await observe(false, -900);
    expect(floating()!.getAttribute("data-unlock-here")).toBe("above");
    expect(floating()!.querySelectorAll(".lucide-chevrons-up").length).toBe(2);
  });

  it("pads the footer by the floating button's height and offset, so the button never covers the footer text", async () => {
    await mount();
    const footer = document.querySelector<HTMLElement>("[data-home-footer]")!;
    expect(footer.classList.contains("home-footer")).toBe(true);
    expect(footer.className).not.toMatch(/(^|\s)pb-/);
    const css = readFileSync(path.join(root, "src/index.css"), "utf8");
    const rule = (selector: string) => new RegExp(`(^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? "";
    expect(rule(".unlock-here")).toMatch(/bottom:\s*var\(--unlock-here-bottom\)/);
    expect(rule(".unlock-here")).toMatch(/height:\s*var\(--unlock-here-height\)/);
    expect(rule(".home-footer")).toMatch(/padding-bottom:\s*calc\(var\(--unlock-here-bottom\) \+ var\(--unlock-here-height\) \+ var\(--unlock-here-gap\)\)/);
    expect(css).toMatch(/--unlock-here-bottom:\s*max\(1rem, env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/--unlock-here-height:\s*2\.75rem/);
    expect(css).toMatch(/--unlock-here-gap:\s*1rem/);
    // The button takes its place and height only from those variables, not from its own utilities.
    const source = readFileSync(path.join(root, "src/components/UnlockHere.tsx"), "utf8");
    const classes = /className="(unlock-here [^"]*)"/.exec(source)![1]!;
    expect(classes).not.toMatch(/(^|\s)(bottom-|h-|top-)/);
  });

  it("has an accessible name that starts with its label, and hides its arrows from screen readers", async () => {
    await mount();
    await observe(false, 1200);
    const node = floating()!;
    expect(node.tagName).toBe("BUTTON");
    expect(node.textContent!.replace(/\s+/g, " ").trim()).toBe("Unlock Here: go to Unlock a paid deck");
    expect(node.querySelector(".sr-only")!.textContent).toBe(": go to Unlock a paid deck");
    for (const svg of node.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("scrolls smoothly to the section and moves focus to its heading", async () => {
    await mount();
    await observe(false, 1200);
    await click(floating());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0]).toBe(unlockSection());
    expect(document.activeElement?.textContent).toBe("Unlock a paid deck");
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("jumps instantly under reduced motion", async () => {
    reduced = true;
    await mount();
    await observe(false, 1200);
    await click(floating());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("sits bottom centre, clear of the Tour button (bottom left) and Back to top (bottom right)", async () => {
    await mount();
    await observe(false, 1200);
    const classes = floating()!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["unlock-here", "fixed", "left-1/2", "-translate-x-1/2"]));
    // Its bottom offset (max(1rem, safe area)) now comes from .unlock-here in index.css; see the footer test.
    expect(readFileSync(path.join(root, "src/index.css"), "utf8")).toMatch(/--unlock-here-bottom:\s*max\(1rem, env\(safe-area-inset-bottom\)\)/);
    expect(classes.some((name) => /^(right|left)-(4|6)$/.test(name))).toBe(false);
    expect(document.querySelector("[data-back-to-top]")).toBeNull();
  });

  it("stays hidden without IntersectionObserver, and while the tour is open", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await mount();
    expect(floating()).toBeNull();
    act(() => reactRoot.unmount());
    vi.stubGlobal("IntersectionObserver", class { entry = { callback: (() => undefined) as IntersectionObserverCallback, target: null as Element | null, disconnected: false }; constructor(cb: IntersectionObserverCallback) { this.entry.callback = cb; observers.push(this.entry); } observe(target: Element) { this.entry.target = target; } disconnect() { this.entry.disconnected = true; } });
    reactRoot = createRoot(host);
    await mount();
    await observe(false, 1200);
    expect(floating()).not.toBeNull();
    await click(button("Take the tour"));
    expect(floating()).toBeNull();
  });

  it("reads where the section is from the observer entry", () => {
    const entry = (isIntersecting: boolean, top: number, rootTop: number | null) => ({ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: rootTop === null ? null : ({ top: rootTop } as DOMRectReadOnly) });
    expect(unlockPlace(entry(true, -50, 0))).toBe("in-view");
    expect(unlockPlace(entry(false, 900, 0))).toBe("below");
    expect(unlockPlace(entry(false, 0, 0))).toBe("below");
    expect(unlockPlace(entry(false, -1, 0))).toBe("above");
    expect(unlockPlace(entry(false, 5, 10))).toBe("above");
    expect(unlockPlace(entry(false, 5, null))).toBe("below");
  });
});

describe("restore code", () => {
  function seedUnlocks(...packs: ReturnType<typeof fakePack>[]) {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(packs));
  }
  const output = () => document.querySelector<HTMLInputElement>("[data-restore-output]");
  const pasteBox = () => document.querySelector<HTMLInputElement>("[data-restore-input]")!;

  it("is offered only once something is unlocked, with the warning in view", async () => {
    await mount();
    expect(button("Get my restore code")!.disabled).toBe(true);
    expect(unlockSection().querySelector("[data-restore-warning]")!.textContent).toBe(RESTORE_WARNING);
    expect(RESTORE_WARNING).toMatch(/Don't post it publicly/);
  });

  it("shows the code masked until Reveal, copies it, and has no way to share or send it", async () => {
    seedUnlocks(fakePack(1, "Fake One"));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = vi.fn();
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    await mount();
    expect(output()).toBeNull();
    await click(button("Get my restore code"));
    await untilShown(output);
    const field = output()!;
    expect(field.type).toBe("text");
    expect(field.dataset.masked).toBe("true");
    expect(field.classList.contains("beeline-masked")).toBe(true);
    expect(field.readOnly).toBe(true);
    expect(field.value).toMatch(/^BEELINE-RESTORE-1\./);
    const code = field.value;
    expect(document.body.textContent).not.toContain(code);
    const reveal = button("Reveal")!;
    expect(reveal.getAttribute("aria-pressed")).toBe("false");
    await click(reveal);
    expect(output()!.type).toBe("text");
    expect(output()!.dataset.masked).toBe("false");
    expect(output()!.classList.contains("beeline-masked")).toBe(false);
    expect(button("Hide")!.getAttribute("aria-pressed")).toBe("true");
    await click(button("Hide"));
    expect(output()!.dataset.masked).toBe("true");
    expect(output()!.classList.contains("beeline-masked")).toBe(true);
    await click(button("Copy code"));
    expect(writeText).toHaveBeenCalledWith(code);
    expect(document.querySelector("[data-restore-code] [role=status]")!.textContent).toBe("Copied. Paste it only into BeeLine on your own device.");
    expect(share).not.toHaveBeenCalled();
    const labels = [...unlockSection().querySelectorAll("button, a")].map((item) => item.textContent ?? "");
    expect(labels.some((label) => /share|email|send|post|upload/i.test(label))).toBe(false);
    for (const spy of logged) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(code.slice(20, 60));
    await click(button("Done"));
    expect(output()).toBeNull();
  });

  it("explains when the browser blocks copying", async () => {
    seedUnlocks(fakePack(1, "Fake One"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    await mount();
    await click(button("Get my restore code"));
    await untilShown(output);
    await click(button("Copy code"));
    expect(document.querySelector("[data-restore-code] [role=status]")!.textContent).toMatch(/^Copy was blocked/);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await click(button("Copy code"));
    expect(document.querySelector("[data-restore-code] [role=status]")!.textContent).toMatch(/^This browser won't let BeeLine copy/);
  });

  it("restores on another device: validates, merges with the unlocks there, and clears the box", async () => {
    seedUnlocks(fakePack(1, "Fake One"), fakePack(2, "Fake Two"));
    await mount();
    await click(button("Get my restore code"));
    await untilShown(output);
    const code = output()!.value;
    // "Another device": only pack 2 and a third pack are unlocked there.
    act(() => reactRoot.unmount());
    localStorage.clear();
    localStorage.setItem(TOUR_KEY, "declined");
    seedUnlocks(fakePack(2, "Fake Two"), fakePack(3, "Fake Three"));
    reactRoot = createRoot(host);
    await mount();
    expect(pasteBox().type).toBe("text");
    expect(pasteBox().classList.contains("beeline-masked")).toBe(true);
    await type(pasteBox(), `\n${code}\n`);
    await submit(pasteBox().form!);
    expect(document.querySelector("[data-restore-code] form [role=status]")!.textContent).toBe("Restored 1 unlocked folder on this device. 1 deck list here was as new or newer, so it was kept.");
    expect(pasteBox().value).toBe("");
    const stored = JSON.parse(localStorage.getItem(UNLOCK_KEY)!) as Array<{ packHash: string; folderId?: string }>;
    expect(stored.map((item) => item.packHash)).toEqual([2, 3, 1].map((n) => packHash(fakeFolder(n))));
    expect(stored.every((item) => item.folderId === undefined)).toBe(true);
    expect(document.body.textContent).toContain("Fake One");
  });

  it("never uses a password input: both code fields are text masked with CSS, so no browser offers to save the code", async () => {
    seedUnlocks(fakePack(1, "Fake One"));
    await mount();
    await click(button("Get my restore code"));
    await untilShown(output);
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    for (const field of [output()!, pasteBox()]) {
      expect(field.getAttribute("type")).toBe("text");
      expect(field.classList.contains("beeline-masked")).toBe(true);
      expect(field.dataset.masked).toBe("true");
      expect(field.getAttribute("autocomplete")).toBe("off");
      expect(field.getAttribute("data-lpignore")).toBe("true");
      expect(field.hasAttribute("data-1p-ignore")).toBe(true);
    }
    expect(pasteBox().form).not.toBeNull();
    expect(pasteBox().form!.querySelector('input[type="password"]')).toBeNull();
    const css = readFileSync(path.join(root, "src/index.css"), "utf8");
    const rule = /\.beeline-masked\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/-webkit-text-security:\s*disc/);
    expect(rule).toMatch(/(^|[^-])text-security:\s*disc/);
    expect(css).toMatch(/@supports not \(\(-webkit-text-security: disc\) or \(text-security: disc\)\)\s*\{\s*[^@]*\.beeline-masked\s*\{[^}]*color:\s*transparent/);
  });

  it("fails with a clear message and changes nothing for a bad code", async () => {
    seedUnlocks(fakePack(2, "Fake Two"));
    const before = localStorage.getItem(UNLOCK_KEY);
    await mount();
    await type(pasteBox(), "https://drive.google.com/drive/folders/nope");
    await submit(pasteBox().form!);
    const alert = document.querySelector<HTMLElement>("[data-restore-code] [role=alert]")!;
    expect(alert.textContent).toBe(RESTORE_ERRORS.notCode);
    expect(pasteBox().getAttribute("aria-invalid")).toBe("true");
    expect(pasteBox().getAttribute("aria-describedby")).toBe(alert.id);
    expect(localStorage.getItem(UNLOCK_KEY)).toBe(before);
    await type(pasteBox(), "BEELINE-RESTORE-1.zAAAA.00000000");
    expect(document.querySelector("[data-restore-code] [role=alert]")).toBeNull();
    await submit(pasteBox().form!);
    expect(document.querySelector("[data-restore-code] [role=alert]")!.textContent).toBe(RESTORE_ERRORS.damaged);
    expect(localStorage.getItem(UNLOCK_KEY)).toBe(before);
  });

  it("warns and shows no code when the unlocks here are too many for one code", async () => {
    // Two buyers' worth of Partial Foil unlocks (22 folders): the code would be over 1 MB.
    const packs = [...allPartialFoilPacks(), ...allPartialFoilPacks({ seed: 38 })];
    localStorage.setItem(UNLOCK_KEY, JSON.stringify(packs.map(packForStorage)));
    await mount();
    await click(button("Get my restore code"));
    await untilShown(() => document.querySelector("[data-restore-problem]"));
    const problem = document.querySelector<HTMLElement>("[data-restore-problem]")!;
    expect(problem.getAttribute("role")).toBe("alert");
    expect(problem.textContent).toMatch(/^There are too many unlocked folders on this device for one restore code: it would be [\d,]+ KB, and BeeLine reads codes up to 1,024 KB\. No code was made\./);
    expect(output()).toBeNull();
    expect(document.body.textContent).not.toContain("BEELINE-RESTORE-1.");
  }, 30_000);

  it("drops a shown code when the unlocks change", async () => {
    seedUnlocks(fakePack(1, "Fake One"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount();
    await click(button("Get my restore code"));
    await untilShown(output);
    expect(output()).not.toBeNull();
    await click(button("Forget unlocked folders on this device"));
    expect(output()).toBeNull();
    expect(button("Get my restore code")!.disabled).toBe(true);
  });
});

describe("Partial Foil Map links and unlocks (v0.1.38)", () => {
  // A Partial Foil unlock as an older BeeLine saved it from a pasted map folder: named for the folder.
  const mapPack = (n: number, name: string, cards: number) => ({
    packHash: packHash(fakeFolder(n)),
    savedAt: `2026-11-0${n}T00:00:00.000Z`,
    catalogue: {
      ...TMNT,
      id: `map-${n}`,
      name,
      editions: TMNT.editions.slice(0, 1).map((edition) => ({ ...edition, id: `pf-${n}`, name: "Partial Foil", printType: "partial_foil" as const, cards: edition.cards.slice(0, cards) })),
    },
  });
  const realPack = () => ({ ...mapPack(3, "KPDH", 5), catalogue: { ...mapPack(3, "KPDH", 5).catalogue, id: "kpdh" } });
  const warning = () => unlockSection().querySelector<HTMLElement>("[data-unlock-warning]");
  /** A restore code as v0.1.37 made it: plain JSON, packs as stored, map folders included. */
  const olderCode = (packs: unknown[]) => {
    const text = JSON.stringify({ kind: "beeline-unlocks", version: 1, packs });
    const body = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `BEELINE-RESTORE-1.j${body}.${sha256Hex(text).slice(0, 8)}`;
  };

  function driveWith(items: Record<string, { name: string; children?: string[]; mimeType?: string }>) {
    const listed: string[] = [];
    window.PRINTABEE_CONFIG = { googleApiKey: "test-key-made-up" } as typeof window.PRINTABEE_CONFIG;
    vi.stubGlobal("fetch", async (input: string) => {
      const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
      if (url.includes("googleapis.com")) {
        const parent = /'([^']+)' in parents/.exec(url)?.[1];
        if (parent) {
          listed.push(parent);
          return new Response(JSON.stringify({ files: (items[parent]?.children ?? []).map((id) => ({ id, name: items[id]!.name, mimeType: items[id]!.mimeType ?? "application/vnd.google-apps.folder" })) }));
        }
        const id = /\/files\/([^?/]+)/.exec(url)![1]!;
        return new Response(JSON.stringify({ id, name: items[id]!.name, mimeType: items[id]!.mimeType ?? "application/vnd.google-apps.folder" }));
      }
      const name = String(url).split("/").pop()!;
      if (name === "index.json") return new Response(JSON.stringify({ decks: [{ id: "tmnt", name: "TMNT", file: "decks/tmnt.json" }, { id: "x-men", name: "X-Men", file: "decks/x-men.json" }] }));
      return new Response(deckFile(name.replace(/\.json$/, "")));
    });
    return listed;
  }
  async function paste(link: string) {
    const input = document.querySelector<HTMLInputElement>("#drive-link")!;
    await type(input, link);
    await act(async () => {
      input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 20; i += 1) await settle(2);
  }
  afterEach(() => {
    delete (window as { PRINTABEE_CONFIG?: unknown }).PRINTABEE_CONFIG;
  });

  for (const name of ["Partial Foil Map", "PDF Partial Foil Map", "  pdf PARTIAL  foil map "]) {
    it(`refuses a pasted "${name}" link with the warning in the unlock box, and saves nothing`, async () => {
      const listed = driveWith({ mapUiFolder01: { name, children: ["maskUiFile01"] }, maskUiFile01: { name: "Sol Ring.png", mimeType: "image/png" } });
      await mount();
      expect(warning()).toBeNull();
      await paste("https://drive.google.com/drive/folders/mapUiFolder01");
      expect(warning()!.getAttribute("role")).toBe("alert");
      expect(warning()!.textContent).toBe(MAP_LINK_GENERIC);
      expect(warning()!.querySelector("svg")).not.toBeNull();
      expect(listed).toEqual([]);
      expect(localStorage.getItem(UNLOCK_KEY)).toBeNull();
      expect(document.body.textContent).not.toContain("Unlocked ");
      // The page-top alert is for other problems; this warning sits under the link field.
      expect(document.querySelectorAll("[role=alert]")).toHaveLength(1);
      expect(button("Get my restore code")!.disabled).toBe(true);
      // The next paste starts clean: the warning goes, and any other problem shows as before.
      await paste("not a link");
      expect(warning()).toBeNull();
      expect(document.querySelector("[role=alert]")!.textContent).toBe("Paste a Google Drive folder link, the kind on a Ko-fi order page.");
    });
  }

  it("drops map unlocks saved by an older BeeLine on load, keeps the rest, and says why", async () => {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify([mapPack(1, "PDF Partial Foil Map", 100), realPack(), mapPack(2, "Partial Foil Map", 0)]));
    await mount();
    expect(warning()!.textContent).toBe(MAP_LINK_GENERIC);
    const stored = JSON.parse(localStorage.getItem(UNLOCK_KEY)!) as Array<{ catalogue: { name: string } }>;
    expect(stored.map((item) => item.catalogue.name)).toEqual(["KPDH"]);
    expect(document.body.textContent).toContain("KPDH");
    expect(document.body.textContent).not.toContain("PDF Partial Foil Map");
    expect(document.body.textContent).not.toMatch(/Partial Foil Map(?! folder)/);
    // Nothing to drop next time: no warning.
    await remount();
    expect(warning()).toBeNull();
  });

  it("shows no warning and rewrites nothing when no saved unlock is a map folder", async () => {
    const saved = JSON.stringify([realPack()]);
    localStorage.setItem(UNLOCK_KEY, saved);
    await mount();
    expect(warning()).toBeNull();
    expect(localStorage.getItem(UNLOCK_KEY)).toBe(saved);
  });

  it("leaves map folders in an older restore code out, shows the same warning, and makes no code with them", async () => {
    localStorage.setItem(UNLOCK_KEY, JSON.stringify([realPack()]));
    await mount();
    const box = document.querySelector<HTMLInputElement>("[data-restore-input]")!;
    await type(box, olderCode([mapPack(1, "PDF Partial Foil Map", 100), mapPack(4, "Fake Four", 2), mapPack(2, "Partial Foil Map", 0)]));
    await submit(box.form!);
    expect(document.querySelector("[data-restore-code] form [role=status]")!.textContent).toBe("Restored 1 unlocked folder on this device. 2 Partial Foil Map folders in the code were left out.");
    expect(warning()!.textContent).toBe(MAP_LINK_GENERIC);
    const stored = JSON.parse(localStorage.getItem(UNLOCK_KEY)!) as Array<{ catalogue: { name: string } }>;
    expect(stored.map((item) => item.catalogue.name)).toEqual(["KPDH", "Fake Four"]);
    // A code made here now carries only those two.
    await click(button("Get my restore code"));
    await untilShown(() => document.querySelector("[data-restore-output]"));
    const code = document.querySelector<HTMLInputElement>("[data-restore-output]")!.value;
    const { readRestoreCode } = await import("@/lib/restore-code");
    expect((await readRestoreCode(code)).map((item) => item.catalogue.name)).toEqual(["KPDH", "Fake Four"]);
  });

  it("says only the warning when every folder in an older code is a map folder", async () => {
    await mount();
    const box = document.querySelector<HTMLInputElement>("[data-restore-input]")!;
    await type(box, olderCode([mapPack(2, "Partial Foil Map", 0)]));
    await submit(box.form!);
    expect(document.querySelector("[data-restore-code] form [role=status]")!.textContent).toBe(MAP_LINK_GENERIC);
    expect(warning()!.textContent).toBe(MAP_LINK_GENERIC);
    expect(JSON.parse(localStorage.getItem(UNLOCK_KEY) ?? "[]")).toEqual([]);
  });
});

