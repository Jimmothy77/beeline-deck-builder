/**
 * Attach the Tapped Out deck lists in decklists/ to the shipped Standard
 * catalogues, and tag SxF's Color and Black and White files.
 *
 *   npx tsx scripts/attach-decklists.ts          write public/decks/*.json
 *   npx tsx scripts/attach-decklists.ts --check  fail if a file would change
 *
 * The lists are the same files that sit in each Standard edition folder. They
 * hold card names only, never Drive ids. Horror Movie Poster Secret Lair is a
 * card collection with no list. There is no Dandan list.
 *
 * It also pairs double-faced files the older catalogue left apart: "N_1" is
 * the front and "N_2" the back (TMNT's Dowsing Dagger and "1_2 Lost Vale"),
 * using the same rule unlock-time grouping uses.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDecklist, orderDecklists } from "../src/lib/decklist";
import { pairLooseFaces } from "../src/lib/faces";
import { own } from "../src/lib/own";
import type { ArtFile, DeckCatalogue, Edition } from "../src/lib/types";

export const SHIPPED_DECKLISTS: Record<string, string[]> = {
  "dr-eggman": ["decklist - Eggman.txt"],
  "floating-world": [
    "decklist - Floating World 25.txt",
    "decklist - Floating World Complete Collection.txt",
    "decklist - Floating World Fish of '97.txt",
    "decklist - Floating World Fish of Heat.txt",
    "decklist - Floating World Fish of Legends.txt",
    "decklist - Floating World Fish of Lies.txt",
  ],
  "horror-movie-poster-secret-lair": [],
  kpdh: ["decklist - KPDH - HUNTRX.txt"],
  nier: ["decklist - NieR.txt"],
  "persona-5": ["decklist - Persona 5.txt"],
  silksong: ["decklist - Silksong.txt"],
  sxf: ["decklist - SxF - Operation Strix.txt"],
  tmnt: ["decklist - TMNT.txt"],
  vader: ["decklist - Vader.txt"],
  "x-men": ["decklist - X-Men.txt"],
};

const root = path.resolve(import.meta.dirname, "..");

/**
 * The shipped SxF catalogue was grouped before files carried a tone. Its
 * grouping put each Color file first and the same card's Black and White file
 * as the one alternate, for the 53 option cards, the basic lands, and the
 * tokens. A card with a single file keeps no tone, because it is the same in
 * both sets.
 */
export function tagShippedSxfTones(edition: Edition): Edition {
  const tag = (art: ArtFile | null, tone: "color" | "bw"): ArtFile | null => (art ? { ...art, tone } : art);
  return {
    ...edition,
    cards: edition.cards.map((card) => {
      if (card.role === "extra") return card;
      return {
        ...card,
        faces: card.faces.map((face) =>
          face.defaultArt && face.alternates.length === 1
            ? { ...face, defaultArt: tag(face.defaultArt, "color"), alternates: [tag(face.alternates[0]!, "bw")!] }
            : face,
        ),
      };
    }),
  };
}

export function withShippedLists(deck: DeckCatalogue, readList: (file: string) => string): DeckCatalogue {
  const files = own(SHIPPED_DECKLISTS, deck.id);
  if (!files) throw new Error(`No deck-list entry for ${deck.id}. Add it to SHIPPED_DECKLISTS, even as an empty list.`);
  return {
    ...deck,
    editions: deck.editions.map((edition) => {
      if (edition.id !== "standard") return edition;
      const { decklists: _old, ...rest } = edition;
      void _old;
      const lists = orderDecklists(files.map((file) => parseDecklist(readList(file), file)));
      const paired = pairLooseFaces(rest.cards);
      const faced = paired.notes.length ? { ...rest, cards: paired.cards, notes: [...rest.notes, ...paired.notes] } : rest;
      const tagged = deck.id === "sxf" ? tagShippedSxfTones(faced) : faced;
      return lists.length ? { ...tagged, decklists: lists } : tagged;
    }),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const index = JSON.parse(readFileSync(path.join(root, "public/decks/index.json"), "utf8")) as { decks: { id: string; file: string }[] };
  let changed = 0;
  for (const entry of index.decks) {
    const file = path.join(root, "public", entry.file);
    const before = readFileSync(file, "utf8");
    const deck = JSON.parse(before) as DeckCatalogue;
    const next = `${JSON.stringify(withShippedLists(deck, (name) => readFileSync(path.join(root, "decklists", name), "utf8")), null, 2)}\n`;
    if (next === before) continue;
    changed += 1;
    if (check) console.error(`${entry.file} is out of date.`);
    else writeFileSync(file, next);
  }
  if (check && changed) process.exit(1);
  console.log(check ? "Shipped deck lists are up to date." : `Updated ${changed} catalogue(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
