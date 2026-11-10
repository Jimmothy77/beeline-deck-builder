/**
 * One-time token cross-reference for the shipped Standard decks.
 *
 *   npx tsx scripts/token-lookup.ts                 ask Scryfall, rewrite src/data/token-lookup.ts, print the report
 *   npx tsx scripts/token-lookup.ts --report <file> print the report from the committed lookup (no network), and write it to <file>
 *   npx tsx scripts/token-lookup.ts --check         no network: every extra and token name in public/decks has an entry,
 *                                                   and every hand override matches exactly one token or extra
 *
 * Every non-main card (Tokens folders and extras) in public/decks/*.json is
 * looked up by name with Scryfall's public /cards/collection endpoint, 75
 * names per request. A card is a token when its layout is token,
 * double_faced_token or emblem, or its type line contains "Token". Each
 * matched name is then searched once as an exact name (include:extras): the
 * exact matches decide (a token, or a game card); a name that is both, or
 * whose only match is not a game card (art card, vanguard), is marked
 * ambiguous and left to BeeLine's folder and name heuristic. Cards decided by
 * hand live in src/data/token-overrides.ts (deck id and exact card name). They
 * win over the lookup and the heuristic, this script never rewrites them, and
 * --check fails when one of them matches no card. At most about 8 requests a second,
 * with a User-Agent and an Accept header. No key, no sign-in. The app itself
 * never calls Scryfall.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_LOOKUP, TOKEN_LOOKUP_UNMATCHED } from "../src/data/token-lookup";
import { normalizeKey } from "../src/lib/names";
import { TOKEN_OVERRIDES } from "../src/data/token-overrides";
import { heuristicIsToken, tokenQueryNames, tokenVerdict, type TokenLookupEntry, type TokenOverride } from "../src/lib/tokens";
import type { DeckCatalogue, DeckCard } from "../src/lib/types";

const root = path.resolve(import.meta.dirname, "..");
const decksDir = path.join(root, "public", "decks");
const lookupFile = path.join(root, "src", "data", "token-lookup.ts");
const HEADERS = { "User-Agent": "BeeLineTokenLookup/0.1.28 (one-time token cross-reference; static lookup)", Accept: "application/json" };
const GAP_MS = 125;
const TOKEN_LAYOUTS = new Set(["token", "double_faced_token", "emblem"]);
/** Layouts of cards played in a normal game. Art cards, vanguards, planes, schemes and un-set augments don't count as "a real card". */
const GAME_LAYOUTS = new Set(["normal", "split", "flip", "transform", "modal_dfc", "meld", "leveler", "class", "case", "saga", "adventure", "mutate", "prototype", "battle"]);

type Use = { deck: string; card: string; role: DeckCard["role"]; heuristic: boolean };
type ScryCard = { name: string; layout: string; type_line?: string; card_faces?: { name: string; type_line?: string }[] };

function shippedCards(): { deck: string; deckId: string; card: DeckCard }[] {
  const out: { deck: string; deckId: string; card: DeckCard }[] = [];
  for (const file of readdirSync(decksDir).filter((name) => name.endsWith(".json") && name !== "index.json").sort()) {
    const deck = JSON.parse(readFileSync(path.join(decksDir, file), "utf8")) as DeckCatalogue;
    for (const edition of deck.editions) for (const card of edition.cards) if (card.role !== "main") out.push({ deck: deck.name, deckId: deck.id, card });
  }
  return out;
}

