import { COLOR_ORDER, type CardFacts, type ColorLetter, type FactsStatus } from "@/lib/card-facts";
import { own } from "@/lib/own";

/**
 * The deck view's card filter, modelled on Scryfall search. One model is
 * edited by the filter controls and by the text box, which reads a small
 * Scryfall-style query ("t:creature c:g mv<=3"). The filter only changes
 * which cards are shown, never their counts.
 */

export const CARD_TYPES = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "land", "battle"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"] as const;
export type Rarity = (typeof RARITIES)[number];
export type ColorMode = "any" | "all" | "exact";
export type NumOp = "=" | "!=" | "<" | ">" | "<=" | ">=";
export type NumTest = { op: NumOp; value: number } | { op: "range"; min: number; max: number };

export type CardFilter = {
  /** Words (or "quoted phrases") that must all be in the card's name. */
  name: string[];
  colors: ColorLetter[];
  /** any: at least one of the picked colors. all: every picked color (more allowed). exact: exactly the picked colors. */
  colorMode: ColorMode;
  /** Colorless cards match too (on their own: only colorless cards). */
  colorless: boolean;
  /** Only cards of two or more colors. */
  multicolor: boolean;
  types: CardType[];
  /** any: one of the picked types. all: every picked type. */
  typeMode: "any" | "all";
  /** Text that must all be in the type line ("goblin", "legendary"). */
  typeText: string[];
  mv: NumTest | null;
  /** Any of these. */
  rarities: Rarity[];
  /** Text that must all be in the rules text. */
  oracle: string[];
  power: NumTest | null;
  toughness: NumTest | null;
  /** Only cards with at least one copy in the deck. */
  inDeck: boolean;
  dfc: boolean;
  /** Only tokens and extras (not main-deck cards). */
  tokenExtra: boolean;
  basics: boolean;
};

export const EMPTY_FILTER: CardFilter = {
  name: [],
  colors: [],
  colorMode: "any",
  colorless: false,
  multicolor: false,
  types: [],
  typeMode: "any",
  typeText: [],
  mv: null,
  rarities: [],
  oracle: [],
  power: null,
  toughness: null,
  inDeck: false,
  dfc: false,
  tokenExtra: false,
  basics: false,
};

/** Filters that need Scryfall facts. A card without the fact is left out by them. */
export function attributeFilters(filter: CardFilter): string[] {
  const out: string[] = [];
  if (filter.colors.length || filter.colorless || filter.multicolor) out.push("color");
  if (filter.types.length || filter.typeText.length) out.push("type");
  if (filter.mv) out.push("mana value");
  if (filter.rarities.length) out.push("rarity");
  if (filter.oracle.length) out.push("rules text");
  if (filter.power) out.push("power");
  if (filter.toughness) out.push("toughness");
  return out;
}

/** The same filter without the parts that need Scryfall facts (used when the card data couldn't load). */
export function withoutAttributeFilters(filter: CardFilter): CardFilter {
  return { ...filter, colors: [], colorMode: "any", colorless: false, multicolor: false, types: [], typeMode: "any", typeText: [], mv: null, rarities: [], oracle: [], power: null, toughness: null };
}

export function isFilterActive(filter: CardFilter): boolean {
  return Boolean(filter.name.length || attributeFilters(filter).length || filter.inDeck || filter.dfc || filter.tokenExtra || filter.basics);
}

/** What the matcher needs to know about one card. */
export type FilterSubject = {
  names: string[];
  role: "main" | "token" | "extra";
  dfc: boolean;
  basic: boolean;
  copies: number;
  status: FactsStatus;
  facts: CardFacts | null;
};

/** shown: passes. hidden: fails on what is known. unknown: would need a fact Scryfall has no clear value for. */
export type FilterResult = "shown" | "hidden" | "unknown";

function numberOf(value: string | undefined): number | null {
  if (value === undefined || !/^[-+]?\d+(\.\d+)?$/.test(value.trim())) return null;
  return Number(value);
}

