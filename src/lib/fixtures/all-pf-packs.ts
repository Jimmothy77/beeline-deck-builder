import { readFileSync } from "node:fs";
import path from "node:path";
import { packHash, type UnlockedPack } from "@/lib/storage";
import type { ArtFile, CardBack, DeckCard, DeckCatalogue, Edition } from "@/lib/types";

/**
 * Every shipped deck as if unlocked from its Partial Foil folder, at realistic size: a Partial Foil
 * edition (each print with a mask) and the Deluxe edition it brings, both with the shipped card set,
 * deck lists and backs. Drive ids are made up at run time by a seeded generator in Drive's own shape
 * (33 characters, about as incompressible as real ids), so no real id is in this file. Partial Foil
 * thumbnails point at the Deluxe print's id, as the unlock does.
 */
const root = path.resolve(import.meta.dirname, "../../..");
const index = JSON.parse(readFileSync(path.join(root, "public/decks/index.json"), "utf8")) as { decks: { id: string; file: string }[] };
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function idMaker(seed: number): () => string {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => "1" + Array.from({ length: 32 }, () => ALPHABET[Math.floor(next() * 64)]).join("");
}

export const SHIPPED_DECK_IDS = index.decks.map((deck) => deck.id);

/**
 * `withSourceFiles` adds the Deluxe edition's Standard-print list, which a pack has in memory right after
 * an unlock (a restore always drops it); it draws on its own id stream, so every other id is the same
 * with or without it. `seed` makes a different set of ids and folders (another buyer's unlocks).
 */
export function allPartialFoilPacks(options?: { withSourceFiles?: boolean; seed?: number }): UnlockedPack[] {
  const seed = options?.seed ?? 37;
  const newId = idMaker(seed);
  const sourceId = idMaker(seed + 100_000);
  return SHIPPED_DECK_IDS.map((deckId, n) => {
    const shipped = JSON.parse(readFileSync(path.join(root, "public/decks", `${deckId}.json`), "utf8")) as DeckCatalogue;
    const standard = shipped.editions[0]!;
    const deluxeIds = new Map<string, string>();
    const remap = (cards: DeckCard[], art: (file: ArtFile) => ArtFile) =>
      cards.map((card) => ({ ...card, faces: card.faces.map((face) => ({ ...face, defaultArt: face.defaultArt ? art(face.defaultArt) : null, alternates: face.alternates.map(art) })) }));
    const backs = (list: CardBack[]) => list.map((back) => ({ ...back, id: newId(), thumbId: "" })).map((back) => ({ ...back, thumbId: back.id }));
    const sourceFiles: { id: string; name: string }[] = [];
    const deluxeCards = remap(standard.cards, (file) => {
      const id = newId();
      deluxeIds.set(file.id, id);
      if (options?.withSourceFiles) sourceFiles.push({ id: sourceId(), name: file.name });
      return { id, name: file.name, thumbId: id, label: file.label, ...(file.tone ? { tone: file.tone } : {}) };
    });
    let total = 0;
    const foilCards = remap(standard.cards, (file) => {
      total += 1;
      return { id: newId(), name: file.name, thumbId: deluxeIds.get(file.id)!, label: file.label, ...(file.tone ? { tone: file.tone } : {}), maskId: newId() };
    });
    const common = { notes: standard.notes, ...(standard.decklists ? { decklists: standard.decklists } : {}) };
    const foil: Edition = { id: "partial-foil", name: "Partial Foil", printType: "partial_foil", cards: foilCards, backs: backs(standard.backs), ...common, foilMaps: { found: total, total } };
    const deluxe: Edition = { id: "deluxe", name: "Deluxe", printType: "standard", cards: deluxeCards, backs: backs(standard.backs), ...common, ...(sourceFiles.length ? { sourceFiles } : {}) };
    const at = new Date(Date.UTC(2026, 10, 1 + n)).toISOString();
    return { packHash: packHash(["fake", "pf", "folder", String(seed), String(n)].join("-")), savedAt: at, refreshedAt: at, catalogue: { id: shipped.id, name: shipped.name, creator: "Beespair", editions: [foil, deluxe] } };
  });
}