/** Unique look-up names (by key) and every card that uses them. */
function collectQueries() {
  const queries = new Map<string, { query: string; uses: Use[] }>();
  for (const { deck, card } of shippedCards()) {
    for (const query of tokenQueryNames(card)) {
      const key = normalizeKey(query);
      if (!key) continue;
      const item = queries.get(key) ?? { query, uses: [] };
      if (!item.uses.some((use) => use.deck === deck && use.card === card.name)) item.uses.push({ deck, card: card.name, role: card.role, heuristic: heuristicIsToken(card) });
      queries.set(key, item);
    }
  }
  return queries;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(GAP_MS);
    const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
    if (response.status !== 429) return response;
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Scryfall kept answering 429 for ${url}`);
}

function scryIsToken(card: ScryCard): boolean {
  const types = [card.type_line ?? "", ...(card.card_faces ?? []).map((face) => face.type_line ?? "")].join(" // ");
  return TOKEN_LAYOUTS.has(card.layout) || /\bToken\b/.test(types);
}

function namesOf(card: ScryCard): string[] {
  return [card.name, ...card.name.split(" // "), ...(card.card_faces ?? []).map((face) => face.name)];
}

async function fetchLookup(): Promise<{ lookup: Record<string, TokenLookupEntry>; unmatched: string[]; requests: number }> {
  const queries = [...collectQueries().entries()];
  const lookup: Record<string, TokenLookupEntry> = {};
  let requests = 0;
  for (let start = 0; start < queries.length; start += 75) {
    const batch = queries.slice(start, start + 75);
    const response = await call("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map(([, item]) => ({ name: item.query })) }),
    });
    requests++;
    if (!response.ok) throw new Error(`Scryfall /cards/collection answered ${response.status}`);
    const body = (await response.json()) as { data: ScryCard[] };
    for (const [key, item] of batch) {
      const hit = body.data.find((card) => namesOf(card).some((name) => normalizeKey(name) === key));
      if (!hit) continue;
      lookup[key] = { query: item.query, token: scryIsToken(hit), scryfall: hit.name, layout: hit.layout, typeLine: hit.type_line ?? (hit.card_faces ?? []).map((face) => face.type_line).join(" // ") };
    }
  }
  for (const [key, entry] of Object.entries(lookup)) {
    const url = `https://api.scryfall.com/cards/search?unique=oracle&q=${encodeURIComponent(`!"${entry.query.replace(/"/g, "")}" include:extras`)}`;
    const response = await call(url);
    requests++;
    if (!response.ok && response.status !== 404) throw new Error(`Scryfall /cards/search answered ${response.status}`);
    const found = response.status === 404 ? [] : ((await response.json()) as { data: ScryCard[] }).data;
    // Exact-name matches, the card named exactly this first (Treasure before Dinosaur // Treasure).
    const exact = found.filter((card) => namesOf(card).some((name) => normalizeKey(name) === key)).sort((a, b) => Number(normalizeKey(b.name) === key) - Number(normalizeKey(a.name) === key));
    const tokens = exact.filter(scryIsToken);
    const cards = exact.filter((card) => !scryIsToken(card) && GAME_LAYOUTS.has(card.layout));
    const label = (list: ScryCard[]) => [...new Set(list.map((card) => `${card.name} (${card.layout})`))].join(", ");
    const take = (card: ScryCard, token: boolean) => Object.assign(entry, { token, scryfall: card.name, layout: card.layout, typeLine: card.type_line ?? (card.card_faces ?? []).map((face) => face.type_line).join(" // ") });
    if (tokens.length && cards.length) entry.ambiguous = `token: ${label(tokens)}; card: ${label(cards)}`;
    else if (tokens.length) take(tokens[0]!, true);
    else if (cards.length) take(cards[0]!, false);
    else if (!entry.token && !GAME_LAYOUTS.has(entry.layout)) entry.ambiguous = `only a non-game Scryfall object: ${entry.scryfall} (${entry.layout})`;
  }
  const unmatched = queries.filter(([key]) => !lookup[key]).map(([, item]) => item.query).sort((a, b) => a.localeCompare(b));
  return { lookup, unmatched, requests };
}

