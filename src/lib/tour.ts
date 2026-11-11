/**
 * The optional first-run tour: its steps and the one flag it stores.
 *
 * The flag has its own key, so the saved decks, unlocked folders and every other key are untouched.
 * It holds the answer to the first-run prompt ("taken" or "declined"); once it is set the prompt never
 * shows on its own again. The Tour button replays the tour at any time and does not change the flag.
 */
export const TOUR_KEY = "printabee.tour.v1";
export type TourAnswer = "taken" | "declined";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Offer the tour on first load only: no answer stored yet. If storage can't be read, don't nag. */
export function shouldOfferTour(store: Store): boolean {
  try {
    return store.getItem(TOUR_KEY) === null;
  } catch {
    return false;
  }
}

/** Remember the answer. A storage error is ignored: the tour is optional, and the prompt just shows again next time. */
export function rememberTourAnswer(store: Store, answer: TourAnswer): void {
  try {
    store.setItem(TOUR_KEY, answer);
  } catch {
    // Private mode or a full quota.
  }
}

export type TourView = "home" | "builder";

/** Shown on the first step when the tour starts in a deck: it keeps to the deck view so the deck stays as it is. */
export const TOUR_IN_DECK_INTRO =
  "You're in a deck, so the tour shows the deck view's steps and leaves this deck just as it is. Picking and unlocking decks are on the deck list: replay the tour from there to see those too.";

export type TourStep = {
  id: string;
  view: TourView;
  title: string;
  body: string;
  /** CSS selectors for the control to highlight; the first one that is on screen wins. */
  targets: string[];
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "deck",
    view: "home",
    title: "Pick a deck",
    body: "Press Build on any deck to open it as designed, one copy of each main-deck card. The Standard decks are free.",
    targets: ['[data-tour="decks"] li:first-child article', '[data-tour="decks"]'],
  },
  {
    id: "unlock",
    view: "home",
    title: "Unlock a paid deck",
    body: "Bought a Deluxe or Partial Foil deck? Paste the Google Drive folder link from your Ko-fi order into this box and press Unlock folder. It stays in this browser.",
    targets: ['[data-tour="unlock"]'],
  },
  {
    id: "art",
    view: "builder",
    title: "Swap art and backs",
    body: "Click a card's art to swap its front art and change its back: Card Back, Alt Back or Token Backs.",
    targets: ['button[aria-label^="Choose front art 1 for"]', 'button[aria-label^="Choose art 1 for"]'],
  },
  {
    id: "search",
    view: "builder",
    title: "Search and filter",
    body: "Type a card name, or Scryfall-style terms: t:creature c:g mv<=3 shows green creatures with mana value 3 or less. Searching never changes a count.",
    targets: ['input[aria-label="Search this deck"]'],
  },
  {
    id: "filters",
    view: "builder",
    title: "The Filters panel",
    body: "Filters opens the same search as buttons: color, card type, mana value, rarity, rules text, power, toughness, and quick toggles like In deck.",
    targets: ['button[aria-label="Filters"]'],
  },
  {
    id: "clear",
    view: "builder",
    title: "Clear all and Clear shown",
    body: "Clear all sets every card in the deck to 0. While a filter is on, Clear shown sets only the cards you can see to 0. Both have an Undo.",
    targets: ['[data-tour="clear"]'],
  },
];

/** The first element for these selectors that is on screen. jsdom lays nothing out, so there the first match counts. */
export function findTourTarget(selectors: string[], doc: Document = document): HTMLElement | null {
  const laidOut = !/jsdom/i.test(doc.defaultView?.navigator.userAgent ?? "");
  for (const selector of selectors) {
    const all = [...doc.querySelectorAll<HTMLElement>(selector)];
    const shown = laidOut ? all.find((element) => element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0) : all[0];
    if (shown) return shown;
  }
  return null;
}