export function testNumber(test: NumTest, value: number): boolean {
  switch (test.op) {
    case "range":
      return value >= test.min && value <= test.max;
    case "=":
      return value === test.value;
    case "!=":
      return value !== test.value;
    case "<":
      return value < test.value;
    case ">":
      return value > test.value;
    case "<=":
      return value <= test.value;
    case ">=":
      return value >= test.value;
  }
}

const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

function colorTest(filter: CardFilter, colors: readonly ColorLetter[]): boolean {
  const picked = filter.colors;
  let ok: boolean;
  if (!picked.length) ok = filter.colorless ? colors.length === 0 : true;
  else {
    const byMode =
      filter.colorMode === "any"
        ? picked.some((color) => colors.includes(color))
        : filter.colorMode === "all"
          ? picked.every((color) => colors.includes(color))
          : picked.length === colors.length && picked.every((color) => colors.includes(color));
    ok = byMode || (filter.colorless && colors.length === 0);
  }
  return ok && (!filter.multicolor || colors.length >= 2);
}

/** Does the card pass? Checks that need no Scryfall facts come first, so a card they rule out is "hidden", not "unknown". */
export function matchCard(subject: FilterSubject, filter: CardFilter): FilterResult {
  if (filter.name.length && !filter.name.every((word) => subject.names.some((name) => has(name, word)))) return "hidden";
  if (filter.inDeck && subject.copies <= 0) return "hidden";
  if (filter.dfc && !subject.dfc) return "hidden";
  if (filter.tokenExtra && subject.role === "main") return "hidden";
  if (filter.basics && !subject.basic) return "hidden";
  const facts = subject.facts;
  let unknown = false;
  const need = <T,>(value: T | undefined, test: (value: T) => boolean): boolean => {
    if (value === undefined) {
      unknown = true;
      return true;
    }
    return test(value);
  };
  if (filter.colors.length || filter.colorless || filter.multicolor) {
    if (!need(facts?.colors, (colors) => colorTest(filter, colors))) return "hidden";
  }
  if (filter.types.length || filter.typeText.length) {
    const ok = need(facts?.typeLine, (line) => {
      const typeOk = !filter.types.length || (filter.typeMode === "all" ? filter.types.every((type) => has(line, type)) : filter.types.some((type) => has(line, type)));
      return typeOk && filter.typeText.every((part) => has(line, part));
    });
    if (!ok) return "hidden";
  }
  if (filter.mv && !need(facts?.cmc, (cmc) => testNumber(filter.mv!, cmc))) return "hidden";
  if (filter.rarities.length && !need(facts?.rarity, (rarity) => (filter.rarities as string[]).includes(rarity))) return "hidden";
  if (filter.oracle.length && !need(facts?.oracle, (text) => filter.oracle.every((part) => has(text, part)))) return "hidden";
  // A creature's "*" power is a fact, but not a number: it fails a number test rather than being unknown.
  if (filter.power && !need(facts?.power, (power) => numberOf(power) !== null && testNumber(filter.power!, numberOf(power)!))) return "hidden";
  if (filter.toughness && !need(facts?.toughness, (tough) => numberOf(tough) !== null && testNumber(filter.toughness!, numberOf(tough)!))) return "hidden";
  return unknown ? "unknown" : "shown";
}

// ---- The text query ----

const COLOR_WORDS: Record<string, ColorLetter[]> = {
  white: ["W"], blue: ["U"], black: ["B"], red: ["R"], green: ["G"],
  azorius: ["W", "U"], dimir: ["U", "B"], rakdos: ["B", "R"], gruul: ["R", "G"], selesnya: ["G", "W"],
  orzhov: ["W", "B"], izzet: ["U", "R"], golgari: ["B", "G"], boros: ["R", "W"], simic: ["G", "U"],
};
const RARITY_LETTERS: Record<string, Rarity> = { c: "common", u: "uncommon", r: "rare", m: "mythic", s: "special", b: "bonus" };
const KEYS: Record<string, "color" | "type" | "mv" | "rarity" | "oracle" | "power" | "toughness" | "is" | "qty" | "name"> = {
  c: "color", color: "color", colors: "color",
  t: "type", type: "type",
  mv: "mv", cmc: "mv", manavalue: "mv",
  r: "rarity", rarity: "rarity",
  o: "oracle", oracle: "oracle",
  pow: "power", power: "power",
  tou: "toughness", toughness: "toughness",
  is: "is", qty: "qty", count: "qty",
  name: "name",
};

