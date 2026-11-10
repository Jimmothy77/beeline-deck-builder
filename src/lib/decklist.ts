import { naturalCompare, normalizeKey, slug } from "@/lib/names";
import type { CatalogueNote, DeckCard, Decklist, DecklistEntry, Edition } from "@/lib/types";

/** `decklist.txt` or `decklist - <label>.txt`, sitting directly in an edition folder. */
export const DECKLIST_FILE = /^decklist(?:\s*-\s*(.+?))?\s*\.txt$/i;

export function isDecklistFile(name: string): boolean {
  return DECKLIST_FILE.test(name.trim());
}

/** Dropdown label: the text after "decklist - ". A bare decklist.txt uses the list's own name, then "Deck list". */
export function decklistLabel(fileName: string, title?: string | null): string {
  const label = fileName.trim().match(DECKLIST_FILE)?.[1]?.trim();
  if (label) return label;
  const fromTitle = (title ?? "").replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  return fromTitle || "Deck list";
}

type Section = "commander" | "main" | "sideboard" | "ignored";

const SECTION_HEADERS: Record<string, Section> = {
  commander: "commander",
  commanders: "commander",
  deck: "main",
  main: "main",
  mainboard: "main",
  "main deck": "main",
  sideboard: "sideboard",
  maybeboard: "ignored",
  considering: "ignored",
  acquireboard: "ignored",
};

/** `1x Name (SET) 123`, `1x Name (SET)`, `1 Name`, and `1x Name`. Foil and tag markers after the name are dropped. */
const ENTRY = /^(\d+)\s*x?\s+(.+?)\s*$/i;
const SET_TAIL = /\s+\(([A-Za-z0-9]{2,8})\)(?:\s+([A-Za-z0-9★-]+))?$/;

