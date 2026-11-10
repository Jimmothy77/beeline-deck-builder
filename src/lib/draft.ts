import { DECKLIST_FILE, defaultDecklist, withDecklist } from "@/lib/decklist";
import { normalizeKey, slug } from "@/lib/names";
import { countCopies, designedSelection, hasToneChoice } from "@/lib/selection";
import type { SavedDeck } from "@/lib/storage";
import type { DeckCatalogue, Decklist, Edition } from "@/lib/types";

/**
 * A new deck. It opens on the edition's default list, or one of every
 * main-folder card when the edition has no list. SxF opens on Color.
 */
export function freshDraft(deck: DeckCatalogue, edition: Edition, id: string = crypto.randomUUID(), now: Date = new Date()): SavedDeck {
  const list = defaultDecklist(edition);
  return {
    id,
    name: `${deck.name} · ${edition.name}`,
    deckId: deck.id,
    deckName: deck.name,
    editionId: edition.sourceId ?? edition.id,
    editionName: edition.name,
    packHash: edition.packHash,
    printType: edition.printType,
    treatment: null,
    cardbackId: edition.backs[0]?.id ?? null,
    printFlipBacksAsFronts: false,
    ...(list ? { decklistId: list.id } : {}),
    ...(hasToneChoice(edition) ? { tone: "color" as const } : {}),
    cards: designedSelection(withDecklist(edition, list)),
    updatedAt: now.toISOString(),
  };
}

/**
 * How many copies a new deck of this edition opens with: the default list's
 * total (Complete Collection when there is one, otherwise the first list), or
 * the folder counts when the edition has no list. The same rule as freshDraft.
 */
export function openingCopies(edition: Edition): number {
  return countCopies(designedSelection(withDecklist(edition, defaultDecklist(edition))));
}

/**
 * Shipped lists an unlock may fall back to when it can't read a folder's own
 * list file. A labeled file name is specific to one deck. A bare decklist.txt
 * is only taken from the same deck.
 */
export function bundledDecklistsFor(shipped: DeckCatalogue[], deckName: string): Decklist[] {
  const id = slug(deckName);
  const key = normalizeKey(deckName);
  const out: Decklist[] = [];
  for (const deck of shipped) {
    const same = deck.id === id || normalizeKey(deck.name) === key;
    for (const edition of deck.editions) {
      for (const list of edition.decklists ?? []) {
        const labeled = Boolean(DECKLIST_FILE.exec(list.fileName)?.[1]);
        if ((labeled || same) && !out.some((item) => item.fileName.toLowerCase() === list.fileName.toLowerCase())) out.push(list);
      }
    }
  }
  return out;
}
