import { isCompleteCollectionName, isFullDeckFolderName, isTemplateOrFontFolder, looksLikePaidName, productEditionKind } from "@/lib/group";
import { canonicalDeckName } from "@/data/deck-aliases";
import { decodeEntities, normalizeKey } from "@/lib/names";
import type { RawNode } from "@/lib/types";

/**
 * One entry of a public folder listing. A Drive shortcut keeps its own id in `id`; `targetId` is the
 * folder or file it points at, which is what gets listed.
 */
export type ListedEntry = { id: string; name: string; folder: boolean; shortcut?: true; targetId?: string };

/** The id to list for an entry: a shortcut's target, else the entry itself. */
export function listId(entry: ListedEntry): string {
  return entry.targetId ?? entry.id;
}

export type ListedFolder = { title: string; entries: ListedEntry[] };

const SKIP_FOLDER = /^(templates|fonts)$/i;

/** Parse Google's public embedded folder view. No sign-in. */
export function parseEmbeddedFolder(html: string): ListedFolder {
  const title = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const parts = html.split('<div class="flip-entry" id="entry-').slice(1);
  const entries: ListedEntry[] = parts.map((part) => {
    const id = part.slice(0, part.indexOf('"'));
    const rawName = part.match(/class="flip-entry-title">([^<]*)<\/div>/)?.[1] ?? "";
    const head = part.slice(0, 2500);
    const folder = head.includes("/folders/") || head.includes('aria-label="Folder"');
    const entry: ListedEntry = { id, name: decodeEntities(rawName).trim(), folder };
    // A shortcut is drawn with Drive's shortcut icon, and its link opens the target.
    if (head.includes("drive-shortcut-icon")) {
      const target = head.match(/href="https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|file\/d\/)([A-Za-z0-9_-]+)/)?.[1];
      entry.shortcut = true;
      if (target && target !== id) entry.targetId = target;
    }
    return entry;
  });
  return { title, entries: entries.filter((entry) => entry.id && entry.name) };
}

export type Lister = (id: string) => Promise<ListedFolder>;

/**
 * Crawl only the free Standard edition, through shortcuts. The public root holds one entry per deck: a
 * folder holding a shortcut to the deck's Standard folder, or that shortcut itself. A Deluxe or Partial
 * Foil folder anywhere on the way is an error (see guardPublicTree); it is never requested.
 */
export async function buildShippedStandardTree(opts: {
  rootId: string;
  deckQuery: string;
  list: Lister;
}): Promise<{ deckName: string; tree: RawNode }> {
  const root = await opts.list(opts.rootId);
  const deck = findDeckFolder(root.title, opts.rootId, root.entries, opts.deckQuery);
  const listing = deck.id === opts.rootId ? root : await opts.list(listId(deck));
  const paid = listing.entries.filter((entry) => entry.folder && paidEditionName(entry.name)).map((entry) => `${root.title || "public root"} / ${deck.name} / ${entry.name}`);
  if (paid.length) throw new PaidFolderError(paid);
  const standards = listing.entries.filter((entry) => entry.folder && productEditionKind(entry.name) === "standard");
  let edition = standards[0];
  let editionListing: ListedFolder | null = null;
  if (!edition) {
    const shaped = listing.entries.some((entry) => entry.folder && (isFullDeckFolderName(entry.name) || normalizeKey(entry.name) === "extras" || isCompleteCollectionName(entry.name)));
    if (shaped && !paidEditionName(deck.name)) {
      edition = { id: deck.id, name: deck.name, folder: true };
      editionListing = listing;
    }
  }
  if (!edition) {
    const plain = listing.entries.filter((entry) => entry.folder && !paidEditionName(entry.name) && !SKIP_FOLDER.test(entry.name) && !isTemplateOrFontFolder(entry.name));
    const holders: ListedEntry[] = [];
    let imageSet: { entry: ListedEntry; listing: ListedFolder } | null = null;
    for (const entry of plain) {
      const child = await opts.list(listId(entry));
      const holdsDeck = child.entries.some((item) => item.folder && (isFullDeckFolderName(item.name) || isCompleteCollectionName(item.name)));
      if (holdsDeck) holders.push(entry);
      else if (!imageSet && listingIsCardImages(child)) imageSet = { entry, listing: child };
    }
    if (holders.length === 1) edition = holders[0];
    else if (holders.length > 1) {
      throw new Error(`More than one folder holds a Full Deck in “${deck.name}”: ${holders.map((entry) => entry.name).join(", ")}.`);
    } else if (plain.length === 1 && imageSet) {
      edition = imageSet.entry;
      editionListing = imageSet.listing;
    }
  }
  if (!edition) {
    throw new Error(
      `No Standard edition folder inside “${deck.name}”. Deluxe and Partial Foil are not part of the shipped catalogue.`,
    );
  }
  if (standards.length > 1) {
    throw new Error(`More than one Standard folder in “${deck.name}”: ${standards.map((entry) => entry.name).join(", ")}.`);
  }
  const seen = new Set<string>();
  const tree = await crawl(listId(edition), edition.name, opts.list, seen, editionListing);
  // The deck's own folder name ("3_Silksong", or a shortcut's "1_Spy x Family Standard Edition"), cleaned,
  // then mapped to the shipped deck's name ("SxF") so deck ids stay the same.
  const deckName = canonicalDeckName(cleanFrom(deck.name));
  return { deckName, tree };
}

/** Deluxe, Partial Foil, or anything spelled like them (DLX, PF, Premium, foil, a non-ASCII letter). */
function paidEditionName(name: string): boolean {
  return looksLikePaidName(name);
}

function listingIsCardImages(listing: ListedFolder): boolean {
  if (listing.entries.some((entry) => entry.folder)) return false;
  const files = listing.entries.filter((entry) => !entry.folder);
  const images = files.filter((entry) => /\.(png|jpe?g|webp|gif)$/i.test(entry.name));
  const others = files.filter((entry) => !/\.(png|jpe?g|webp|gif)$/i.test(entry.name) && !/^readme(\b|\.)/i.test(entry.name));
  return images.length > 0 && others.length === 0;
}

function cleanFrom(name: string): string {
  return name.replace(/^\s*\d+(?:\.\d+)?\s*[_\s.-]+\s*/, "").replace(/\b(standard|deluxe|partial\s*foil)\s*edition\b/gi, "").replace(/\s+/g, " ").trim() || name;
}

export function findDeckFolder(rootTitle: string, rootId: string, entries: ListedEntry[], query: string): ListedEntry {
  const q = query.trim().toLowerCase();
  const hits = entries.filter((entry) => entry.folder && entry.name.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    throw new Error(`More than one folder matches “${query}”: ${hits.map((hit) => hit.name).join(", ")}.`);
  }
  if (rootTitle.toLowerCase().includes(q)) return { id: rootId, name: rootTitle, folder: true };
  throw new Error(`No folder matching “${query}” in “${rootTitle || "that folder"}”.`);
}

async function crawl(id: string, name: string, list: Lister, seen: Set<string>, already?: ListedFolder | null): Promise<RawNode> {
  if (seen.has(id)) throw new Error(`Folder “${name}” links back to itself.`);
  seen.add(id);
  const listing = already ?? (await list(id));
  const children: RawNode[] = [];
  for (const entry of listing.entries) {
    if (entry.folder) {
      if (paidEditionName(entry.name)) continue;
      if (SKIP_FOLDER.test(entry.name) || isTemplateOrFontFolder(entry.name)) continue;
      children.push(await crawl(listId(entry), entry.name, list, seen));
    } else {
      children.push({ id: entry.id, name: entry.name, folder: false });
    }
  }
  return { id, name: listing.title || name, folder: true, children };
}

/** A Deluxe or Partial Foil folder showed up under the public root. The message names paths, never ids. */
export class PaidFolderError extends Error {
  paths: string[];
  constructor(paths: string[]) {
    super(`Paid edition folder${paths.length === 1 ? "" : "s"} under the public root (move ${paths.length === 1 ? "it" : "them"} out before building):\n${paths.map((item) => `  ${item}`).join("\n")}`);
    this.name = "PaidFolderError";
    this.paths = paths;
  }
}

export type PublicTreeReport = {
  /** The root folder's title. */
  title: string;
  /** Folders listed, shortcuts followed. */
  folders: number;
  shortcuts: number;
  /** Name paths of folders named like a paid edition (never listed). */
  paid: string[];
  /** Name paths of folders whose name isn't on the public allow-list (never listed). */
  unknown: string[];
  /** Name paths of folders that couldn't be listed (Restricted, gone, or a failed request). */
  unreadable: string[];
  /** Each top-level entry and the Standard folder it leads to (by name), or null when none was found. */
  decks: { entry: string; via: string[]; standard: string | null }[];
};

/**
 * Walk the public root, following shortcuts, as an allow-list. Below the root a folder (or folder
 * shortcut) is listed only when its exact name is one of `allowed` and nothing about the name looks paid
 * (looksLikePaidName); anything else is recorded by name path and never listed. A shortcut's own title is
 * checked before its target is listed; the target's title, which only comes with its listing, must pass
 * the same check before anything inside it is walked. Only names are reported, so nothing here prints an id.
 */
export async function guardPublicTree(rootId: string, list: Lister, allowed: ReadonlySet<string>): Promise<PublicTreeReport> {
  const report: PublicTreeReport = { title: "", folders: 0, shortcuts: 0, paid: [], unknown: [], unreadable: [], decks: [] };
  const seen = new Set<string>();
  let root: ListedFolder;
  try {
    root = await list(rootId);
  } catch {
    report.unreadable.push("public root");
    return report;
  }
  report.folders += 1;
  report.title = root.title || "public root";
  if (paidEditionName(report.title)) {
    report.paid.push(report.title);
    return report;
  }
  seen.add(rootId);
  /** Where a name goes when it can't be walked, or null when it may be. */
  const refusal = (name: string): "paid" | "unknown" | null => (paidEditionName(name) ? "paid" : allowed.has(name) ? null : "unknown");
  async function walk(entry: ListedEntry, trail: string[], deck: PublicTreeReport["decks"][number] | null): Promise<void> {
    const here = [...trail, entry.name];
    const refused = refusal(entry.name);
    if (refused) {
      report[refused].push(here.join(" / "));
      return;
    }
    const id = listId(entry);
    if (entry.shortcut) report.shortcuts += 1;
    if (seen.has(id)) return;
    seen.add(id);
    let listing: ListedFolder;
    try {
      listing = await list(id);
    } catch {
      report.unreadable.push(here.join(" / "));
      return;
    }
    report.folders += 1;
    const title = listing.title || entry.name;
    const refusedTitle = title === entry.name ? null : refusal(title);
    if (refusedTitle) {
      report[refusedTitle].push(`${here.join(" / ")} (shortcut to “${title}”)`);
      return;
    }
    if (deck) {
      if (entry.shortcut) deck.via.push(entry.name);
      if (!deck.standard && looksLikeStandard(title, listing)) deck.standard = title;
    }
    for (const child of listing.entries) {
      if (child.folder) await walk(child, here, deck);
    }
  }
  for (const entry of root.entries) {
    if (!entry.folder) continue;
    const deck = refusal(entry.name) ? null : { entry: entry.name, via: [] as string[], standard: null as string | null };
    if (deck) report.decks.push(deck);
    await walk(entry, [report.title], deck);
  }
  return report;
}

/** A Standard edition folder, or a deck folder that holds the cards itself (TMNT, Horror). */
function looksLikeStandard(title: string, listing: ListedFolder): boolean {
  if (productEditionKind(title) === "standard") return true;
  const folders = listing.entries.filter((entry) => entry.folder);
  if (folders.some((entry) => isFullDeckFolderName(entry.name) || isCompleteCollectionName(entry.name))) return true;
  return listingIsCardImages(listing);
}

/** A walk of the public root that can't be trusted: unknown folder names or folders it couldn't read. */
export class PublicTreeError extends Error {
  constructor(lines: string[]) {
    super(`The public root can't be checked (fix it before building):\n${lines.map((item) => `  ${item}`).join("\n")}`);
    this.name = "PublicTreeError";
  }
}

/**
 * Fails loudly when the walk found a paid folder, a folder name that isn't on the allow-list, or a folder
 * it couldn't read (an unread folder may hide anything). The message names paths only.
 */
export function assertPublicTreeFree(report: PublicTreeReport): void {
  if (report.paid.length) throw new PaidFolderError(report.paid);
  const lines = [...report.unknown.map((item) => `not on the public folder allow-list: ${item}`), ...report.unreadable.map((item) => `can't list: ${item}`)];
  if (lines.length) throw new PublicTreeError(lines);
}