export function parseEntry(line: string): DecklistEntry | null {
  const match = line.trim().match(ENTRY);
  if (!match?.[1] || !match[2]) return null;
  const qty = Number(match[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  let rest = match[2].replace(/\s+\*[A-Za-z]+\*/g, "").replace(/\s+#\S+/g, "").trim();
  let set: string | undefined;
  let number: string | undefined;
  const tail = rest.match(SET_TAIL);
  if (tail) {
    set = tail[1]!.toUpperCase();
    number = tail[2] || undefined;
    rest = rest.slice(0, tail.index).trim();
  }
  if (!rest) return null;
  return { qty: Math.min(99, Math.trunc(qty)), name: rest, ...(set ? { set } : {}), ...(number ? { number } : {}) };
}

function pushMerged(list: DecklistEntry[], entry: DecklistEntry) {
  const key = normalizeKey(entry.name);
  const existing = list.find((item) => normalizeKey(item.name) === key);
  if (existing) existing.qty = Math.min(99, existing.qty + entry.qty);
  else list.push({ ...entry });
}

/**
 * Parse a Tapped Out text export. Commander and Deck lines are the print list.
 * Sideboard lines are kept apart and are not part of the main-deck counts.
 * A file with no section headers is read as one main list.
 */
export function parseDecklist(text: string, fileName: string): Decklist {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  let section: Section | "about" = "main";
  let sawHeader = false;
  let title: string | undefined;
  const commander: DecklistEntry[] = [];
  const main: DecklistEntry[] = [];
  const sideboard: DecklistEntry[] = [];
  const skipped: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.replace(/:$/, "").toLowerCase();
    if (header === "about") {
      section = "about";
      sawHeader = true;
      continue;
    }
    if (SECTION_HEADERS[header]) {
      section = SECTION_HEADERS[header]!;
      sawHeader = true;
      continue;
    }
    if (section === "about") {
      const name = line.match(/^name\s+(.+)$/i);
      if (name?.[1] && !title) title = name[1].trim();
      continue;
    }
    const entry = parseEntry(line);
    if (!entry) {
      if (!/^\/\//.test(line)) skipped.push(line);
      continue;
    }
    if (section === "commander") pushMerged(commander, entry);
    else if (section === "sideboard") pushMerged(sideboard, entry);
    else if (section === "main") pushMerged(main, entry);
  }
  const label = decklistLabel(fileName, title);
  return {
    id: slug(label),
    label,
    fileName: fileName.trim(),
    ...(title ? { title } : {}),
    commander,
    main,
    sideboard,
    ...(skipped.length ? { skipped } : {}),
    ...(sawHeader ? {} : { plain: true }),
  };
}

/** Commander and Deck entries, merged by name. This is what the main deck is counted from. */
export function printList(list: Decklist): DecklistEntry[] {
  const out: DecklistEntry[] = [];
  for (const entry of [...list.commander, ...list.main]) pushMerged(out, entry);
  return out;
}

export function listTotal(entries: DecklistEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.qty, 0);
}

/** Lists in dropdown order: a bare decklist.txt first, then labels in natural order. Ids stay unique. */
export function orderDecklists(lists: Decklist[]): Decklist[] {
  const sorted = [...lists].sort((a, b) => {
    const bareA = !DECKLIST_FILE.exec(a.fileName)?.[1];
    const bareB = !DECKLIST_FILE.exec(b.fileName)?.[1];
    if (bareA !== bareB) return bareA ? -1 : 1;
    return naturalCompare(a.label, b.label);
  });
  const taken = new Set<string>();
  return sorted.map((list) => {
    let id = list.id || "deck-list";
    let n = 2;
    while (taken.has(id)) id = `${list.id}-${n++}`;
    taken.add(id);
    return id === list.id ? list : { ...list, id };
  });
}

/**
 * The list a new deck opens on. A "Complete Collection" list is preferred because
 * it holds every card in the folder, which is what the deck opened with before lists.
 */
export function defaultDecklist(edition: Pick<Edition, "decklists">): Decklist | null {
  const lists = edition.decklists ?? [];
  if (!lists.length) return null;
  return lists.find((list) => /complete collection/i.test(list.label)) ?? lists[0]!;
}

export function findDecklist(edition: Pick<Edition, "decklists">, id: string | null | undefined): Decklist | null {
  if (id === "") return null;
  const lists = edition.decklists ?? [];
  return (id ? lists.find((list) => list.id === id) : undefined) ?? defaultDecklist(edition);
}

const BASIC = /^(?:snow covered )?(plains|island|swamp|mountain|forest|wastes)$/;

function withoutParen(name: string): string {
  return name.replace(/\s*\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
}

/** Match keys for a list line: the whole name, and the front half of "A // B". */
export function entryKeys(name: string): string[] {
  const keys = new Set<string>();
  const whole = normalizeKey(withoutParen(name));
  if (whole) keys.add(whole);
  const front = name.split(/\s+\/\/?\s+/)[0];
  if (front && front !== name) {
    const key = normalizeKey(withoutParen(front));
    if (key) keys.add(key);
  }
  const basic = whole.replace(/^basic\s+/, "");
  if (BASIC.test(basic)) keys.add(basic);
  return [...keys];
}

/** "Forest1" and "Plains3" are numbered basics with the space left out. */
function unglue(key: string): string {
  return key.replace(/^([a-z]+)(\d+)\b/, "$1 $2");
}

/** A folder prefix such as "1 Island 4", "2 Swamp 1", or "1_2 Lost Vale". */
const FOLDER_PREFIX = /^\d+(?:_\d+)?\s+(?=[a-z])/i;

/** Match keys for a deck card: its front face and card name without the art theme, a variant number, or "Basic". */
export function cardKeys(card: Pick<DeckCard, "name" | "faces">): string[] {
  const keys = new Set<string>();
  const raw = [card.faces[0]?.name ?? "", card.name, card.name.split(/\s+\/\/\s+/)[0] ?? ""];
  const names = raw.flatMap((name) => (FOLDER_PREFIX.test(name) ? [name, name.replace(FOLDER_PREFIX, "")] : [name]));
  for (const name of names) {
    const plain = unglue(normalizeKey(withoutParen(name.replace(/\.psd$/i, ""))));
    if (!plain) continue;
    keys.add(plain);
    const unnumbered = plain.replace(/\s+\d+$/, "");
    const unbasic = unnumbered.replace(/^basic\s+/, "");
    if (BASIC.test(unbasic)) keys.add(unbasic);
    else if (unnumbered !== plain && unnumbered) keys.add(unnumbered);
  }
  return [...keys];
}

/** Insertions, deletions, substitutions, and adjacent swaps, capped at 3. */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return Math.min(3, d[a.length]![b.length]!);
}

type Near = (entryKey: string, cardKey: string) => boolean;

/** File names that are a near miss for a list line, tried in order. Each pairing must be one-to-one. */
const NEAR_MISSES: Near[] = [
  // "Assassn's Trophy", "Myriad Landcape", "Meathook Massacre II".
  (entry, card) => entry.length >= 8 && card.length >= 8 && editDistance(entry, card) <= 2,
  // "Reki, the History" for "Reki, the History of Kamigawa".
  (entry, card) => card.split(" ").length >= 2 && (entry.startsWith(`${card} `) || card.startsWith(`${entry} `)),
  // "Thopter Spy Factory" for "Thopter Spy Network": the same first two words.
  (entry, card) => {
    const left = entry.split(" ");
    const right = card.split(" ");
    return left.length >= 3 && right.length >= 3 && left[0] === right[0] && left[1] === right[1] && left[0]!.length + left[1]!.length >= 7;
  },
];

export function isBasicCard(card: Pick<DeckCard, "name" | "faces">): boolean {
  return cardKeys(card).some((key) => BASIC.test(key));
}

/** A main-deck token stays in the main deck at its folder count. */
export function isMainToken(card: Pick<DeckCard, "name" | "role">): boolean {
  return card.role === "main" && /^token\b/i.test(card.name.trim());
}

/**
 * A partial-foil "Flip 3" mask has no card title, so a name-based list cannot
 * place it and it keeps its folder count. A "1_2" back face is not a mask: it
 * is paired with its "1_1" front when the edition is grouped.
 */
export function isUnnamedMask(card: Pick<DeckCard, "name">): boolean {
  const name = card.name.trim();
  return /^(?:flip|front|back|mask)\s*\d+$/i.test(name);
}

export type DecklistResult = {
  /** Quantity for each main-deck card id. */
  quantities: Map<string, number>;
  /** List lines with no card in this edition's folder. */
  missing: DecklistEntry[];
  /** List lines matched to a file whose name is spelled a little differently. */
  nearMisses: { entry: DecklistEntry; card: string }[];
  /** Main cards the list does not name, opened at 0. */
  unlisted: string[];
  /** Basic-land arts the list does not need, opened at 0. */
  idleBasics: string[];
  /** Main cards kept above the list by a product rule. */
  keptTokens: string[];
  keptMasks: string[];
  total: number;
  listTotal: number;
};

/**
 * Main-deck quantities from a list. A list sets the basic lands too: only the
 * basics it asks for are kept, and a basic it leaves out opens at 0. (With no
 * list, the folder counts apply and basics are never 0.) Rules that do not
 * bend for a list: a token in the main deck folder stays at its folder count,
 * and an unnamed partial-foil mask keeps its folder count.
 * A list quantity is spread over the cards that share that name, one copy each
 * in turn, so every art keeps its own count and a leftover art may be 0.
 */
export function quantitiesFromDecklist(edition: Pick<Edition, "cards">, list: Decklist): DecklistResult {
  const mains = edition.cards.filter((card) => card.role === "main");
  const quantities = new Map<string, number>();
  for (const card of mains) quantities.set(card.id, 0);
  const index = new Map<string, DeckCard[]>();
  for (const card of mains) {
    for (const key of cardKeys(card)) {
      const bucket = index.get(key) ?? [];
      if (!bucket.includes(card)) bucket.push(card);
      index.set(key, bucket);
    }
  }
  const missing: DecklistEntry[] = [];
  const claimed = new Set<string>();
  const entries = printList(list);
  for (const entry of entries) {
    const keys = entryKeys(entry.name);
    let matched: DeckCard[] = [];
    for (const key of keys) {
      const hit = (index.get(key) ?? []).filter((card) => !claimed.has(card.id));
      if (hit.length) {
        matched = hit;
        break;
      }
    }
    if (!matched.length) {
      missing.push(entry);
      continue;
    }
    for (const card of matched) claimed.add(card.id);
    const n = matched.length;
    matched.forEach((card, position) => {
      const share = Math.floor(entry.qty / n) + (position < entry.qty % n ? 1 : 0);
      quantities.set(card.id, share);
    });
  }
  const nearMisses: { entry: DecklistEntry; card: string }[] = [];
  for (const near of NEAR_MISSES) {
    if (!missing.length) break;
    const leftovers = mains.filter((card) => !claimed.has(card.id) && !isBasicCard(card) && !isMainToken(card) && !isUnnamedMask(card));
    const pairs = missing.map((entry) => ({
      entry,
      cards: leftovers.filter((card) => entryKeys(entry.name).some((key) => cardKeys(card).some((cardKey) => near(key, cardKey)))),
    }));
    for (const pair of pairs) {
      if (pair.cards.length !== 1) continue;
      const card = pair.cards[0]!;
      if (pairs.filter((other) => other.cards.includes(card)).length !== 1) continue;
      claimed.add(card.id);
      quantities.set(card.id, pair.entry.qty);
      nearMisses.push({ entry: pair.entry, card: card.name });
      missing.splice(missing.indexOf(pair.entry), 1);
    }
  }
  const keptTokens: string[] = [];
  const keptMasks: string[] = [];
  const idleBasics = mains.filter((card) => isBasicCard(card) && quantities.get(card.id) === 0).map((card) => card.name);
  for (const card of mains) {
    if (claimed.has(card.id) || isBasicCard(card)) continue;
    const folderQty = Math.max(0, card.defaultQty);
    if (isMainToken(card)) {
      quantities.set(card.id, folderQty);
      if (folderQty > 0) keptTokens.push(card.name);
    } else if (isUnnamedMask(card)) {
      quantities.set(card.id, folderQty);
      if (folderQty > 0) keptMasks.push(card.name);
    }
  }
  const unlisted = mains.filter((card) => !claimed.has(card.id) && !isBasicCard(card) && quantities.get(card.id) === 0).map((card) => card.name);
  let total = 0;
  for (const qty of quantities.values()) total += qty;
  return { quantities, missing, nearMisses, unlisted, idleBasics, keptTokens, keptMasks, total, listTotal: listTotal(entries) };
}

/** The edition with each main card's defaultQty taken from the list. Card ids and arts are unchanged. */
export function withDecklist(edition: Edition, list: Decklist | null): Edition {
  if (!list) return edition;
  const { quantities } = quantitiesFromDecklist(edition, list);
  return {
    ...edition,
    cards: edition.cards.map((card) => (card.role === "main" && quantities.has(card.id) ? { ...card, defaultQty: quantities.get(card.id)! } : card)),
  };
}

/** Plain-language notes for the builder about how a list was applied. */
export function decklistNotes(edition: Pick<Edition, "cards">, list: Decklist): CatalogueNote[] {
  const result = quantitiesFromDecklist(edition, list);
  const notes: CatalogueNote[] = [];
  const path = list.fileName;
  if (result.missing.length) {
    notes.push({
      level: "ambiguous",
      name: `${list.label} list`,
      path,
      reason: `${result.missing.length} line(s) in the list have no card in this folder, so they were left out: ${result.missing.map((entry) => `${entry.qty}x ${entry.name}`).join(", ")}.`,
    });
  }
  if (result.nearMisses.length) {
    notes.push({
      level: "info",
      name: "Spelling",
      path,
      reason: `${result.nearMisses.length} list line(s) matched a file spelled a little differently: ${result.nearMisses.map((item) => `${item.entry.name} → ${item.card}`).join("; ")}.`,
    });
  }
  if (result.unlisted.length) {
    notes.push({
      level: "info",
      name: "Not in this list",
      path,
      reason: `${result.unlisted.length} main-folder card(s) are not in the ${list.label} list, so they open at 0. You can still add them: ${result.unlisted.join("; ")}.`,
    });
  }
  const idleBasics = result.idleBasics.length;
  if (idleBasics) {
    notes.push({
      level: "info",
      name: "Basic lands",
      path,
      reason: `The list sets the basic lands, so ${idleBasics} basic land art(s) it doesn't need open at 0. You can still add them.`,
    });
  }
  if (result.keptTokens.length) {
    notes.push({ level: "info", name: "Tokens", path, reason: `${result.keptTokens.length} token(s) sit in the main deck folder, so they stay in the main deck: ${result.keptTokens.join(", ")}.` });
  }
  if (result.keptMasks.length) {
    notes.push({ level: "info", name: "Unnamed prints", path, reason: `${result.keptMasks.length} print(s) have no card title, so the list could not place them and they keep their folder count: ${result.keptMasks.join(", ")}.` });
  }
  if (list.sideboard.length) {
    notes.push({
      level: "info",
      name: "Sideboard",
      path,
      reason: `The list has a ${listTotal(list.sideboard)}-card sideboard that is not added to the main deck: ${list.sideboard.map((entry) => `${entry.qty}x ${entry.name}`).join(", ")}.`,
    });
  }
  return notes;
}