export type ParsedQuery = { filter: CardFilter; unknown: string[] };

type Term = { key: string | null; op: string; value: string; raw: string };

/** Splits a query into terms and "or" groups. Quotes keep spaces; parentheses group. */
function tokenize(text: string): (Term | "or" | "(" | ")")[] {
  const out: (Term | "or" | "(" | ")")[] = [];
  const re = /\s*(?:(\(|\))|(?:([a-z]+)(:|!=|<=|>=|=|<|>))?("([^"]*)"?|[^\s()"]+))/giy;
  let match: RegExpExecArray | null;
  while (re.lastIndex < text.length && (match = re.exec(text))) {
    const [whole, paren, key, op, value, quoted] = match;
    if (!whole.trim()) break;
    if (paren) out.push(paren as "(" | ")");
    else if (!key && /^or$/i.test(value!)) out.push("or");
    else out.push({ key: key ? key.toLowerCase() : null, op: op ?? "", value: quoted ?? value!, raw: whole.trim() });
  }
  return out;
}

function parseNumber(op: string, value: string): NumTest | null {
  const n = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(n)) return null;
  const real = op === ":" ? "=" : op;
  return ["=", "!=", "<", ">", "<=", ">="].includes(real) ? { op: real as NumOp, value: n } : null;
}

/** Two bounds on the same number make a range ("mv>=2 mv<=4"). */
function joinNumber(current: NumTest | null, next: NumTest): NumTest {
  if (!current || current.op === "range" || next.op === "range") return next;
  const low = (test: NumTest) => (test.op === ">=" ? (test as { value: number }).value : test.op === ">" ? (test as { value: number }).value + 1 : null);
  const high = (test: NumTest) => (test.op === "<=" ? (test as { value: number }).value : test.op === "<" ? (test as { value: number }).value - 1 : null);
  const min = low(current) ?? low(next);
  const max = high(current) ?? high(next);
  if (min !== null && max !== null && (low(current) === null) !== (low(next) === null)) return { op: "range", min, max };
  return next;
}

function colorLetters(value: string): ColorLetter[] | "c" | "m" | null {
  const v = value.toLowerCase();
  if (v === "c" || v === "colorless") return "c";
  if (v === "m" || v === "multicolor") return "m";
  const words = own(COLOR_WORDS, v);
  if (words) return words;
  if (/^[wubrg]+$/.test(v)) return COLOR_ORDER.filter((color) => v.includes(color.toLowerCase()));
  return null;
}

export function parseQuery(text: string): ParsedQuery {
  const filter: CardFilter = structuredClone(EMPTY_FILTER);
  const unknown: string[] = [];
  // An empty value (an unfinished t:" or a bare "") means nothing yet: it is dropped, not listed as not understood.
  const tokens = tokenize(text).filter((token) => typeof token === "string" || token.value.trim() !== "");
  // Collect plain terms and "or" groups (a run of terms joined by "or", with or without parentheses).
  const items: Term[][] = [];
  let pendingOr = false;
  for (const token of tokens) {
    if (token === "(" || token === ")") continue;
    if (token === "or") {
      pendingOr = true;
      continue;
    }
    if (pendingOr && items.length) items[items.length - 1]!.push(token);
    else items.push([token]);
    pendingOr = false;
  }
  for (const terms of items) {
    if (terms.length > 1 && terms.every((term) => !term.key)) {
      // "Fight or Flight": plain words around "or" are part of a name.
      terms.forEach((term, index) => filter.name.push(...(index ? ["or", term.value] : [term.value])));
      continue;
    }
    if (terms.length > 1) {
      if (!applyOrGroup(filter, terms)) unknown.push(terms.map((term) => term.raw).join(" or "));
      continue;
    }
    const term = terms[0]!;
    if (!applyTerm(filter, term)) unknown.push(term.raw);
  }
  return { filter: normalizeFilter(filter), unknown };
}

