/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from "vitest";
import App from "@/App";
import { Splash, type SplashEnd } from "@/components/Splash";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "@/data/splash-assets";
import { freshDraft } from "@/lib/draft";
import {
  frameUrl,
  GENERIC_SPLASH_MS,
  rememberSplash,
  shouldPlaySplash,
  SPLASH_KEY_PREFIX,
  SPLASH_GRACE_MS,
  SPLASH_READY_TIMEOUT_MS,
  SPLASH_STATIC_MS,
  splashFor,
  splashKey,
  splashLimitMs,
  type SplashChoice,
} from "@/lib/splash";
import { LAST_SESSION_KEY, writeSaved } from "@/lib/storage";
import { TOUR_KEY } from "@/lib/tour";
import type { DeckCatalogue } from "@/lib/types";

// Every test here runs on a fake clock, so wall time never decides a result. The timeout only catches a
// hang: it is generous because a machine loaded by a mutation run can make one test take tens of seconds,
// and a test cut off by the default 5 s leaves its app mounted and fails the tests after it.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const root = path.resolve(import.meta.dirname, "../..");
const deckFile = (id: string) => readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8");
const TMNT = JSON.parse(deckFile("tmnt")) as DeckCatalogue;

let host: HTMLDivElement;
let reactRoot: Root;
let reduced: boolean;

/**
 * v0.1.35 flake fix. Under a mutation run one test could crawl past its timeout while still inside an
 * act() that wrapped vi.advanceTimersByTimeAsync. Its act() scope stayed open, the next tests' act() calls
 * overlapped it ("You seem to have overlapping act() calls"), and its still-mounted app failed every test
 * after it. Now:
 *  - the fake clock is advanced outside act(), so no act() scope is open while timers run, and React's
 *    work from them is flushed by a short act() afterwards;
 *  - every step runs through one queue tagged with the test it belongs to. A step from a test that has
 *    ended throws instead of touching the page, and afterEach waits for the last step before it unmounts.
 *  - afterEach clears the fake timers, unmounts inside an awaited act() and empties the page, so nothing
 *    of one test is left for the next; when a test fails or times out it logs what it was doing (the step
 *    running and for how long, the steps done, pending fake timers, and what the page showed).
 */
let currentTest = 0;
let lastStep: Promise<unknown> = Promise.resolve();
/** The step running now (for the timeout log), and how many steps this test has finished. */
let running: { label: string; since: number } | null = null;
let stepsDone = 0;
const realSetTimeout = globalThis.setTimeout;
class EndedTest extends Error {}
function step<T>(work: () => Promise<T>, label = "step"): Promise<T> {
  const mine = currentTest;
  const run = lastStep.then(async () => {
    if (mine !== currentTest) throw new EndedTest("this test already ended");
    running = { label, since: performance.now() };
    try {
      const out = await work();
      if (mine !== currentTest) throw new EndedTest("this test already ended");
      stepsDone += 1;
      return out;
    } finally {
      running = null;
    }
  });
  lastStep = run.catch(() => undefined);
  return run;
}
/** One line of what the page and the clock were doing, for a test that failed or timed out. */
function diagnostics(): string {
  const text = (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const parts = [
    running ? `running step “${running.label}” for ${Math.round(performance.now() - running.since)} ms` : "no step running",
    `${stepsDone} steps done`,
    `fake timers ${vi.isFakeTimers() ? `on, ${vi.getTimerCount()} pending` : "off"}`,
    `splash ${splash() ? "open" : "closed"}`,
    `builder ${inBuilder() ? "open" : "closed"}`,
    `focus ${document.activeElement?.tagName.toLowerCase() ?? "none"}`,
    `page “${text}”`,
  ];
  return parts.join("; ");
}
/** Fires due fake timers outside act(), with React's act-environment flag off so their updates schedule as in a browser. */
async function fireTimers(ms: number) {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await vi.advanceTimersByTimeAsync(ms);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = true;
  }
}
/** Lets React finish what is pending: a real macrotask turn (setImmediate is not faked) inside one act(). */
async function flushReact() {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}
/**
 * Lets React and pending promises run. Under the fake clock nothing moves on its own: time only passes
 * when a test says so, so `settle()` steps the fake clock by `ms` (0 runs only what is already due).
 */
