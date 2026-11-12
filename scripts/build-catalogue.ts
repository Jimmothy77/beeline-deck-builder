/**
 * Build the free Standard catalogue for one deck.
 *
 *   npx tsx scripts/build-catalogue.ts --deck silksong
 *   npx tsx scripts/build-catalogue.ts --deck silksong --out public/decks/silksong.json
 *   npx tsx scripts/build-catalogue.ts --all    every deck in public/decks/index.json
 *
 * Lists the public BeeLine folder through the embedded folder view (no sign-in), following shortcuts to
 * each deck's Standard folder. Before building, it walks the whole public root as an allow-list
 * (scripts/public-folder-paths.ts) and fails on any folder named like a paid edition, any folder name path not on
 * the list, and any folder it couldn't read, naming the folder path, never an id. Paid folders are never
 * requested, so their ids cannot land in the JSON.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPublicTreeFree, buildShippedStandardTree, guardPublicTree, type Lister, type PublicTreeReport } from "../src/lib/crawl";
import { catalogueFromTree, isCompleteCollectionName, isFullDeckFolderName } from "../src/lib/group";
import type { DeckIndex, RawNode } from "../src/lib/types";
import { PUBLIC_FOLDER_PATHS } from "./public-folder-paths";
import { PUBLIC_ROOT, listEmbedded } from "./public-root";

function treeHasDeckFolder(node: RawNode): boolean {
  if (isFullDeckFolderName(node.name) || isCompleteCollectionName(node.name)) return true;
  return (node.children ?? []).some((child) => child.folder && treeHasDeckFolder(child));
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

async function buildDeck(root: string, deckQuery: string, out: string, expectId?: string) {
  const { deckName, tree } = await buildShippedStandardTree({
    rootId: root,
    deckQuery,
    list: (id) => listEmbedded(id),
  });
  const catalogue = catalogueFromTree(tree, deckName);
  if (expectId && catalogue.id !== expectId) throw new Error(`“${deckQuery}” built as deck id ${catalogue.id}, not ${expectId}.`);
  const standard = catalogue.editions.filter((edition) => edition.printType === "standard" && edition.id === "standard");
  if (standard.length !== 1) throw new Error("Expected exactly one standard edition in the shipped catalogue.");
  const edition = standard[0]!;
  const mains = edition.cards.filter((card) => card.role === "main").length;
  if (mains < 50 && treeHasDeckFolder(tree)) {
    throw new Error(`Only ${mains} main cards were grouped from a Full Deck folder. The folder listing may have been cut short.`);
  }
  const payload = { ...catalogue, editions: standard };
  const json = JSON.stringify(payload, null, 2);
  if (/"printType": "partial_foil"/.test(json)) throw new Error("Refusing to write a catalogue that contains partial foil.");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${json}\n`);

  const indexPath = path.join("public", "decks", "index.json");
  let index: DeckIndex = { decks: [] };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as DeckIndex;
  } catch {
    index = { decks: [] };
  }
  const file = path.posix.join("decks", path.basename(out));
  const next = index.decks.filter((entry) => entry.id !== payload.id);
  next.push({ id: payload.id, name: payload.name, file });
  next.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(indexPath, `${JSON.stringify({ decks: next }, null, 2)}\n`);

  const main = edition.cards.filter((card) => card.role === "main");
  const tokens = edition.cards.filter((card) => card.role === "token");
  const extras = edition.cards.filter((card) => card.role === "extra");
  const ambiguous = edition.notes.filter((note) => note.level === "ambiguous");
  console.log(`Wrote ${out}`);
  console.log(`${payload.name}: ${main.length} main, ${tokens.length} tokens, ${extras.length} extras, ${edition.backs.length} backs`);
  console.log(`Ambiguous notes: ${ambiguous.length}`);
  for (const note of ambiguous) console.log(`  - ${note.name}: ${note.reason}`);
}

/**
 * One walk of the whole public root before anything is built. A paid-looking folder, a folder name path
 * that isn't on the allow-list, or a folder that couldn't be read (report.unreadable, as check-public-root
 * treats it) stops the build.
 */
export async function checkPublicTree(root: string, list: Lister, allowed: ReadonlySet<string> = PUBLIC_FOLDER_PATHS): Promise<PublicTreeReport> {
  const report = await guardPublicTree(root, list, allowed);
  assertPublicTreeFree(report);
  return report;
}

async function main() {
  const root = arg("root", PUBLIC_ROOT);
  await checkPublicTree(root, (id) => listEmbedded(id));
  if (process.argv.includes("--all")) {
    // Every deck already in the index, under its own name and file.
    const index = JSON.parse(await readFile(path.join("public", "decks", "index.json"), "utf8")) as DeckIndex;
    for (const deck of index.decks) await buildDeck(root, deck.name, path.join("public", deck.file), deck.id);
    return;
  }
  const deckQuery = arg("deck", "silksong");
  const out = arg("out", path.join("public", "decks", `${deckQuery.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`));
  await buildDeck(root, deckQuery, out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