/** One picked color reads the same in "any" and "all", and one picked type in either type mode: both are kept as "any". */
export function normalizeFilter(filter: CardFilter): CardFilter {
  const colorMode = filter.colors.length <= 1 && filter.colorMode === "all" ? "any" : filter.colorMode;
  const typeMode = filter.types.length <= 1 ? "any" : filter.typeMode;
  return colorMode === filter.colorMode && typeMode === filter.typeMode ? filter : { ...filter, colorMode, typeMode };
}

/** "t:creature or t:instant", "c:w or c:u", "r:rare or r:mythic": one of. Other groups are not understood. */
function applyOrGroup(filter: CardFilter, terms: Term[]): boolean {
  const kinds = new Set(terms.map((term) => (term.key ? (own(KEYS, term.key) ?? null) : null)));
  if (kinds.size !== 1 || terms.some((term) => term.op !== ":" && term.op !== "=")) return false;
  const kind = [...kinds][0];
  if (kind === "type") {
    const types = terms.map((term) => term.value.toLowerCase());
    if (!types.every((type) => (CARD_TYPES as readonly string[]).includes(type)) || filter.types.length) return false;
    filter.types = types as CardType[];
    filter.typeMode = "any";
    return true;
  }
  if (kind === "color") {
    if (filter.colors.length || filter.colorless) return false;
    const parsed = terms.map((term) => ({ term, letters: colorLetters(term.value) }));
    const colorless = parsed.filter((item) => item.letters === "c");
    const rest = parsed.filter((item) => item.letters !== "c");
    if (colorless.length > 1 || !rest.length || rest.some((item) => !Array.isArray(item.letters))) return false;
    const lists = rest.map((item) => item.letters as ColorLetter[]);
    if (lists.every((list) => list.length === 1) && rest.every((item) => item.term.op === ":") && (rest.length > 1 || colorless.length)) {
      filter.colors = COLOR_ORDER.filter((color) => lists.some((list) => list[0] === color));
      filter.colorMode = "any";
    } else if (rest.length === 1) {
      // "c:wu or c:c": all of these colors, or colorless. "c=wu or c:c": exactly these, or colorless.
      filter.colors = lists[0]!;
      filter.colorMode = rest[0]!.term.op === "=" ? "exact" : "all";
    } else return false;
    filter.colorless = colorless.length === 1;
    return true;
  }
  if (kind === "rarity") {
    const list = terms.map((term) => rarityOf(term.value));
    if (list.some((item) => !item)) return false;
    filter.rarities = [...new Set([...filter.rarities, ...(list as Rarity[])])];
    return true;
  }
  return false;
}

function rarityOf(value: string): Rarity | null {
  const v = value.toLowerCase();
  if ((RARITIES as readonly string[]).includes(v)) return v as Rarity;
  return own(RARITY_LETTERS, v) ?? null;
}

