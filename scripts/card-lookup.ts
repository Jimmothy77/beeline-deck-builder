/**
 * One-time card facts cross-reference for the deck filter.
 *
 *   npx tsx scripts/card-lookup.ts [--cache <dir>]   ask Scryfall, rewrite src/data/card-lookup.ts, print the report
 *   npx tsx scripts/card-lookup.ts --report <file>   print the report from the committed lookup (no network), and write it to <file>
 *   npx tsx scripts/card-lookup.ts --check           no network: every card name in public/decks has an entry or is listed as unmatched
 *
 * Every card in public/decks/*.json (main deck, tokens and extras) is looked
 * up by the same names as the token lookup (scripts/token-lookup.ts): the
 * front face, then the card name, without "(theme)", face prefixes or art
 * numbers. The saved token lookup is reused: a name it already found is sent
 * as Scryfall's own name for that card, and a name Scryfall had no card for
 * is not asked again. Names go 75 at a time to Scryfall's public
 * /cards/collection endpoint. A name whose answer is a token, or that the
 * token lookup marked as a token or as ambiguous, is then searched once as an
 * exact name (unique=oracle, include:extras): when several different cards
 * share the name (Spirit tokens, Blood), only the facts they all agree on are
 * kept and the entry is marked ambiguous. At most about 8 requests a second,
 * with a User-Agent and an Accept header. No key, no sign-in. The app itself
 * never calls Scryfall. --cache keeps each answer in a folder so a re-run asks
 * Scryfall nothing it already asked.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { CARD_LOOKUP, CARD_LOOKUP_UNMATCHED } from "../src/data/card-lookup";
import { TOKEN_LOOKUP, TOKEN_LOOKUP_UNMATCHED } from "../src/data/token-lookup";
import { factsFor, factsFromScryfall, mergeFacts, type CardFacts, type ScryfallCard } from "../src/lib/card-facts";
import { normalizeKey } from "../src/lib/names";
import { tokenQueryNames } from "../src/lib/tokens";
import type { DeckCatalogue, DeckCard } from "../src/lib/types";

const root = path.resolve(import.meta.dirname, "..");
const decksDir = path.join(root, "public", "decks");
const lookupFile = path.join(root, "src", "data", "card-lookup.ts");
const HEADERS = { "User-Agent": "BeeLineCardLookup/0.1.29 (one-time card facts cross-reference; static lookup)", Accept: "application/json" };
const GAP_MS = 125;
const TOKEN_LAYOUTS = new Set(["token", "double_faced_token", "emblem"]);
const GAME_LAYOUTS = new Set(["normal", "split", "flip", "transform", "modal_dfc", "meld", "leveler", "class", "case", "saga", "adventure", "mutate", "prototype", "battle", "prepare", "reversible_card"]);

type Use = { deck: string; card: string; role: DeckCard["role"] };

function shippedCards(): { deck: string; card: DeckCard }[] {
  const out: { deck: string; card: DeckCard }[] = [];
  for (const file of readdirSync(decksDir).filter((name) => name.endsWith(".json") && name !== "index.json").sort()) {
    const deck = JSON.parse(readFileSync(path.join(decksDir, file), "utf8")) as DeckCatalogue;
    for (const edition of deck.editions) for (const card of edition.cards) out.push({ deck: deck.name, card });
  }
  return out;
}

function collectQueries() {
  const queries = new Map<string, { query: string; uses: Use[] }>();
  for (const { deck, card } of shippedCards()) {
    for (const query of tokenQueryNames(card)) {
      const key = normalizeKey(query);
      if (!key) continue;
      const item = queries.get(key) ?? { query, uses: [] };
      if (!item.uses.some((use) => use.deck === deck && use.card === card.name)) item.uses.push({ deck, card: card.name, role: card.role });
      queries.set(key, item);
    }
  }
  return queries;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let requests = 0;
let cached = 0;

async function call(url: string, init: RequestInit, cacheDir: string | null): Promise<{ status: number; body: unknown }> {
  const file = cacheDir ? path.join(cacheDir, `${createHash("sha256").update(`${url}\n${String(init.body ?? "")}`).digest("hex").slice(0, 24)}.json`) : null;
  if (file && existsSync(file)) {
    cached++;
    return JSON.parse(readFileSync(file, "utf8")) as { status: number; body: unknown };
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(GAP_MS);
    const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
    requests++;
    if (response.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const result = { status: response.status, body: response.status === 404 ? null : ((await response.json()) as unknown) };
    if (!response.ok && response.status !== 404) throw new Error(`Scryfall answered ${response.status} for ${url}`);
    if (file) writeFileSync(file, JSON.stringify(result));
    return result;
  }
  throw new Error(`Scryfall kept answering 429 for ${url}`);
}

/** A main-deck name cleaned up for Scryfall's fuzzy look-up: no ".psd", no "Basic " or a leading count, no number stuck to the end. */
export function fuzzyName(query: string): string {
  return query
    .replace(/\.psd$/i, "")
    .replace(/^basic\s+/i, "")
    .replace(/^\d+\s+/, "")
    .replace(/([a-z])\d+$/i, "$1")
    .replace(/`/g, "'")
    .trim();
}

function namesOf(card: ScryfallCard): string[] {
  return [card.name, ...card.name.split(" // "), ...(card.card_faces ?? []).map((face) => face.name)];
}
const isToken = (card: ScryfallCard) => TOKEN_LAYOUTS.has(card.layout) || /\bToken\b/.test([card.type_line ?? "", ...(card.card_faces ?? []).map((face) => face.type_line ?? "")].join(" "));

async function fetchLookup(cacheDir: string | null) {
  const queries = [...collectQueries().entries()];
  const knownUnmatched = new Set(TOKEN_LOOKUP_UNMATCHED.map((name) => normalizeKey(name)));
  const ask = queries.filter(([key]) => !knownUnmatched.has(key));
  const hits = new Map<string, ScryfallCard>();
  for (let start = 0; start < ask.length; start += 75) {
    const batch = ask.slice(start, start + 75);
    const identifiers = batch.map(([key, item]) => ({ name: TOKEN_LOOKUP[key]?.scryfall ?? item.query }));
    const { body } = await call("https://api.scryfall.com/cards/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifiers }) }, cacheDir);
    const data = (body as { data: ScryfallCard[] }).data;
    batch.forEach(([key], index) => {
      const sent = normalizeKey(identifiers[index]!.name);
      const hit = data.find((card) => namesOf(card).some((name) => normalizeKey(name) === key || normalizeKey(name) === sent));
      if (hit) hits.set(key, hit);
    });
  }
  // A main-deck name the collection didn't know (a missing accent, a typo, "Forest1", "Arid Archway.psd") gets one fuzzy look-up.
  // Each fuzzy match is listed in the report so it can be checked by eye.
  // A name that dropped a leading "The" (the key ignores it) is first asked as "The <name>", exactly.
  const fuzzy = new Set<string>();
  for (const [key, item] of queries) {
    if (hits.has(key) || !item.uses.some((use) => use.role === "main")) continue;
    const cleaned = fuzzyName(item.query);
    if (!cleaned) continue;
    const withThe = /^the\s/i.test(cleaned) ? null : await call(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(`The ${cleaned}`)}`, {}, cacheDir);
    const found = withThe?.status === 200 ? withThe : await call(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleaned)}`, {}, cacheDir);
    if (found.status !== 200 || !found.body) continue;
    hits.set(key, found.body as ScryfallCard);
    fuzzy.add(key);
  }
  const lookup: Record<string, CardFacts> = {};
  let searched = 0;
  for (const [key, item] of queries) {
    const hit = hits.get(key);
    if (!hit) continue;
    const saved = TOKEN_LOOKUP[key];
    const needsSearch = isToken(hit) || !GAME_LAYOUTS.has(hit.layout) || saved?.token === true || Boolean(saved?.ambiguous);
    let candidates: ScryfallCard[] = [hit];
    if (needsSearch) {
      searched++;
      const name = saved?.scryfall ?? hit.name;
      const found: ScryfallCard[] = [];
      let url: string | null = `https://api.scryfall.com/cards/search?unique=oracle&q=${encodeURIComponent(`!"${name.replace(/"/g, "")}" include:extras`)}`;
      while (url) {
        const { status, body } = await call(url, {}, cacheDir);
        if (status === 404) break;
        const page = body as { data: ScryfallCard[]; has_more?: boolean; next_page?: string };
        found.push(...page.data);
        url = page.has_more && page.next_page ? page.next_page : null;
      }
      const exact = found.filter((card) => namesOf(card).some((other) => normalizeKey(other) === normalizeKey(name) || normalizeKey(other) === key));
      // The token lookup's verdict picks the side: a token keeps only tokens, a game card only game cards. Ambiguous names keep both.
      const side = saved?.ambiguous ? exact.filter((card) => isToken(card) || GAME_LAYOUTS.has(card.layout)) : (saved?.token ?? isToken(hit)) ? exact.filter(isToken) : exact.filter((card) => !isToken(card) && GAME_LAYOUTS.has(card.layout));
      if (side.length) candidates = side;
      else if (!isToken(hit) && !GAME_LAYOUTS.has(hit.layout)) candidates = [];
    }
    if (!candidates.length) {
      lookup[key] = { query: item.query, scryfall: hit.name, layout: hit.layout, ambiguous: `only a non-game Scryfall object: ${hit.name} (${hit.layout})` };
      continue;
    }
    lookup[key] = { query: item.query, ...mergeFacts(candidates.map(factsFromScryfall)), ...(fuzzy.has(key) ? { fuzzy: true } : {}) };
  }
  const unmatched = queries.filter(([key]) => !lookup[key]).map(([, item]) => item.query).sort((a, b) => a.localeCompare(b));
  return { lookup, unmatched, asked: ask.length, skipped: queries.length - ask.length, searched, fuzzy: fuzzy.size };
}