function writeLookup(lookup: Record<string, TokenLookupEntry>, unmatched: string[]) {
  const keys = Object.keys(lookup).sort();
  const lines = [
    "// Generated by scripts/token-lookup.ts from Scryfall's public API (one-time cross-reference). Do not edit by hand.",
    "// Keys are normalizeKey(tokenQueryName(name)). The app never calls Scryfall.",
    'import type { TokenLookupEntry } from "@/lib/tokens";',
    "",
    "export const TOKEN_LOOKUP: Readonly<Record<string, TokenLookupEntry>> = {",
    ...keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(lookup[key])},`),
    "};",
    "",
    "/** Names Scryfall had no card for. These use the folder and name heuristic. */",
    "export const TOKEN_LOOKUP_UNMATCHED: readonly string[] = [",
    ...unmatched.map((name) => `  ${JSON.stringify(name)},`),
    "];",
    "",
  ];
  writeFileSync(lookupFile, lines.join("\n"));
}

function report(lookup: Readonly<Record<string, TokenLookupEntry>>, unmatchedNames: readonly string[]): string {
  const queries = collectQueries();
  const entries = [...queries.entries()];
  const matched = entries.filter(([key]) => lookup[key]);
  const ambiguous = matched.filter(([key]) => lookup[key]!.ambiguous);
  const clear = matched.filter(([key]) => !lookup[key]!.ambiguous);
  const tokens = clear.filter(([key]) => lookup[key]!.token);
  const nonTokens = clear.filter(([key]) => !lookup[key]!.token);
  const unmatched = entries.filter(([key]) => !lookup[key]);
  const where = (uses: Use[]) => uses.map((use) => `${use.deck}: ${use.card} [${use.role}]`).join("; ");
  const cards = shippedCards();
  const verdicts = cards.map(({ deck, deckId, card }) => ({ deck, card, verdict: tokenVerdict(card, lookup, deckId), heuristic: heuristicIsToken(card) }));
  const byHand = verdicts.filter((item) => item.verdict.source === "override");
  // A name is settled by hand when every card that uses it has an override.
  const handNames = new Set(entries.filter(([, item]) => item.uses.every((use) => byHand.some((hit) => hit.deck === use.deck && hit.card.name === use.card))).map(([key]) => key));
  const ambiguousLeft = ambiguous.filter(([key]) => !handNames.has(key));
  const disagree = verdicts.filter((item) => item.verdict.source === "scryfall" && item.verdict.token !== item.heuristic);
  const out = [
    "BeeLine token lookup report (Scryfall cross-reference of every extra and token name in the shipped Standard decks)",
    "",
    `Cards looked at: ${cards.length} non-main cards in ${new Set(cards.map((item) => item.deck)).size} decks, ${entries.length} distinct look-up names.`,
    `Matched as tokens: ${tokens.length}`,
    `Matched as non-tokens: ${nonTokens.length}`,
    `Matched but no clear answer (a token and a game card share the exact name, or the only match is an art card or vanguard): ${ambiguous.length}, of which ${ambiguous.length - ambiguousLeft.length} decided by hand (overrides) and ${ambiguousLeft.length} left to the heuristic`,
    `Unmatched (no Scryfall card; the heuristic decides): ${unmatched.length}`,
    `Cards where Scryfall disagrees with the old folder/name heuristic: ${disagree.length}`,
    `Hand overrides: ${TOKEN_OVERRIDES.length} cards (${byHand.filter((item) => item.verdict.token).length} tokens, ${byHand.filter((item) => !item.verdict.token).length} not tokens); ${byHand.filter((item) => item.verdict.token !== item.heuristic).length} of them differ from the heuristic.`,
    `Per card: ${verdicts.filter((item) => item.verdict.token).length} counted as tokens, ${verdicts.filter((item) => !item.verdict.token).length} as other extras (${byHand.length} decided by hand, ${verdicts.filter((item) => item.verdict.source === "scryfall").length} by Scryfall, ${verdicts.filter((item) => item.verdict.source === "heuristic").length} by the heuristic).`,
    "",
    "Rule: a token is a Scryfall card whose layout is token, double_faced_token or emblem, or whose type line contains \"Token\".",
    "Heuristic (fallback, and the old rule): the card came from a Tokens folder, or its name starts with \"Token\".",
    "Overrides (src/data/token-overrides.ts): hand decisions by deck id and exact card name. They win over Scryfall and the heuristic.",
    "",
    `== Overrides (${TOKEN_OVERRIDES.length}) ==`,
    ...TOKEN_OVERRIDES.map((item) => {
      const hit = byHand.find((use) => use.verdict.override === item);
      const entry = lookup[normalizeKey(hit?.verdict.query ?? item.card)];
      const list = item.token ? "Token Backs" : "Alt Back";
      return `- ${hit?.deck ?? item.deck}: ${item.card} [${hit?.card.role ?? "no card"}] -> ${item.token ? "token" : "not a token"} (${list}). Heuristic: ${hit ? (hit.heuristic ? "token" : "not a token") : "-"}. Scryfall: ${entry ? `${entry.scryfall} (${entry.layout})${entry.ambiguous ? `, ambiguous: ${entry.ambiguous}` : ""}` : "no match"}.`;
    }),
    "",
    `== Scryfall disagrees with the old heuristic (${disagree.length}) ==`,
    ...disagree.map((item) => `- ${item.deck}: ${item.card.name} [${item.card.role}] heuristic ${item.heuristic ? "token" : "not a token"}, Scryfall ${item.verdict.token ? "token" : "not a token"} (${item.verdict.entry!.scryfall}, ${item.verdict.entry!.layout}, ${item.verdict.entry!.typeLine})`),
    "",
    `== Ambiguous, left to the heuristic (${ambiguousLeft.length}) ==`,
    ...ambiguousLeft.map(([key, item]) => `- ${item.query}: ${lookup[key]!.ambiguous}. Used by ${where(item.uses)}. Heuristic: ${[...new Set(item.uses.map((use) => (use.heuristic ? "token" : "not a token")))].join(" / ")}`),
    "",
    `== Unmatched (${unmatched.length}) ==`,
    ...unmatched.map(([, item]) => `- ${item.query}: ${where(item.uses)}. Heuristic: ${[...new Set(item.uses.map((use) => (use.heuristic ? "token" : "not a token")))].join(" / ")}`),
    "",
    `== Matched as tokens (${tokens.length}) ==`,
    ...tokens.map(([key, item]) => `- ${item.query} -> ${lookup[key]!.scryfall} (${lookup[key]!.layout}, ${lookup[key]!.typeLine})`),
    "",
    `== Matched as non-tokens (${nonTokens.length}) ==`,
    ...nonTokens.map(([key, item]) => `- ${item.query} -> ${lookup[key]!.scryfall} (${lookup[key]!.layout}, ${lookup[key]!.typeLine})`),
    "",
  ];
  const listed = new Set(unmatchedNames.map((name) => normalizeKey(name)));
  const stale = unmatched.filter(([key]) => !listed.has(key));
  if (stale.length) out.push(`Not in the committed lookup at all (run the script again): ${stale.map(([, item]) => item.query).join(", ")}`, "");
  return out.join("\n");
}

/** Overrides that match no token or extra, or more than one, by deck id and exact name. */
function overrideProblems(overrides: readonly TokenOverride[] = TOKEN_OVERRIDES): string[] {
  const cards = shippedCards();
  const problems: string[] = [];
  for (const item of overrides) {
    const hits = cards.filter((use) => use.deckId === item.deck && use.card.name === item.card);
    if (hits.length !== 1) problems.push(`${item.deck}: ${item.card} matches ${hits.length} token or extra card(s)`);
  }
  return problems;
}

function check(): number {
  const problems = overrideProblems();
  if (problems.length) {
    console.error(`Token overrides that don't match exactly one card: ${problems.join("; ")}. Fix src/data/token-overrides.ts.`);
    return 1;
  }
  const listed = new Set(TOKEN_LOOKUP_UNMATCHED.map((name) => normalizeKey(name)));
  const missing = [...collectQueries().entries()].filter(([key]) => !TOKEN_LOOKUP[key] && !listed.has(key)).map(([, item]) => item.query);
  if (missing.length) {
    console.error(`The token lookup has no entry for ${missing.length} name(s): ${missing.join(", ")}. Run npx tsx scripts/token-lookup.ts.`);
    return 1;
  }
  console.log(`Token lookup covers all ${collectQueries().size} extra and token names, and all ${TOKEN_OVERRIDES.length} overrides match one card each.`);
  return 0;
}

async function main() {
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined;
  if (process.argv.includes("--check")) process.exit(check());
  if (reportIndex >= 0) {
    const text = report(TOKEN_LOOKUP, TOKEN_LOOKUP_UNMATCHED);
    if (reportPath) writeFileSync(reportPath, text);
    console.log(text);
    return;
  }
  const { lookup, unmatched, requests } = await fetchLookup();
  writeLookup(lookup, unmatched);
  console.log(`Wrote ${path.relative(root, lookupFile)} after ${requests} Scryfall requests.`);
  console.log(report(lookup, unmatched));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
