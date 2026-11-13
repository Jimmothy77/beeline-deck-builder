import { productEditionKind } from "@/lib/group";
import { cleanDeckName } from "@/lib/names";
import type { UnlockedPack } from "@/lib/storage";

/**
 * The Partial Foil Map folders inside a Partial Foil edition: "Partial Foil Map" (the foil masks) and
 * "PDF Partial Foil Map" (the print map). Neither is an edition. A buyer who pastes one of them, or a
 * folder inside one (its Extras or Tokens), gets a warning pointing at the edition folder instead, and
 * nothing is saved. Decided from folder names only: BeeLine never asks Drive for a folder's parents.
 */
const MAP_NAMES = new Set(["partialfoilmap", "pdfpartialfoilmap"]);

/** "Partial Foil Map" or "PDF Partial Foil Map", whatever the case and spacing. Nothing else. */
export function isPartialFoilMapName(name: string): boolean {
  return MAP_NAMES.has(name.normalize("NFKC").toLowerCase().replace(/\s+/g, ""));
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
 * Partial Foil edition name before the map, when the chain has one.
 */
export function mapFolderInChain(names: readonly string[]): { deck: string | null } | null {
  const at = names.findIndex(isPartialFoilMapName);
  if (at < 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const deck = deckFromEditionFolder(names[i]);
    if (deck) return { deck };
  }
  return { deck: null };
}

/**
 * Saved or restored unlocks that are a map folder, by their stored name: an unlock names its deck after
 * the pasted folder, and a map folder's name has no deck in it, so the deck is stored as "Partial Foil
 * Map" or "PDF Partial Foil Map". (Stored note paths are not used: they start inside the edition, so a
 * real Partial Foil edition's notes begin "PDF Partial Foil Map/...".) Returns the unlocks to keep and
 * how many were dropped.
 */
export function purgeMapUnlocks(packs: readonly UnlockedPack[]): { packs: UnlockedPack[]; dropped: number } {
  const kept = packs.filter((pack) => !isPartialFoilMapName(pack.catalogue.name));
  return { packs: kept, dropped: packs.length - kept.length };
}
