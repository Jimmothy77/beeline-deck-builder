/**
 * Build the free Standard catalogue for one deck.
 *
 *   npx tsx scripts/build-catalogue.ts --deck silksong
 *   npx tsx scripts/build-catalogue.ts --root REDACTED_PAID_ID --deck silksong
 *
 * Lists a public Drive folder through the embedded folder view (no sign-in).
 * Deluxe and Partial Foil folders are skipped by name and never requested,
 * so their file and folder ids cannot land in the JSON.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildShippedStandardTree, parseEmbeddedFolder, type ListedFolder } from "../src/lib/crawl";
import { catalogueFromTree, isCompleteCollectionName, isFullDeckFolderName } from "../src/lib/group";
import type { DeckIndex, RawNode } from "../src/lib/types";

function treeHasDeckFolder(node: RawNode): boolean {
  if (isFullDeckFolderName(node.name) || isCompleteCollectionName(node.name)) return true;
  return (node.children ?? []).some((child) => child.folder && treeHasDeckFolder(child));
}

const DEFAULT_ROOT = "REDACTED_PAID_ID";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : fallback;
}

async function listEmbedded(id: string): Promise<ListedFolder> {
  const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, {
    headers: {
      "User-Agent": "BeeLineCatalogue/0.1 (public folder listing)",
      Accept: "text/html",
    },
  });
  if (!response.ok) throw new Error(`Drive folder listing failed (${response.status}) for ${id}.`);
  const html = await response.text();
  const listed = parseEmbeddedFolder(html);
  if (!listed.entries.length && /accounts\.google\.com|Sign in/i.test(html)) {
    throw new Error("Drive asked for a sign-in. The folder needs to be public (anyone with the link).");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  return listed;
}

async function main() {
  const root = arg("root", DEFAULT_ROOT);
  const deckQuery = arg("deck", "silksong");
  const out = arg("out", path.join("public", "decks", `${deckQuery.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`));
  const { deckName, tree, skipped } = await buildShippedStandardTree({
    rootId: root,
    deckQuery,
    list: listEmbedded,
  });
  const catalogue = catalogueFromTree(tree, deckName);
  const standard = catalogue.editions.filter((edition) => edition.printType === "standard" && edition.id === "standard");
  if (standard.length !== 1) throw new Error("Expected exactly one standard edition in the shipped catalogue.");
  const edition = standard[0]!;
  const mains = edition.cards.filter((card) => card.role === "main").length;
  if (mains < 50 && treeHasDeckFolder(tree)) {
    throw new Error(`Only ${mains} main cards were grouped from a Full Deck folder. The folder listing may have been cut short.`);
  }
  const payload = {
    ...catalogue,
    editions: standard.map((item) => ({
      ...item,
      notes: [
        ...item.notes,
        ...skipped.map((name) => ({
          level: "skipped" as const,
          name,
          path: deckName,
          reason: "Paid edition. Not fetched and not included in the shipped catalogue.",
        })),
      ],
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  if (/"printType": "partial_foil"/.test(json)) throw new Error("Refusing to write a catalogue that contains partial foil.");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${json}\n`);

  const indexPath = path.join("public", "decks", "index.json");
  let index: DeckIndex & { publicFolderIds?: string[] } = { decks: [] };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as DeckIndex & { publicFolderIds?: string[] };
  } catch {
    index = { decks: [] };
  }
  const file = path.posix.join("decks", path.basename(out));
  const next = index.decks.filter((entry) => entry.id !== payload.id);
  next.push({ id: payload.id, name: payload.name, file });
  next.sort((a, b) => a.name.localeCompare(b.name));
  const preserved = index.publicFolderIds ? { publicFolderIds: index.publicFolderIds } : {};
  await writeFile(indexPath, `${JSON.stringify({ ...preserved, decks: next }, null, 2)}\n`);

  const main = edition.cards.filter((card) => card.role === "main");
  const tokens = edition.cards.filter((card) => card.role === "token");
  const extras = edition.cards.filter((card) => card.role === "extra");
  const ambiguous = edition.notes.filter((note) => note.level === "ambiguous");
  console.log(`Wrote ${out}`);
  console.log(`${payload.name}: ${main.length} main, ${tokens.length} tokens, ${extras.length} extras, ${edition.backs.length} backs`);
  console.log(`Skipped paid siblings: ${skipped.join(", ") || "(none)"}`);
  console.log(`Ambiguous notes: ${ambiguous.length}`);
  for (const note of ambiguous) console.log(`  - ${note.name}: ${note.reason}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