function settle(ms = 0) {
  return step(async () => {
    if (vi.isFakeTimers()) await fireTimers(ms);
    else await new Promise((resolve) => setTimeout(resolve, ms));
    await flushReact();
  }, `settle ${ms} ms`);
}
/**
 * Fake timers that do not tick with real time: a splash's seconds-long timers fire only when a test
 * advances the clock (elapse), never because the machine was slow. Only the timer functions are faked, so
 * React's scheduler (setImmediate / MessageChannel) and promises still run as usual.
 */
function fakeClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
}
async function elapse(ms: number) {
  await settle(ms);
  await settle();
}
async function mount() {
  await step(() =>
    act(async () => {
      reactRoot.render(<App />);
    }),
  "mount");
  for (let i = 0; i < 5; i += 1) await settle();
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text);
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await step(() => act(async () => (element as HTMLElement).click()), `click “${element.textContent?.trim().slice(0, 40) || element.getAttribute("aria-label") || element.tagName}”`);
  await settle();
}
async function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  await step(() =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }),
  `press ${key}`);
  await settle();
}
const splash = () => document.querySelector<HTMLElement>("[data-splash]");
const inBuilder = () => Boolean(document.querySelector('input[aria-label="Search this deck"]'));
const total = () => [...document.querySelectorAll("p")].find((item) => /^\d+ cards?/.test(item.textContent?.trim() ?? ""))?.textContent?.trim() ?? null;
const localKeys = () => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]));
const sessionKeys = () => Object.keys(sessionStorage).sort();
const frameEl = () => document.querySelector<HTMLIFrameElement>("[data-splash] iframe");
/** What Frame Lab's page posts to the app, from inside the splash's own frame. */
async function fromFrame(type: string) {
  await step(() => act(async () => window.dispatchEvent(new MessageEvent("message", { data: { type }, source: frameEl()!.contentWindow }))), `frame posts ${type}`);
  await settle();
}