function writeLookup(lookup: Record<string, CardFacts>, unmatched: string[]) {
  const keys = Object.keys(lookup).sort();
  const lines = [
    "// Generated by scripts/card-lookup.ts from Scryfall's public API (one-time cross-reference). Do not edit by hand.",
    "// Keys are normalizeKey(tokenQueryName(name)). The app never calls Scryfall. Card data (c) Wizards of the Coast, via Scryfall.",
    'import type { CardFacts } from "@/lib/card-facts";',
    "",
    "export const CARD_LOOKUP: Readonly<Record<string, CardFacts>> = {",
    ...keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(lookup[key])},`),
    "};",
    "",
    "/** Names Scryfall had no card for. The attribute filters leave these cards out; name search still finds them. */",
    "export const CARD_LOOKUP_UNMATCHED: readonly string[] = [",
    ...unmatched.map((name) => `  ${JSON.stringify(name)},`),
    "];",
    "",
  ];
  writeFileSync(lookupFile, lines.join("\n"));
}

function report(lookup: Readonly<Record<string, CardFacts>>, unmatchedNames: readonly string[]): string {
  const entries = [...collectQueries().entries()];
  const matched = entries.filter(([key]) => lookup[key] && !lookup[key]!.ambiguous);
  const ambiguous = entries.filter(([key]) => lookup[key]?.ambiguous);
  const unmatched = entries.filter(([key]) => !lookup[key]);
  const cards = shippedCards();
  const status = cards.map(({ deck, card }) => ({ deck, card, status: factsFor(card, lookup).status }));
  const count = (role: DeckCard["role"] | null, which: string) => status.filter((item) => (!role || item.card.role === role) && item.status === which).length;
  const where = (uses: Use[]) => uses.map((use) => `${use.deck}: ${use.card} [${use.role}]`).join("; ");
  const listed = new Set(unmatchedNames.map((name) => normalizeKey(name)));
  const stale = unmatched.filter(([key]) => !listed.has(key));
  return [
    "BeeLine card facts report (Scryfall cross-reference of every card name in the shipped Standard decks, for the deck filter)",
    "",
    `Names: ${entries.length} distinct look-up names: ${matched.length} matched, ${ambiguous.length} ambiguous, ${unmatched.length} unmatched.`,
    `Cards: ${cards.length} cards in ${new Set(cards.map((item) => item.deck)).size} decks: ${count(null, "matched")} matched, ${count(null, "ambiguous")} ambiguous, ${count(null, "unmatched")} unmatched.`,
    ...(["main", "token", "extra"] as const).map((role) => `  ${role}: ${count(role, "matched")} matched, ${count(role, "ambiguous")} ambiguous, ${count(role, "unmatched")} unmatched`),
    "",
    "A card is matched when one of its names (front face, then card name) has one clear Scryfall card. Ambiguous: several",
    "different Scryfall cards share the name (only the facts they agree on are kept; filters on the other facts leave the card",
    "out), or the only match is not a game card. Unmatched: Scryfall has no card by that name; name search still finds it.",
    "Rarity is the rarity of the printing Scryfall returns for the name.",
    "",
    `== Matched by a second look-up ("The <name>" exactly, or Scryfall's fuzzy name match), main-deck names only; check these by eye (${matched.filter(([key]) => lookup[key]!.fuzzy).length}) ==`,
    ...matched.filter(([key]) => lookup[key]!.fuzzy).map(([key, item]) => `- ${item.query} -> ${lookup[key]!.scryfall}`),
    "",
    `== Ambiguous (${ambiguous.length}) ==`,
    ...ambiguous.map(([key, item]) => `- ${item.query}: ${lookup[key]!.ambiguous}. Used by ${where(item.uses)}`),
    "",
    `== Unmatched (${unmatched.length}) ==`,
    ...unmatched.map(([, item]) => `- ${item.query}: ${where(item.uses)}`),
    "",
    `== Matched (${matched.length}) ==`,
    ...matched.map(([key, item]) => {
      const f = lookup[key]!;
      return `- ${item.query} -> ${f.scryfall} | ${f.typeLine ?? "-"} | ${f.colors ? f.colors.join("") || "C" : "-"} | mv ${f.cmc ?? "-"} | ${f.rarity ?? "-"}${f.power !== undefined ? ` | ${f.power}/${f.toughness}` : ""}`;
    }),
    "",
    ...(stale.length ? [`Not in the committed lookup at all (run the script again): ${stale.map(([, item]) => item.query).join(", ")}`, ""] : []),
  ].join("\n");
}

