const IMAGE_EXT = /\.(jpe?g|png|webp|gif|pdf|tiff?)$/i;

/** HTML from the public folder view still has entities in a few titles. */
export function decodeEntities(name: string): string {
  return name
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[’‘]/g, "'");
}

export function stripExt(name: string): string {
  return name.replace(IMAGE_EXT, "");
}

export function isPrintImage(name: string): boolean {
  return IMAGE_EXT.test(name);
}

/**
 * Some editions write an apostrophe as `_s` (Kingdom_s Edge, Akroma_s Will).
 * Only that possessive pattern is repaired, and only for matching.
 */
export function repairApostrophes(name: string): string {
  return name.replace(/_s\b/g, "'s");
}

/** Loose key: case, punctuation, "&" vs "and", possessives, and the word "the". */
export function normalizeKey(input: string): string {
  let s = repairApostrophes(decodeEntities(input)).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/'s\b/g, " ");
  s = s.replace(/'/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\bthe\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export type ParsedName = {
  /** File stem after a face prefix is removed, apostrophes repaired for display. */
  stem: string;
  facePair: string | null;
  face: 1 | 2 | null;
  /** Trailing art number, when it is a variant rather than part of the card name. */
  variant: string | null;
  /** Stem without the variant number. */
  base: string;
  key: string;
  keyWithVariant: string;
  /** Base with the parenthetical theme removed. "Watery Grave (Trail's End)" → "watery grave". */
  cardNameKey: string;
};

/**
 * A double-faced print: "1_1_Front Name" is the front and "1_2_Back Name" the
 * back of card 1. Some files use a space after the face number instead
 * ("1_2 Lost Vale"), so either is accepted. "1 Island" has no face number and
 * is not a face.
 */
const FACE_PREFIX = /^(\d+)_([12])[_ ]\s*(\S.*)$/;
/** "Card Name (Variant) 2" — the number after a closing paren is always a variant. */
const PAREN_VARIANT = /^(.*\))\s+(\d+)$/;

export function parsePrintName(filename: string): ParsedName {
  const originalStem = stripExt(decodeEntities(filename)).trim();
  let working = repairApostrophes(originalStem);
  let facePair: string | null = null;
  let face: 1 | 2 | null = null;
  const faceMatch = working.match(FACE_PREFIX);
  if (faceMatch?.[1] && faceMatch[2] && faceMatch[3]) {
    facePair = faceMatch[1];
    face = faceMatch[2] === "2" ? 2 : 1;
    working = faceMatch[3].trim();
  }
  let variant: string | null = null;
  let base = working;
  const paren = working.match(PAREN_VARIANT);
  if (paren?.[1] && paren[2]) {
    base = paren[1].trim();
    variant = paren[2];
  }
  return finishParsed(working, base, variant, facePair, face);
}

function finishParsed(
  stem: string,
  base: string,
  variant: string | null,
  facePair: string | null,
  face: 1 | 2 | null,
): ParsedName {
  const withoutParen = base.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return {
    stem,
    facePair,
    face,
    variant,
    base,
    key: normalizeKey(base),
    keyWithVariant: normalizeKey(stem),
    cardNameKey: normalizeKey(withoutParen || base),
  };
}

/**
 * Inside an alternates folder, "Sol Ring 2" and "Plains 3 1" use the trailing
 * number as the variant. "Plains 1.jpg" sitting loose in the main deck does not:
 * that number is a different basic land.
 */
export function withFolderVariant(parsed: ParsedName, folderName: string | null): ParsedName {
  if (!folderName || parsed.variant) return parsed;
  const match = parsed.stem.match(/^(.*\S)\s+(\d+)$/);
  if (!match?.[1] || !match[2]) return parsed;
  const base = match[1].trim();
  const baseKey = normalizeKey(base);
  const folderKey = normalizeKey(folderName);
  const folderCard = normalizeKey(folderName.replace(/\s*\([^)]*\)/g, " "));
  const related =
    folderKey === baseKey ||
    folderKey.startsWith(`${baseKey} `) ||
    baseKey.startsWith(`${folderKey} `) ||
    folderCard === baseKey;
  if (!related) return parsed;
  return finishParsed(parsed.stem, base, match[2], parsed.facePair, parsed.face);
}

export function slug(input: string): string {
  const key = normalizeKey(input).replace(/\s+/g, "-");
  return key || "card";
}

export function cleanDeckName(folderName: string): string {
  let s = decodeEntities(folderName).replace(/^\s*\d+(?:\.\d+)?\s*[_\s.-]+\s*/, "");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\b(standard|deluxe|partial\s*foil|edition|dpi|pdf|maps?|prints?)\b/gi, " ");
  s = s.replace(/\b\d{3,4}\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const GENERIC_DECK = new Set(["pdf", "map", "maps", "print", "prints", "edition", "foil"]);

export function isGenericDeckName(name: string): boolean {
  const plain = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return !plain || GENERIC_DECK.has(plain);
}

/** Use the parent pack name when this folder's own name is only map or edition words. */
export function preferDeckName(ownName: string, parentName?: string | null): string {
  const own = cleanDeckName(ownName);
  if (own && !isGenericDeckName(own)) return own;
  if (parentName) {
    const parent = cleanDeckName(parentName);
    if (parent && !isGenericDeckName(parent)) return parent;
  }
  return own || decodeEntities(ownName).trim();
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** MPCFill query: the card name, without the art-theme parenthesis or a variant number. */
export function queryFor(name: string): string {
  return parsePrintName(name).cardNameKey;
}