beforeEach(() => {
  currentTest += 1;
  lastStep = Promise.resolve();
  running = null;
  stepsDone = 0;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(TOUR_KEY, "declined");
  reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") ? true : query.includes("reduced-motion") ? reduced : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal("fetch", async (url: string) => {
    const name = String(url).split("/").pop()!;
    if (name === "index.json") return new Response(JSON.stringify({ decks: [{ id: "tmnt", name: "TMNT", file: "decks/tmnt.json" }, { id: "x-men", name: "X-Men", file: "decks/x-men.json" }] }));
    return new Response(deckFile(name.replace(/\.json$/, "")));
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  // Every test runs on the fake clock, so no splash ends because the machine was slow.
  fakeClock();
});
afterEach(async (context: TestContext) => {
  const result = context.task.result;
  const errors = result?.errors ?? [];
  const timedOut = errors.some((error) => /timed out/i.test(String(error?.message ?? error)));
  if (timedOut || result?.state === "fail") console.error(`[splash-diag] ${timedOut ? "timed out" : "failed"}: ${context.task.name}: ${diagnostics()}`);
  // A step still running (a test cut off by its timeout) finishes before the app goes; then later steps
  // throw. A step that never finishes is given 20 s of real time, then logged and left behind.
  const pending = lastStep;
  currentTest += 1;
  const stuck = await Promise.race([pending.then(() => false), new Promise<boolean>((resolve) => realSetTimeout(() => resolve(true), 20_000))]);
  if (stuck) console.error(`[splash-diag] a step never finished after ${context.task.name}: ${diagnostics()}`);
  if (vi.isFakeTimers()) vi.clearAllTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => reactRoot.unmount());
  host.remove();
  document.body.innerHTML = "";
  running = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("splash test harness", () => {
  it("refuses a step that outlives its test, and runs steps one at a time", async () => {
    const order: string[] = [];
    const first = step(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      order.push("first");
    });
    const second = step(async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    const late = step(async () => "ran");
    currentTest += 1; // the test "ends" before the step gets its turn
    await expect(late).rejects.toBeInstanceOf(EndedTest);
    currentTest -= 1;
    await expect(step(async () => "ran")).resolves.toBe("ran");
  });
});

describe("splash bookkeeping", () => {
  it("keys each deck on its own in sessionStorage, and doesn't play when sessionStorage can't be used", () => {
    expect(splashKey("tmnt")).toBe("printabee.splash.v1.tmnt");
    expect(SPLASH_KEY_PREFIX.startsWith("printabee.")).toBe(true);
    const store = new Map<string, string>();
    const fake = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(shouldPlaySplash(fake, "tmnt")).toBe(true);
    expect(rememberSplash(fake, "tmnt")).toBe(true);
    expect(shouldPlaySplash(fake, "tmnt")).toBe(false);
    expect(shouldPlaySplash(fake, "x-men")).toBe(true);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldPlaySplash(broken, "tmnt")).toBe(false);
    expect(rememberSplash(broken, "tmnt")).toBe(false);
    expect(shouldPlaySplash(null, "tmnt")).toBe(false);
    expect(shouldPlaySplash(fake, "")).toBe(false);
  });

  it("uses the deck's registry entry, else the BeeLine fallback, else the generic splash; Frame Lab's pages load without their own Skip", () => {
    expect(splashFor("vader", SPLASH_ASSETS, SPLASH_FALLBACK)).toEqual(SPLASH_ASSETS.vader);
    expect(splashFor("horror-movie-poster-secret-lair", SPLASH_ASSETS, SPLASH_FALLBACK)).toMatchObject({ kind: "frame", src: "splash/splashes/horror-c.html" });
    expect(splashFor("silksong", SPLASH_ASSETS, SPLASH_FALLBACK)).toMatchObject({ kind: "frame", src: "splash/splashes/silksong.html" });
    expect(splashFor("a-deck-added-later", SPLASH_ASSETS, SPLASH_FALLBACK)).toEqual(SPLASH_FALLBACK);
    expect(SPLASH_FALLBACK).toMatchObject({ kind: "frame", src: "splash/splashes/beeline.html" });
    const registry = { vader: { kind: "frame", src: "splash/vader.html", durationMs: 2200, label: "Vader" } } as const;
    expect(splashFor("vader", registry)).toEqual(registry.vader);
    expect(splashFor("tmnt", registry)).toEqual({ kind: "generic", durationMs: GENERIC_SPLASH_MS });
    expect(splashFor("toString", registry)).toEqual({ kind: "generic", durationMs: GENERIC_SPLASH_MS });
    expect(splashFor("toString", registry, SPLASH_FALLBACK)).toEqual(SPLASH_FALLBACK);
    expect(splashFor("bad", { bad: { kind: "image", src: "", durationMs: 1000, label: "x" } })).toEqual({ kind: "generic", durationMs: GENERIC_SPLASH_MS });
    expect(splashFor("bad", {}, { kind: "frame", src: "", durationMs: 1000, label: "x" })).toEqual({ kind: "generic", durationMs: GENERIC_SPLASH_MS });
    expect(frameUrl("splash/vader.html", true)).toBe("splash/vader.html?noskip=1&poster=1");
    expect(frameUrl("splash/vader.html?x=1", true)).toBe("splash/vader.html?x=1&noskip=1&poster=1");
    expect(frameUrl("splash/vader.html", false)).toBe("splash/vader.html?noskip=1");
    expect(splashLimitMs({ kind: "generic", durationMs: GENERIC_SPLASH_MS }, true)).toBe(SPLASH_STATIC_MS);
    expect(splashLimitMs(registry.vader, false)).toBeGreaterThan(2200);
  });
});

