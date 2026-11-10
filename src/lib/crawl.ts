import { isCompleteCollectionName, isFullDeckFolderName, isTemplateOrFontFolder, productEditionKind } from "@/lib/group";
import { decodeEntities, normalizeKey } from "@/lib/names";
import type { RawNode } from "@/lib/types";

export type ListedEntry = { id: string; name: string; folder: boolean };

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
    return { id, name: decodeEntities(rawName).trim(), folder };
  });
  return { title, entries: entries.filter((entry) => entry.id && entry.name) };
}

export type Lister = (id: string) => Promise<ListedFolder>;

/**
 * Crawl only the free Standard edition. Deluxe and Partial Foil siblings are
 * recorded by name and never requested.
 */
export async function buildShippedStandardTree(opts: {
  rootId: string;
  deckQuery: string;
  list: Lister;
}): Promise<{ deckName: string; tree: RawNode; skipped: string[] }> {
  const root = await opts.list(opts.rootId);
  const deck = findDeckFolder(root.title, opts.rootId, root.entries, opts.deckQuery);
  const listing = deck.id === opts.rootId ? root : await opts.list(deck.id);
  const skipped = listing.entries
    .filter((entry) => entry.folder && (productEditionKind(entry.name) === "deluxe" || productEditionKind(entry.name) === "partial_foil"))
    .map((entry) => entry.name);
  const standards = listing.entries.filter((entry) => entry.folder && productEditionKind(entry.name) === "standard");
  let edition = standards[0];
  let editionListing: ListedFolder | null = null;
  if (!edition) {
    const shaped = listing.entries.some((entry) => entry.folder && (isFullDeckFolderName(entry.name) || normalizeKey(entry.name) === "extras" || isCompleteCollectionName(entry.name)));
    const kind = productEditionKind(deck.name);
    if (shaped && kind !== "deluxe" && kind !== "partial_foil") {
      edition = { id: deck.id, name: deck.name, folder: true };
      editionListing = listing;
    }
  }
  if (!edition) {
    const plain = listing.entries.filter((entry) => entry.folder && !paidEditionName(entry.name) && !SKIP_FOLDER.test(entry.name) && !isTemplateOrFontFolder(entry.name));
    const holders: ListedEntry[] = [];
    let imageSet: { entry: ListedEntry; listing: ListedFolder } | null = null;
    for (const entry of plain) {
      const child = await opts.list(entry.id);
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
  const tree = await crawl(edition.id, edition.name, opts.list, seen, editionListing);
  const deckName = cleanFrom(deck.name);
  return { deckName, tree, skipped };
}

function paidEditionName(name: string): boolean {
  const kind = productEditionKind(name);
  return kind === "deluxe" || kind === "partial_foil";
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
      const kind = productEditionKind(entry.name);
      if (kind === "deluxe" || kind === "partial_foil") continue;
      if (SKIP_FOLDER.test(entry.name) || isTemplateOrFontFolder(entry.name)) continue;
      children.push(await crawl(entry.id, entry.name, list, seen));
    } else {
      children.push({ id: entry.id, name: entry.name, folder: false });
    }
  }
  return { id, name: listing.title || name, folder: true, children };
}