function applyTerm(filter: CardFilter, term: Term): boolean {
  if (!term.key) {
    if (!term.value) return false;
    filter.name.push(term.value);
    return true;
  }
  const kind = own(KEYS, term.key);
  const { op, value } = term;
  switch (kind) {
    case "name":
      if (op !== ":" && op !== "=") return false;
      filter.name.push(value);
      return true;
    case "color": {
      const letters = colorLetters(value);
      if (!letters) return false;
      if (letters === "c") {
        if (op !== ":" && op !== "=") return false;
        filter.colorless = true;
        return true;
      }
      if (letters === "m") {
        if (op !== ":" && op !== "=") return false;
        filter.multicolor = true;
        return true;
      }
      if (op === "=") filter.colorMode = "exact";
      else if (op === ":" || op === ">=") filter.colorMode = "all";
      else return false;
      filter.colors = COLOR_ORDER.filter((color) => letters.includes(color) || filter.colors.includes(color));
      return true;
    }
    case "type": {
      if (op !== ":" && op !== "=") return false;
      const v = value.toLowerCase();
      if ((CARD_TYPES as readonly string[]).includes(v)) {
        if (!filter.types.includes(v as CardType)) filter.types.push(v as CardType);
        // Scryfall reads two type terms as both.
        if (filter.types.length > 1) filter.typeMode = "all";
      } else filter.typeText.push(value);
      return true;
    }
    case "mv": {
      const test = parseNumber(op, value);
      if (!test) return false;
      filter.mv = joinNumber(filter.mv, test);
      return true;
    }
    case "power":
    case "toughness": {
      const test = parseNumber(op, value);
      if (!test) return false;
      filter[kind] = joinNumber(filter[kind], test);
      return true;
    }
    case "rarity": {
      if (op !== ":" && op !== "=") return false;
      const rarity = rarityOf(value);
      if (!rarity) return false;
      if (!filter.rarities.includes(rarity)) filter.rarities.push(rarity);
      return true;
    }
    case "oracle":
      if (op !== ":" && op !== "=") return false;
      filter.oracle.push(value);
      return true;
    case "is": {
      if (op !== ":" && op !== "=") return false;
      const v = value.toLowerCase();
      if (v === "dfc" || v === "doublefaced") filter.dfc = true;
      else if (v === "token" || v === "extra") filter.tokenExtra = true;
      else if (v === "basic") filter.basics = true;
      else if (v === "indeck" || v === "counted") filter.inDeck = true;
      else return false;
      return true;
    }
    case "qty":
      if (op === ">" && value === "0") {
        filter.inDeck = true;
        return true;
      }
      return false;
    default:
      return false;
  }
}

const quote = (value: string) => (/[\s()":<>=!]/.test(value) || /^or$/i.test(value) ? `"${value.replace(/"/g, "")}"` : value);

function formatNumber(key: string, test: NumTest): string {
  if (test.op === "range") return `${key}>=${test.min} ${key}<=${test.max}`;
  return `${key}${test.op}${test.value}`;
}

/** The query text for a filter. parseQuery(formatQuery(filter)) gives the same filter back. */
export function formatQuery(filter: CardFilter): string {
  const filled = (list: string[]) => list.filter((value) => value.trim() !== "");
  const parts: string[] = [...filled(filter.name).map(quote)];
  const letters = filter.colors.map((color) => color.toLowerCase()).join("");
  if (filter.colors.length) {
    if (filter.colorMode === "any" && filter.colors.length > 1) parts.push(`(${[...filter.colors.map((color) => `c:${color.toLowerCase()}`), ...(filter.colorless ? ["c:c"] : [])].join(" or ")})`);
    else {
      const one = `c${filter.colorMode === "exact" ? "=" : ":"}${letters}`;
      parts.push(filter.colorless ? `(${one} or c:c)` : one);
    }
  } else if (filter.colorless) parts.push("c:c");
  if (filter.multicolor) parts.push("c:m");
  if (filter.types.length > 1 && filter.typeMode === "any") parts.push(`(${filter.types.map((type) => `t:${type}`).join(" or ")})`);
  else parts.push(...filter.types.map((type) => `t:${type}`));
  parts.push(...filled(filter.typeText).map((text) => `t:${quote(text)}`));
  if (filter.mv) parts.push(formatNumber("mv", filter.mv));
  if (filter.rarities.length > 1) parts.push(`(${filter.rarities.map((rarity) => `r:${rarity}`).join(" or ")})`);
  else parts.push(...filter.rarities.map((rarity) => `r:${rarity}`));
  parts.push(...filled(filter.oracle).map((text) => `o:${quote(text)}`));
  if (filter.power) parts.push(formatNumber("pow", filter.power));
  if (filter.toughness) parts.push(formatNumber("tou", filter.toughness));
  if (filter.inDeck) parts.push("qty>0");
  if (filter.dfc) parts.push("is:dfc");
  if (filter.tokenExtra) parts.push("is:token");
  if (filter.basics) parts.push("is:basic");
  return parts.join(" ");
}