describe("the deck splash in the app", () => {
  it("plays once per deck per session when a deck is built, over the open deck, and changes no count or save", async () => {
    await mount();
    const before = localKeys();
    await click(button("Build"));
    expect(splash()).not.toBeNull();
    expect(splash()!.dataset.splashKind).toBe("frame");
    expect(splash()!.getAttribute("aria-label")).toBe("TMNT: opening");
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/tmnt\.html\?noskip=1$/);
    expect(frameEl()!.getAttribute("sandbox")).toBe("allow-scripts");
    // The page's own backdrop colour shows while it loads.
    expect(splash()!.style.backgroundColor).toBe("rgb(11, 18, 13)");
    expect(sessionKeys()).toEqual(["printabee.splash.v1.tmnt"]);
    // The deck view is already open underneath.
    expect(inBuilder()).toBe(true);
    expect(document.activeElement?.hasAttribute("data-splash-skip")).toBe(true);
    await press("Escape");
    expect(splash()).toBeNull();
    expect(total()).toMatch(/^100 cards/);
    await click(button("Decks"));
    await click(button("Build"));
    expect(splash()).toBeNull();
    await click(button("Decks"));
    const builds = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.trim() === "Build");
    await click(builds[1]);
    expect(splash()).not.toBeNull();
    expect(splash()!.getAttribute("aria-label")).toBe("X-Men: opening");
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/xmen\.html\?noskip=1$/);
    await click(splash());
    expect(splash()).toBeNull();
    expect(sessionKeys()).toEqual(["printabee.splash.v1.tmnt", "printabee.splash.v1.x-men"]);
    // Only the Continue shortcut is new: the splash itself writes nothing to localStorage.
    const { [LAST_SESSION_KEY]: last, ...rest } = localKeys();
    expect(rest).toEqual(before);
    expect(JSON.parse(last!).deckId).toBe("x-men");
  });

  it("is skipped by a click or tap anywhere, by the Skip button, and closes on its own after it plays", async () => {
    fakeClock();
    await mount();
    await click(button("Build"));
    await click(button("Skip"));
    expect(splash()).toBeNull();
    sessionStorage.clear();
    await click(button("Decks"));
    await click(button("Build"));
    expect(splash()).not.toBeNull();
    await fromFrame("beeline-splash:ready");
    await elapse(SPLASH_ASSETS.tmnt!.durationMs + SPLASH_GRACE_MS - 300);
    expect(splash()).not.toBeNull();
    await elapse(400);
    expect(splash()).toBeNull();
    expect(total()).toMatch(/^100 cards/);
    // Frame Lab's page says when it is done.
    sessionStorage.clear();
    await click(button("Decks"));
    await click(button("Build"));
    await fromFrame("beeline-splash:ready");
    await fromFrame("beeline-splash:end");
    expect(splash()).toBeNull();
  });

  it("gives focus to the deck heading when it closes, as the Build button that opened it is gone", async () => {
    fakeClock();
    await mount();
    const build = button("Build")!;
    build.focus();
    await click(build);
    expect(build.isConnected).toBe(false);
    await press("Escape");
    expect(splash()).toBeNull();
    expect(document.activeElement?.hasAttribute("data-deck-heading")).toBe(true);
    expect(document.activeElement?.textContent).toContain("TMNT");
    // A missing page closes it too, with focus in the same place.
    sessionStorage.clear();
    await click(button("Decks"));
    await click(button("Build"));
    await elapse(SPLASH_READY_TIMEOUT_MS + 100);
    expect(splash()).toBeNull();
    expect(document.activeElement?.hasAttribute("data-deck-heading")).toBe(true);
    expect(total()).toMatch(/^100 cards/);
  });

  it("plays Frame Lab's BeeLine splash for a deck without its own", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!;
      if (name === "index.json") return new Response(JSON.stringify({ decks: [{ id: "tmnt-reissue", name: "TMNT reissue", file: "decks/tmnt.json" }] }));
      return new Response(JSON.stringify({ ...TMNT, id: "tmnt-reissue", name: "TMNT reissue" }));
    });
    await mount();
    await click(button("Build"));
    expect(splash()).not.toBeNull();
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/beeline\.html\?noskip=1$/);
    expect(splash()!.style.backgroundColor).toBe("rgb(213, 117, 40)");
  });

  it("plays Persona 5's and SxF's splash for a pasted P5 or Spy x Family edition, keyed by its own deck id", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!;
      if (name === "index.json") return new Response(JSON.stringify({ decks: [{ id: "p5", name: "P5", file: "decks/p5.json" }, { id: "spy-x-family", name: "Spy x Family", file: "decks/spy-x-family.json" }] }));
      if (name === "p5.json") return new Response(JSON.stringify({ ...TMNT, id: "p5", name: "P5" }));
      return new Response(JSON.stringify({ ...TMNT, id: "spy-x-family", name: "Spy x Family" }));
    });
    await mount();
    await click(button("Build"));
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/persona5\.html\?noskip=1$/);
    expect(sessionKeys()).toEqual(["printabee.splash.v1.persona-5"]);
    await press("Escape");
    await click(button("Decks"));
    const builds = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent?.trim() === "Build");
    await click(builds[1]);
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/sxf\.html\?noskip=1$/);
    expect(splash()!.getAttribute("aria-label")).toBe("Spy x Family: opening");
  });

  it("shows a still frame with reduced motion, and it ends on its own", async () => {
    reduced = true;
    fakeClock();
    await mount();
    await click(button("Build"));
    expect(splash()!.dataset.splashMotion).toBe("still");
    expect(frameEl()!.getAttribute("src")).toMatch(/splash\/splashes\/tmnt\.html\?noskip=1&poster=1$/);
    await fromFrame("beeline-splash:ready");
    await elapse(SPLASH_STATIC_MS + 100);
    expect(splash()).toBeNull();
  });

  it("plays for a saved deck and for Continue, once per deck", async () => {
    writeSaved(localStorage, [{ ...freshDraft(TMNT, TMNT.editions[0]!, "saved-1", new Date("2026-11-01T00:00:00Z")), name: "My TMNT" }]);
    await mount();
    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => /^Open/.test(item.textContent?.trim() ?? "") || item.getAttribute("aria-label")?.startsWith("Open My TMNT"));
    await click(open);
    expect(inBuilder()).toBe(true);
    expect(splash()).not.toBeNull();
    await press("Escape");
    await click(button("Decks"));
    await click(button("Continue"));
    expect(splash()).toBeNull();
    sessionStorage.clear();
    await click(button("Decks"));
    await click(button("Continue"));
    expect(splash()).not.toBeNull();
  });

  it("keeps Tab, Enter and clicks away from the page while it shows", async () => {
    await mount();
    await click(button("Build"));
    const skip = document.querySelector<HTMLElement>("[data-splash-skip]")!;
    expect(host.hasAttribute("inert")).toBe(true);
    await step(() => act(async () => button("Clear all")!.focus()));
    expect(document.activeElement).toBe(skip);
    await step(() => act(async () => button("Save")!.focus()));
    expect(document.activeElement).toBe(skip);
    // Skip is the only control: Tab on it stays put instead of leaving for the browser and coming back.
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await step(() => act(async () => skip.dispatchEvent(tab)));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(skip);
    await step(() => act(async () => skip.blur()));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await step(() => act(async () => document.body.dispatchEvent(enter)));
    expect(enter.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(skip);
    expect(button("Undo Clear all")).toBeUndefined();
    await press("Escape");
    expect(host.hasAttribute("inert")).toBe(false);
    expect(total()).toMatch(/^100 cards/);
  });

  it("waits for the tour: never plays for the tour's preview deck, and the first-run prompt waits under it", async () => {
    await mount();
    await click(button("Take the tour"));
    await click(button("Next"));
    await click(button("Next"));
    expect(inBuilder()).toBe(true);
    expect(splash()).toBeNull();
    expect(sessionKeys()).toEqual([]);
    await press("Escape");
    // First visit: the prompt is up when the deck is opened; it waits until the splash is gone.
    localStorage.removeItem(TOUR_KEY);
    act(() => reactRoot.unmount());
    reactRoot = createRoot(host);
    await mount();
    expect(document.querySelector("[data-tour-prompt]")).not.toBeNull();
    await click(button("Build"));
    expect(splash()).not.toBeNull();
    expect(document.querySelector("[data-tour-prompt]")).toBeNull();
    await press("Escape");
    expect(document.querySelector("[data-tour-prompt]")).not.toBeNull();
  });
});