/** The --check: 0 when every card name has an entry or an unmatched line, never both. */
export function check(lookup: Readonly<Record<string, CardFacts>> = CARD_LOOKUP, unmatched: readonly string[] = CARD_LOOKUP_UNMATCHED): number {
  const listed = new Set(unmatched.map((name) => normalizeKey(name)));
  const queries = collectQueries();
  const missing = [...queries.entries()].filter(([key]) => !lookup[key] && !listed.has(key)).map(([, item]) => item.query);
  if (missing.length) {
    console.error(`The card lookup has no entry for ${missing.length} name(s): ${missing.join(", ")}. Run npx tsx scripts/card-lookup.ts.`);
    return 1;
  }
  const both = [...listed].filter((key) => lookup[key]);
  if (both.length) {
    console.error(`The card lookup lists ${both.length} name(s) as both matched and unmatched: ${both.join(", ")}.`);
    return 1;
  }
  const cards = shippedCards();
  const matched = cards.filter(({ card }) => factsFor(card, lookup).status === "matched").length;
  console.log(`Card lookup covers all ${queries.size} card names (${cards.length} cards, ${matched} with Scryfall facts).`);
  return 0;
}

async function main() {
  const reportIndex = process.argv.indexOf("--report");
  const cacheIndex = process.argv.indexOf("--cache");
  if (process.argv.includes("--check")) process.exit(check());
  if (reportIndex >= 0) {
    const text = report(CARD_LOOKUP, CARD_LOOKUP_UNMATCHED);
    const out = process.argv[reportIndex + 1];
    if (out) writeFileSync(out, text);
    console.log(text);
    return;
  }
  const cacheDir = cacheIndex >= 0 ? process.argv[cacheIndex + 1] ?? null : null;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const { lookup, unmatched, asked, skipped, searched, fuzzy } = await fetchLookup(cacheDir);
  writeLookup(lookup, unmatched);
  console.log(`Wrote ${path.relative(root, lookupFile)}: ${asked} names sent to /cards/collection (${skipped} not sent: the token lookup already had no Scryfall card for them), ${searched} exact-name searches, ${fuzzy} matched by a second look-up, ${requests} Scryfall requests, ${cached} answers from the cache.`);
  console.log(report(lookup, unmatched));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
