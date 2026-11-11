/**
 * Check the live public root:
 *
 *   npx tsx scripts/check-public-root.ts --check
 *
 * Walks the public BeeLine folder through its shortcuts (see guardPublicTree) and fails when any Deluxe
 * or Partial Foil folder is reachable, when a folder can't be listed, or when a shipped deck has no entry
 * leading to a Standard folder. It prints folder names only, never an id. It reads public folders only:
 * a paid-named folder is never listed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalDeckName } from "../src/data/deck-aliases";
import { guardPublicTree, type PublicTreeReport } from "../src/lib/crawl";
import { cleanDeckName, normalizeKey } from "../src/lib/names";
import type { DeckIndex } from "../src/lib/types";
import { PUBLIC_ROOT, listEmbedded } from "./public-root";

/** Which shipped deck a root entry is: by its own name, its shortcut's name, or its Standard folder's name. */
export function deckForEntry(deck: PublicTreeReport["decks"][number], shipped: DeckIndex["decks"]): DeckIndex["decks"][number] | null {
  for (const name of [deck.entry, ...deck.via, deck.standard ?? ""]) {
    if (!name) continue;
    const key = normalizeKey(canonicalDeckName(cleanDeckName(name)));
    const hit = shipped.find((item) => normalizeKey(item.name) === key);
    if (hit) return hit;
  }
  return null;
}

/** Problems with a walk, in plain words. Empty when the root is fine. */
export function rootProblems(report: PublicTreeReport, shipped: DeckIndex["decks"]): string[] {
  const problems: string[] = [];
  for (const item of report.paid) problems.push(`paid edition folder under the public root: ${item}`);
  for (const item of report.unreadable) problems.push(`can't list: ${item}`);
  const found = new Set<string>();
  for (const deck of report.decks) {
    const hit = deckForEntry(deck, shipped);
    if (!deck.standard) problems.push(`${deck.entry}: no Standard folder found under it`);
    if (!hit) problems.push(`${deck.entry}: not one of the shipped decks`);
    else if (found.has(hit.id)) problems.push(`${deck.entry}: a second entry for ${hit.name}`);
    else found.add(hit.id);
  }
  for (const item of shipped) if (!found.has(item.id)) problems.push(`${item.name}: no entry in the public root`);
  return problems;
}

async function main() {
  const shipped = (JSON.parse(readFileSync(path.join("public", "decks", "index.json"), "utf8")) as DeckIndex).decks;
  const report = await guardPublicTree(PUBLIC_ROOT, (id) => listEmbedded(id));
  console.log(`Public root “${report.title}”: ${report.decks.length} entries, ${report.folders} folders listed, ${report.shortcuts} shortcuts followed.`);
  for (const deck of report.decks) {
    const hit = deckForEntry(deck, shipped);
    console.log(`  ${deck.entry}${deck.via.length ? ` → shortcut “${deck.via.join("” → “")}”` : ""} → ${deck.standard ? `“${deck.standard}”` : "(no Standard folder)"} = ${hit ? hit.id : "(no shipped deck)"}`);
  }
  const problems = rootProblems(report, shipped);
  if (problems.length) {
    console.error(`The public root has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const item of problems) console.error(`  ${item}`);
    process.exit(1);
  }
  console.log(`No Deluxe or Partial Foil folder is reachable, and all ${shipped.length} shipped decks lead to a Standard folder.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