describe("splash assets", () => {
  function renderSplash(choice: SplashChoice, onDone: (end: SplashEnd) => void, reducedMotion = false) {
    act(() => reactRoot.render(<Splash deckName="Vader" choice={choice} reducedMotion={reducedMotion} onDone={onDone} />));
  }
  const frame: SplashChoice = { kind: "frame", src: "splash/vader.html", durationMs: 2200, label: "Vader" };

  it("skips a frame splash that never says it is ready (missing file)", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    renderSplash(frame, done);
    expect(document.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-scripts");
    act(() => vi.advanceTimersByTime(SPLASH_READY_TIMEOUT_MS - 1));
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(done).toHaveBeenCalledWith("failed");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("plays a frame splash once it is ready, ends on its end message, and ignores messages from anywhere else", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    renderSplash(frame, done);
    const iframe = document.querySelector("iframe")!;
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "beeline-splash:end" }, source: window })));
    expect(done).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "beeline-splash:ready" }, source: iframe.contentWindow })));
    act(() => vi.advanceTimersByTime(SPLASH_READY_TIMEOUT_MS + 10));
    expect(done).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "beeline-splash:end" }, source: iframe.contentWindow })));
    expect(done).toHaveBeenCalledWith("complete");
  });

  it("loads a frame splash on its poster frame with reduced motion", () => {
    renderSplash(frame, vi.fn(), true);
    expect(document.querySelector("iframe")!.getAttribute("src")).toMatch(/splash\/vader\.html\?noskip=1&poster=1$/);
  });

  it("skips an image splash that fails to load", () => {
    const done = vi.fn();
    renderSplash({ kind: "image", src: "splash/missing.webp", durationMs: 1800, label: "Vader" }, done);
    act(() => {
      document.querySelector("[data-splash-asset]")!.dispatchEvent(new Event("error"));
    });
    expect(done).toHaveBeenCalledWith("failed");
  });
});
