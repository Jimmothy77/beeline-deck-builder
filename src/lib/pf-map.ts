import { isFoilMaskFolderName } from "@/lib/foil-maps";
import { plainEditionName, productEditionKind } from "@/lib/group";
import { cleanDeckName } from "@/lib/names";
import type { UnlockedPack } from "@/lib/storage";

/**
 * The Partial Foil Map folders inside a Partial Foil edition: "Partial Foil Map" (the PNG foil masks) and
 * "PDF Partial Foil Map" (the printable PDFs, in "Full Deck + Tokens Folder"). Inside an edition both are
 * read as before. Only a pasted link that is itself one of them, or a folder inside one (its Extras or
 * Tokens), gets a warning pointing at the edition folder instead, and nothing is saved. Decided from
 * folder names: the names the paste went through, and for a bare pasted Extras or Tokens folder, the
 * name of its one parent folder (see readDriveTree).
 */

/**
 * A print map folder: "PDF Partial Foil Map" and the like. The Drive crawl uses it to tell the print map
 * from the mask folder inside an edition.
 */
export function nameIsPdfPartialMap(name: string): boolean {
  const plain = plainEditionName(name);
  return plain.includes("pdf") && plain.includes("partialfoil") && plain.includes("map");
}

/**
 * A Partial Foil Map folder, mask or print: the same fuzzy names the crawl reads (isFoilMaskFolderName,
 * nameIsPdfPartialMap), so "Partial_Foil_Map", "Partial Foil Maps", "P5 Partial Foil Map", "PDF - Partial
 * Foil Map" and names with zero-width characters count, whatever the case and spacing. An edition folder
 * never counts, even one whose deck has "Map" in its name ("Treasure Map Partial Foil Edition").
 */
export function isPartialFoilMapName(name: string): boolean {
  const normal = name.normalize("NFKC");
  if (plainEditionName(normal).includes("edition")) return false;
  return isFoilMaskFolderName(normal) || nameIsPdfPartialMap(normal);
}

/** The deck a map folder's own name carries ("P5 Partial Foil Map" -> "P5"), else null. */
export function deckFromMapName(name: string): string | null {
  const deck = cleanDeckName(name.normalize("NFKC")).replace(/[\u200b-\u200d\u2060\ufeff]/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(deck) || plainEditionName(deck).includes("partialfoil")) return null;
  return deck;
}

/** The deck of a Partial Foil edition folder ("3_P5 Partial Foil Edition" -> "P5"), else null. */
export function deckFromEditionFolder(name: string | null | undefined): string | null {
  if (!name || productEditionKind(name) !== "partial_foil") return null;
  return cleanDeckName(name) || null;
}

export const MAP_LINK_GENERIC = "That's the Partial Foil Map folder. Paste the link for the deck's folder labeled Partial Foil Edition instead.";

export function mapLinkWarning(deck?: string | null): string {
  return deck ? `That's the Partial Foil Map folder. Paste the link for the folder labeled ${deck} Partial Foil Edition instead.` : MAP_LINK_GENERIC;
}

/** Thrown by the Drive read when the pasted link is a Partial Foil Map folder or a folder inside one. */
export class PartialFoilMapLinkError extends Error {
  readonly deck: string | null;
  constructor(deck: string | null) {
    super(mapLinkWarning(deck));
    this.name = "PartialFoilMapLinkError";
    this.deck = deck;
  }
}

/**
 * The folder names a paste went through before its folder was opened, outermost first: a shortcut's own
 * name, then its target; a folder holding a New Drive Link, then the folder it points at. When any of
 * them is a map folder the paste is that map folder (or one inside it). The deck comes from the nearest
 * Partial Foil edition name before the map, when the chain has one, else from the map's own name.
 */
export function mapFolderInChain(names: readonly string[]): { deck: string | null } | null {
  const at = names.findIndex(isPartialFoilMapName);
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const deck = deckFromEditionFolder(names[i]);
    if (deck) return { deck };
  }
  return { deck: deckFromMapName(names[at]!) };
}

/**
 * Whether a saved or restored unlock was made from a pasted map folder. Judged from what it stores about
 * its own root, never from the folders inside it:
 * - its deck name is a map name: an unlock is named after the pasted folder, so a map paste is stored as
 *   "Partial Foil Map", "Partial_Foil_Map", "PDF Partial Foil Map" and the like;
 * - or a note made at its root names a map folder (the root's notes carry the
 *   pasted folder's own name: "P5 Partial Foil Map" is stored as deck "P5", with that note);
 * - or its Partial Foil deck name has no letter or digit left, which only a map folder's name leaves
 *   ("PDF - Partial Foil Map" is stored as deck "-").
 * A real edition is stored under its deck ("P5"), its notes inside the edition start with a folder path
 * ("PDF Partial Foil Map/Full Deck/Front", never a bare map name), so it is never dropped.
 */
export function isMapUnlock(pack: UnlockedPack): boolean {
  const { name, editions } = pack.catalogue;
  if (isPartialFoilMapName(name)) return true;
  if (editions.some((edition) => edition.notes.some((note) => !note.path.includes("/") && isPartialFoilMapName(note.path)))) return true;
  const visible = name.normalize("NFKC").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
  return !/[\p{L}\p{N}]/u.test(visible) && editions.some((edition) => edition.printType === "partial_foil");
}

/** The saved or restored unlocks to keep, without the ones made from a map folder, and how many were dropped. */
export function purgeMapUnlocks(packs: readonly UnlockedPack[]): { packs: UnlockedPack[]; dropped: number } {
  const kept = packs.filter((pack) => !isMapUnlock(pack));
  return { packs: kept, dropped: packs.length - kept.length };
}
