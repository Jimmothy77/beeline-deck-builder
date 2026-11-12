import { attachFoilMaps, splitFoilMasks } from "@/lib/foil-maps";
import {
  cleanDeckName,
  isPrintImage,
  naturalCompare,
  normalizeKey,
  parsePrintName,
  repairApostrophes,
  slug,
  stripExt,
  withFolderVariant,
  type ParsedName,
} from "@/lib/names";
import { isDecklistFile, orderDecklists, parseDecklist } from "@/lib/decklist";
import { pairLooseFaces } from "@/lib/faces";
import type {
  ArtFile,
  ArtTone,
  Decklist,
  CardBack,
  CardRole,
  CatalogueNote,
  DeckCard,
  DeckCatalogue,
  Edition,
  PrintType,
  RawNode,
} from "@/lib/types";

type EditionKind = "standard" | "deluxe" | "partial_foil";

type FaceDraft = {
  id: string;
  name: string;
  parsed: ParsedName;
  defaultArt: ArtFile | null;
  alternates: ArtFile[];
};

type CardDraft = {
  id: string;
  name: string;
  role: CardRole;
  faces: FaceDraft[];
  defaultQty: number;
  /** Unmatched black-and-white print. All cards and Random leave it at 0 until someone adds it. */
  bwOnly?: boolean;
};

const GENERIC_FOLDER =
  /^(extras?|alternate arts?|alternate cards?|tokens?|front|back|backs|card backs?|full deck(?:\s.*)?|partial foils?\b.*|templates?|fonts?)$/i;

/**
 * A sibling folder is its own product (Standard / Deluxe / Partial Foil),
 * not an internal folder such as "Partial Foil Map" or "Deluxe Edition (1200 DPI)"
 * when that name is being classified from inside a pack. Internal maps mention
 * "pdf" or "map" and are not products.
 */
/** Lower case with separators removed, so DeLuxe, de-luxe and deLuxe all read as deluxe. */
export function plainEditionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function productEditionKind(name: string): EditionKind | null {
  const n = plainEditionName(name);
  if (!n || n.endsWith("txt") || n.endsWith("psd")) return null;
  if (isTemplateOrFontFolder(name)) return null;
  if (n.includes("deluxe")) return "deluxe";
  // A PDF partial-foil map is still partial foil. Map/template/font come after that.
  if (n.includes("partialfoil")) return "partial_foil";
  if (n.includes("map") || n.includes("template") || n.includes("font")) return null;
  if (isStandardEditionFolder(name)) return "standard";
  return null;
}

/** Words that mark a paid edition however they're spelled: Deluxe, DLX, Partial Foil, PF, Premium. */
const PAID_WORDS = /foil|delux|dlx|pf|premium/;

/**
 * A folder name that may be a paid edition, for the public-root guard: productEditionKind's Deluxe or
 * Partial Foil, any of foil / delux / dlx / pf / premium anywhere (case-insensitive, with or without
 * separators: "DLX Edition", "P.F.", "Deluxe PSD"), or any non-ASCII letter (a Cyrillic е in "Dеluxe"
 * reads as plain letters to the eye but not to a word match).
 */
export function looksLikePaidName(name: string): boolean {
  for (const char of name) if (char.charCodeAt(0) > 0x7f && /\p{L}/u.test(char)) return true;
  const lower = name.normalize("NFKC").toLowerCase();
  if (PAID_WORDS.test(lower) || PAID_WORDS.test(lower.replace(/[^a-z0-9]+/g, ""))) return true;
  const kind = productEditionKind(name);
  return kind === "deluxe" || kind === "partial_foil";
}

/** "Standard Edition" and "1_P5 Standard Edition", not "Standard Bearer" or "Substandard". */
export function isStandardEditionFolder(name: string): boolean {
  const spaced = name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\bnon\s*standard\b/.test(spaced)) return false;
  if (/\bstandard\s+edition\b/.test(spaced)) return true;
  const bare = spaced.replace(/\([^)]*\)/g, " ").replace(/\b\d{3,4}\b/g, " ").replace(/^\d+(?:\.\d+)?\s+/, "").replace(/\s+/g, " ").trim();
  return bare === "standard";
}

/** "Templates", "Fonts", and "Partial Foil Templates". Not "Font of Mythos" or "Subtemplate". */
export function isTemplateOrFontFolder(name: string): boolean {
  const spaced = name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:partial foil\s+)?(?:templates?|fonts?)$/.test(spaced);
}

/** Partial foil is decided only from this folder's own name, never from a child map. */
export function folderIsPartialFoil(name: string): boolean {
  return productEditionKind(name) === "partial_foil";
}

function printTypeFor(kind: EditionKind): PrintType {
  return kind === "partial_foil" ? "partial_foil" : "standard";
}

function editionIdFor(kind: EditionKind): string {
  if (kind === "partial_foil") return "partial-foil";
  if (kind === "deluxe") return "deluxe";
  return "standard";
}

function editionLabel(kind: EditionKind): string {
  if (kind === "partial_foil") return "Partial Foil";
  if (kind === "deluxe") return "Deluxe";
  return "Standard";
}

function imagesOf(node: RawNode): RawNode[] {
  return (node.children ?? []).filter((child) => !child.folder && isPrintImage(child.name));
}

function foldersOf(node: RawNode): RawNode[] {
  return (node.children ?? []).filter((child) => child.folder);
}

function isOtherEdition(name: string): boolean {
  const kind = productEditionKind(name);
  return kind === "deluxe" || kind === "standard";
}

function isUtilityFolder(name: string): boolean {
  return isTemplateOrFontFolder(name);
}

function deluxeEditionId(folderName: string): string {
  const base = slug(folderName) || "deluxe";
  return base.includes("deluxe") ? base : `deluxe-${base}`;
}

function deluxeLabel(folderName: string): string {
  const name = folderName.trim();
  return name ? `Deluxe · ${name}` : "Deluxe";
}

/** Next id for `base`, skipping any id already present in `taken`. */
export function claimEditionId(base: string, taken: Set<string>, plain: boolean): string {
  if (plain && !taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Deluxe folders used to share the id "deluxe", so two of them collapsed and
 * the survivor depended on paste order. The id comes from the folder name.
 * When two folders slug the same, the one with the lower folder id keeps that
 * slug and the rest get -2, -3, in folder-id order. A slug that is already
 * taken, including by a folder named "Deluxe Edition 2", is skipped.
 */
function assignEditionIds(items: { folder: RawNode; edition: Edition }[]): Edition[] {
  const planned = items.map((item) => ({
    ...item,
    deluxe: productEditionKind(item.folder.name) === "deluxe",
    base: productEditionKind(item.folder.name) === "deluxe" ? deluxeEditionId(item.folder.name) : item.edition.id,
  }));
  const taken = new Set(planned.filter((item) => !item.deluxe).map((item) => item.edition.id));
  const deluxe = planned.filter((item) => item.deluxe);
  const totals = new Map<string, number>();
  for (const item of deluxe) totals.set(item.base, (totals.get(item.base) ?? 0) + 1);
  const byFolder = (a: (typeof deluxe)[number], b: (typeof deluxe)[number]) => a.base.localeCompare(b.base) || a.folder.id.localeCompare(b.folder.id);
  const idFor = new Map<RawNode, string>();
  for (const item of deluxe.filter((entry) => (totals.get(entry.base) ?? 1) === 1).sort(byFolder)) {
    idFor.set(item.folder, claimEditionId(item.base, taken, true));
  }
  let previous = "";
  for (const item of deluxe.filter((entry) => (totals.get(entry.base) ?? 1) > 1).sort(byFolder)) {
    const firstOfGroup = item.base !== previous;
    previous = item.base;
    idFor.set(item.folder, claimEditionId(item.base, taken, firstOfGroup));
  }
  const labels = distinctDeluxeLabels(deluxe);
  return planned.map((item) => {
    const id = idFor.get(item.folder);
    const name = labels.get(item.folder);
    return id && name ? { ...item.edition, id, name } : item.edition;
  });
}

/** Same-named Deluxe folders in one pack need different labels. Number them by folder id. */
function distinctDeluxeLabels(items: { folder: RawNode }[]): Map<RawNode, string> {
  const baseCount = new Map<string, number>();
  for (const item of items) {
    const label = deluxeLabel(item.folder.name);
    baseCount.set(label, (baseCount.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<RawNode, string>();
  const ordered = [...items].sort((a, b) => a.folder.id.localeCompare(b.folder.id));
  for (const item of ordered) {
    const label = deluxeLabel(item.folder.name);
    if ((baseCount.get(label) ?? 1) === 1) {
      labels.set(item.folder, label);
      continue;
    }
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    labels.set(item.folder, `${label} (${n})`);
  }
  return labels;
}

function findDescendantFolders(node: RawNode, pred: (name: string) => boolean, path: string[] = [], skipOtherEditions = false): RawNode[] {
  const here = [...path, node.name];
  const found: RawNode[] = [];
  for (const child of foldersOf(node)) {
    if (isUtilityFolder(child.name)) continue;
    if (skipOtherEditions && isOtherEdition(child.name)) continue;
    if (pred(child.name)) found.push(child);
    found.push(...findDescendantFolders(child, pred, here, skipOtherEditions));
  }
  return found;
}

function containsFolder(node: RawNode, key: string): boolean {
  if (node.folder && normalizeKey(node.name) === key) return true;
  return foldersOf(node).some((child) => containsFolder(child, key));
}

function countImages(node: RawNode): number {
  let n = imagesOf(node).length;
  for (const child of foldersOf(node)) n += countImages(child);
  return n;
}

function artFrom(file: RawNode, parsed: ParsedName, thumbs?: Map<string, string>): ArtFile {
  const thumbId =
    thumbs?.get(parsed.key) ||
    thumbs?.get(parsed.keyWithVariant) ||
    thumbs?.get(parsed.cardNameKey) ||
    file.id;
  return {
    id: file.id,
    name: file.name,
    thumbId,
    label: parsed.stem,
  };
}

function sortArts(arts: ArtFile[]): ArtFile[] {
  return [...arts].sort((a, b) => naturalCompare(a.label, b.label));
}

function preferPdf(files: RawNode[]): RawNode[] {
  const groups = new Map<string, RawNode[]>();
  for (const file of files) {
    const key = normalizeKey(stripExt(file.name));
    const list = groups.get(key) ?? [];
    list.push(file);
    groups.set(key, list);
  }
  const picked: RawNode[] = [];
  for (const list of groups.values()) {
    picked.push(list.find((file) => /\.pdf$/i.test(file.name)) ?? list[0]!);
  }
  return picked;
}

let idCounter = 0;
function uniqueId(base: string, used: Set<string>): string {
  let id = base || `card-${++idCounter}`;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function makeFace(cardId: string, which: "front" | "back", name: string, parsed: ParsedName, files: { node: RawNode; parsed: ParsedName }[], thumbs?: Map<string, string>): FaceDraft {
  const sorted = [...files].sort((a, b) => naturalCompare(a.node.name, b.node.name));
  const [first, ...rest] = sorted;
  return {
    id: `${cardId}:${which}`,
    name,
    parsed,
    defaultArt: first ? artFrom(first.node, first.parsed, thumbs) : null,
    alternates: sortArts(rest.map((item) => artFrom(item.node, item.parsed, thumbs))),
  };
}

function toDeckCard(draft: CardDraft): DeckCard {
  return {
    id: draft.id,
    name: draft.name,
    role: draft.role,
    defaultQty: draft.defaultQty,
    ...(draft.bwOnly ? { bwOnly: true } : {}),
    faces: draft.faces.map((face) => ({
      id: face.id,
      name: face.name,
      defaultArt: face.defaultArt,
      alternates: face.alternates,
    })),
  };
}

type Indexed = { card: CardDraft; face: FaceDraft; score: number; via: "exact" | "prefix" | "short" | "cardname"; keyLen: number };

function consider(hits: Indexed[], card: CardDraft, face: FaceDraft, score: number, via: Indexed["via"], keyLen: number) {
  if (!hits.some((hit) => hit.card === card && hit.score === score && hit.keyLen === keyLen)) {
    hits.push({ card, face, score, via, keyLen });
  }
}

function bestCard(hits: Indexed[]): { card: CardDraft; score: number; via: Indexed["via"] } | { ambiguous: true } | null {
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score || b.keyLen - a.keyLen);
  const top = hits[0]!;
  const best = hits.filter((hit) => hit.score === top.score && hit.keyLen === top.keyLen);
  const cards = [...new Set(best.map((hit) => hit.card))];
  if (cards.length > 1) return { ambiguous: true };
  return { card: cards[0]!, score: top.score, via: top.via };
}

function matchFolder(folderName: string, cards: CardDraft[]): ReturnType<typeof bestCard> {
  const folderKey = normalizeKey(folderName);
  if (!folderKey) return null;
  const hits: Indexed[] = [];
  for (const card of cards) {
    for (const face of card.faces) {
      const key = face.parsed.key;
      const cardName = face.parsed.cardNameKey;
      if (!key) continue;
      if (folderKey === key) consider(hits, card, face, 100, "exact", key.length);
      else if (folderKey.startsWith(`${key} `)) consider(hits, card, face, 80, "prefix", key.length);
      else if (key.startsWith(`${folderKey} `) && folderKey === cardName) consider(hits, card, face, 70, "short", folderKey.length);
      else if (folderKey === cardName && cardName !== key) consider(hits, card, face, 60, "cardname", cardName.length);
    }
  }
  return bestCard(hits);
}

function matchFile(parsed: ParsedName, cards: CardDraft[]): { card: CardDraft; face: FaceDraft } | { ambiguous: true } | null {
  if (parsed.facePair && parsed.face) {
    const faced: { card: CardDraft; face: FaceDraft }[] = [];
    for (const card of cards) {
      for (const face of card.faces) {
        if (face.parsed.facePair === parsed.facePair && face.parsed.face === parsed.face) faced.push({ card, face });
      }
    }
    const unique = [...new Set(faced.map((hit) => hit.card))];
    if (unique.length === 1) return faced[0]!;
    if (unique.length > 1) return { ambiguous: true };
  }
  const hits: Indexed[] = [];
  for (const card of cards) {
    for (const face of card.faces) {
      if (parsed.key && parsed.key === face.parsed.key) consider(hits, card, face, 100, "exact", parsed.key.length);
      else if (parsed.cardNameKey && parsed.cardNameKey === face.parsed.key) consider(hits, card, face, 90, "exact", parsed.cardNameKey.length);
      else if (parsed.key && parsed.key === face.parsed.cardNameKey && face.parsed.cardNameKey !== face.parsed.key) {
        consider(hits, card, face, 60, "cardname", parsed.key.length);
      }
    }
  }
  const best = bestCard(hits);
  if (!best || "ambiguous" in best) return best;
  const face = best.card.faces.find((item) => item.parsed.key === parsed.key || item.parsed.cardNameKey === parsed.key || item.parsed.key === parsed.cardNameKey) ?? best.card.faces[0]!;
  return { card: best.card, face };
}

/** Insertions, deletions, substitutions, and adjacent transpositions. Used for one-letter typos like Locthwain / Lochtwain. */
function damerau(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

function fileBelongs(parsed: ParsedName, card: CardDraft): boolean {
  return card.faces.some((face) => {
    if (parsed.facePair != null && parsed.facePair === face.parsed.facePair && parsed.face === face.parsed.face) return true;
    if (!parsed.key || !face.parsed.key) return false;
    if (parsed.key === face.parsed.key || parsed.cardNameKey === face.parsed.key || parsed.key === face.parsed.cardNameKey) return true;
    if (parsed.key.startsWith(`${face.parsed.key} `) || face.parsed.key.startsWith(`${parsed.key} `)) return true;
    // Same card, different parenthetical: "Unsettled Mariner (Seth)" beside "(Crust King Khann)".
    if (parsed.cardNameKey.length >= 8 && parsed.cardNameKey === face.parsed.cardNameKey) return true;
    // A one- or two-character typo in an otherwise identical name.
    if (parsed.key.length >= 18 && face.parsed.key.length >= 18 && damerau(parsed.key, face.parsed.key) <= 2) return true;
    return false;
  });
}

function addAlternate(face: FaceDraft, file: RawNode, parsed: ParsedName, thumbs?: Map<string, string>) {
  if (face.defaultArt?.id === file.id || face.alternates.some((art) => art.id === file.id)) return;
  face.alternates = sortArts([...face.alternates, artFrom(file, parsed, thumbs)]);
}

function attachToCard(card: CardDraft, file: RawNode, folderName: string | null, thumbs?: Map<string, string>) {
  const parsed = withFolderVariant(parsePrintName(file.name), folderName);
  let face: FaceDraft | undefined;
  if (parsed.face) {
    face = card.faces.find((item) => item.parsed.face === parsed.face && (parsed.facePair == null || item.parsed.facePair === parsed.facePair));
  }
  if (!face) {
    face = card.faces.find((item) => item.parsed.key === parsed.key || item.parsed.cardNameKey === parsed.key || item.parsed.key === parsed.cardNameKey);
  }
  addAlternate(face ?? card.faces[0]!, file, parsed, thumbs);
}

type Interpreted = { node: RawNode; parsed: ParsedName };

/** Use a trailing " 2" as the variant when that base is a card we already know. */
function candidateParsed(filename: string, folderName: string | null, mains: CardDraft[]): ParsedName {
  const fromFolder = withFolderVariant(parsePrintName(filename), folderName);
  if (fromFolder.variant) return fromFolder;
  const base = fromFolder.stem.replace(/\s+\d+$/, "").trim();
  if (!base || base === fromFolder.stem) return fromFolder;
  const stripped = withFolderVariant(parsePrintName(filename), base);
  if (!stripped.variant) return fromFolder;
  const hit = matchFile(stripped, mains);
  return hit && "card" in hit ? stripped : fromFolder;
}

function interpretFiles(files: RawNode[], folderName: string | null): Interpreted[] {
  let parsed = files.map((node) => ({ node, parsed: withFolderVariant(parsePrintName(node.name), folderName) }));
  const numbered = files.every((file) => /\s\d+$/.test(stripExt(file.name)));
  if (numbered && files.length >= 1) {
    const bases = files.map((file) => normalizeKey(stripExt(repairApostrophes(file.name)).replace(/\s+\d+$/, "")));
    if (new Set(bases).size === 1) {
      const baseName = stripExt(repairApostrophes(files[0]!.name)).replace(/\s+\d+$/, "").trim();
      parsed = files.map((node) => ({ node, parsed: withFolderVariant(parsePrintName(node.name), baseName) }));
    }
  }
  return parsed;
}

function displayFolderName(folderName: string | null, base: string, onlyGroup: boolean): string {
  if (onlyGroup && folderName && !GENERIC_FOLDER.test(folderName.trim())) return repairApostrophes(folderName.trim());
  return base;
}

function cardsFromFiles(items: Interpreted[], role: CardRole, folderName: string | null, used: Set<string>, thumbs?: Map<string, string>): CardDraft[] {
  const paired = new Map<string, Interpreted[]>();
  const plain: Interpreted[] = [];
  for (const item of items) {
    if (item.parsed.facePair && item.parsed.face) {
      const list = paired.get(item.parsed.facePair) ?? [];
      list.push(item);
      paired.set(item.parsed.facePair, list);
    } else plain.push(item);
  }
  const drafts: CardDraft[] = [];
  for (const [pair, list] of paired) {
    const front = list.filter((item) => item.parsed.face === 1);
    const back = list.filter((item) => item.parsed.face === 2);
    if (front.length && back.length) {
      const frontName = front[0]!.parsed.base;
      const backName = back[0]!.parsed.base;
      const name = `${frontName} // ${backName}`;
      const id = uniqueId(`${role}-${pair}-${slug(frontName)}`, used);
      drafts.push({
        id,
        name,
        role,
        defaultQty: role === "main" ? 1 : 0,
        faces: [
          makeFace(id, "front", frontName, front[0]!.parsed, front, thumbs),
          makeFace(id, "back", backName, back[0]!.parsed, back, thumbs),
        ],
      });
    } else plain.push(...list);
  }
  const byKey = new Map<string, Interpreted[]>();
  for (const item of plain) {
    const key = item.parsed.key || item.node.id;
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }
  const onlyGroup = drafts.length === 0 && byKey.size === 1;
  for (const list of byKey.values()) {
    const base = list[0]!.parsed.base;
    const name = displayFolderName(folderName, base, onlyGroup);
    const id = uniqueId(`${role}-${slug(name)}`, used);
    drafts.push({
      id,
      name,
      role,
      defaultQty: role === "main" ? 1 : 0,
      faces: [makeFace(id, "front", name, { ...list[0]!.parsed, base: name, key: normalizeKey(name) }, list, thumbs)],
    });
  }
  return drafts;
}

function note(notes: CatalogueNote[], level: CatalogueNote["level"], name: string, path: string, reason: string) {
  notes.push({ level, name, path, reason });
}

function absorbLoose(file: RawNode, cards: CardDraft[], role: CardRole, path: string, notes: CatalogueNote[], used: Set<string>, thumbs?: Map<string, string>) {
  const parsed = parsePrintName(file.name);
  if (role === "token") {
    const existing = cards.find((card) => card.role === "token" && card.faces.some((face) => face.parsed.key === parsed.key));
    if (existing) {
      addAlternate(existing.faces[0]!, file, parsed, thumbs);
      return;
    }
  }
  const pool = cards.filter((card) => card.role === "main" || card.role === "extra");
  const hit = role === "token" ? null : matchFile(parsed, pool.filter((card) => card.role === "main"));
  if (hit && "ambiguous" in hit) {
    note(notes, "ambiguous", file.name, path, "This file name matches more than one card, so it was kept as its own extra.");
  } else if (hit && "card" in hit) {
    addAlternate(hit.face, file, parsed, thumbs);
    return;
  }
  cards.push(...cardsFromFiles([{ node: file, parsed }], role, null, used, thumbs));
}

function absorbFolder(folder: RawNode, path: string, cards: CardDraft[], role: CardRole, notes: CatalogueNote[], used: Set<string>, thumbs?: Map<string, string>) {
  for (const child of foldersOf(folder)) absorbFolder(child, `${path}/${child.name}`, cards, role, notes, used, thumbs);
  const files = imagesOf(folder);
  for (const child of folder.children ?? []) {
    if (!child.folder && !isPrintImage(child.name) && !/^new drive link\.txt$/i.test(child.name)) {
      note(notes, "skipped", child.name, `${path}/${child.name}`, "Not a print image, so it was left out.");
    }
  }
  if (!files.length) return;
  const pool = cards.filter((card) => card.role === "main");
  if (role !== "token") {
    const folderHit = matchFolder(folder.name, pool);
    if (folderHit && "card" in folderHit) {
      const leftovers: RawNode[] = [];
      const looseNames: string[] = [];
      for (const file of files) {
        const parsed = candidateParsed(file.name, folder.name, pool);
        const exact = folderHit.card.faces.some((face) => face.parsed.key === parsed.key);
        if (fileBelongs(parsed, folderHit.card)) {
          if (!exact) looseNames.push(file.name);
          attachToCard(folderHit.card, file, folder.name, thumbs);
        } else leftovers.push(file);
      }
      if (looseNames.length) {
        note(notes, "info", folder.name, path, `Kept ${looseNames.length} alternate(s) whose file names don't match the deck file exactly: ${looseNames.join(", ")}.`);
      }
      if (folderHit.via !== "exact") {
        note(notes, "info", folder.name, path, `Alternate folder matched “${folderHit.card.name}” by ${folderHit.via === "prefix" ? "a longer folder name" : "a shorter folder name"}.`);
      }
      if (leftovers.length) {
        const created = cardsFromFiles(interpretFiles(leftovers, folder.name), "extra", null, used, thumbs);
        cards.push(...created);
        note(notes, "ambiguous", folder.name, path, `${leftovers.length} file(s) in this folder did not match “${folderHit.card.name}” and were listed separately.`);
      }
      return;
    }
    if (folderHit && "ambiguous" in folderHit) {
      note(notes, "ambiguous", folder.name, path, "Folder name matches more than one card. Files were matched one by one.");
    }
    const leftovers: RawNode[] = [];
    for (const file of files) {
      const parsed = candidateParsed(file.name, folder.name, pool);
      const hit = matchFile(parsed, pool);
      if (hit && "card" in hit) addAlternate(hit.face, file, parsed, thumbs);
      else if (hit && "ambiguous" in hit) {
        note(notes, "ambiguous", file.name, `${path}/${file.name}`, "Matches more than one card, so it was not merged.");
        leftovers.push(file);
      } else leftovers.push(file);
    }
    if (leftovers.length) {
      const created = cardsFromFiles(interpretFiles(leftovers, folder.name), role, folder.name, used, thumbs);
      cards.push(...created);
      if (created.length > 1) {
        note(
          notes,
          "ambiguous",
          folder.name,
          path,
          `This folder is a group of ${created.length} cards that are not in the main deck (${created.map((card) => card.name).join("; ")}). They were listed as extras.`,
        );
      }
    }
    return;
  }
  const nameFromFile = /^colou?r$/i.test(spacedName(folder.name));
  const interpreted = nameFromFile
    ? files.map((node) => ({ node, parsed: parsePrintName(node.name) }))
    : interpretFiles(files, folder.name);
  const fresh: Interpreted[] = [];
  for (const item of interpreted) {
    const key = item.parsed.key;
    const existing = cards.find((card) => card.role === "token" && card.faces.some((face) => face.parsed.key === key));
    if (existing) addAlternate(existing.faces[0]!, item.node, item.parsed, thumbs);
    else fresh.push(item);
  }
  const tokenLabel = nameFromFile ? null : folder.name;
  const created = cardsFromFiles(fresh, "token", tokenLabel, used, thumbs);
  cards.push(...created);
  if (created.length > 1) {
    note(notes, "ambiguous", folder.name, path, `Token folder contains ${created.length} different cards (${created.map((card) => card.name).join("; ")}).`);
  }
}

function pairMainFiles(files: RawNode[], used: Set<string>, thumbs?: Map<string, string>): CardDraft[] {
  const items = files.map((node) => ({ node, parsed: parsePrintName(node.name) }));
  const byPair = new Map<string, Interpreted[]>();
  for (const item of items) {
    if (item.parsed.facePair && item.parsed.face) {
      const list = byPair.get(item.parsed.facePair) ?? [];
      list.push(item);
      byPair.set(item.parsed.facePair, list);
    }
  }
  const ordered: CardDraft[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    if (item.parsed.facePair && item.parsed.face) {
      if (emitted.has(item.parsed.facePair)) continue;
      const list = byPair.get(item.parsed.facePair) ?? [];
      const front = list.filter((entry) => entry.parsed.face === 1);
      const back = list.filter((entry) => entry.parsed.face === 2);
      if (front.length && back.length) {
        const frontName = front[0]!.parsed.base;
        const backName = back[0]!.parsed.base;
        const name = `${frontName} // ${backName}`;
        const id = uniqueId(`main-${item.parsed.facePair}-${slug(frontName)}`, used);
        ordered.push({
          id,
          name,
          role: "main",
          defaultQty: 1,
          faces: [
            makeFace(id, "front", frontName, front[0]!.parsed, front, thumbs),
            makeFace(id, "back", backName, back[0]!.parsed, back, thumbs),
          ],
        });
        emitted.add(item.parsed.facePair);
        continue;
      }
    }
    const name = item.parsed.base;
    const id = uniqueId(`main-${slug(name)}`, used);
    ordered.push({
      id,
      name,
      role: "main",
      defaultQty: 1,
      faces: [makeFace(id, "front", name, item.parsed, [item], thumbs)],
    });
  }
  // pairMainFiles walks items and may push a pair when seeing face 1, then skip face 2.
  // Face-2-only items fall through the continue and would be duplicated if the pair was emitted.
  return ordered.filter((card, index) => ordered.findIndex((other) => other.id === card.id) === index);
}

function childFolder(node: RawNode, key: string): RawNode | undefined {
  return foldersOf(node).find((child) => normalizeKey(child.name) === key);
}

function collectBacks(nodes: RawNode[]): CardBack[] {
  const backs: CardBack[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    backs.push({ id: node.id, name: stripExt(node.name), thumbId: node.id });
  }
  return backs.sort((a, b) => naturalCompare(a.name, b.name));
}

function filesInsideStandardEdition(root: RawNode): { id: string; name: string }[] {
  const found: { id: string; name: string }[] = [];
  const visit = (folder: RawNode, inside: boolean) => {
    const here = inside || isStandardEditionFolder(folder.name);
    if (here) {
      for (const file of folder.children ?? []) {
        if (!file.folder && isPrintImage(file.name)) found.push({ id: file.id, name: file.name });
      }
    }
    for (const child of foldersOf(folder)) visit(child, here);
  };
  for (const child of foldersOf(root)) visit(child, false);
  return found;
}

function finishEdition(kind: EditionKind, cards: CardDraft[], backs: CardBack[], notes: CatalogueNote[], sourceFiles: { id: string; name: string }[] = []): Edition {
  const order: CardRole[] = ["main", "token", "extra"];
  const sorted = [...cards].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const paired = pairLooseFaces(sorted.map(toDeckCard));
  return {
    id: editionIdFor(kind),
    name: editionLabel(kind),
    printType: printTypeFor(kind),
    cards: paired.cards,
    backs,
    notes: paired.notes.length ? [...notes, ...paired.notes] : notes,
    ...(sourceFiles.length ? { sourceFiles } : {}),
  };
}

export function isFullDeckFolderName(name: string): boolean {
  const key = normalizeKey(name);
  return key === "full deck" || key.startsWith("full deck ");
}

export function isCompleteCollectionName(name: string): boolean {
  return normalizeKey(name) === "complete collection";
}

function findFullDeck(root: RawNode): RawNode | null {
  const found = findDescendantFolders(root, isFullDeckFolderName, [], true);
  const pool = found.length ? found : findDescendantFolders(root, isCompleteCollectionName, [], true);
  if (!pool.length) return null;
  pool.sort((a, b) => countImages(b) - countImages(a));
  return pool[0] ?? null;
}

function dedupeFileIds(node: RawNode, seen = new Set<string>()): RawNode {
  const children: RawNode[] = [];
  for (const child of node.children ?? []) {
    if (child.folder) children.push(dedupeFileIds(child, seen));
    else if (!seen.has(child.id)) {
      seen.add(child.id);
      children.push(child);
    }
  }
  return { ...node, children };
}

function matchExact(parsed: ParsedName, cards: CardDraft[]): { card: CardDraft; face: FaceDraft } | null {
  for (const card of cards) {
    for (const face of card.faces) {
      if (face.parsed.key && face.parsed.key === parsed.key) return { card, face };
      for (const art of [face.defaultArt, ...face.alternates]) {
        if (art && parsePrintName(art.name).key === parsed.key) return { card, face };
      }
    }
  }
  return null;
}

function basicType(filename: string): string | null {
  const stem = stripExt(filename).replace(/\s+\d+$/, "").replace(/^basic\s+/i, "").trim();
  const key = normalizeKey(stem);
  if (/^(snow covered )?(plains|island|swamp|mountain|forest|wastes)$/.test(key)) return key;
  return null;
}

function spacedName(name: string): string {
  return name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isPrintVariantName(name: string): boolean {
  const spaced = spacedName(name);
  return spaced === "color" || spaced === "colour" || spaced === "black and white" || spaced === "black & white";
}

function isBasicLandsName(name: string): boolean {
  const spaced = spacedName(name);
  return spaced === "basic lands" || spaced === "basic land" || spaced === "basics";
}

function isCardImageName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

/** A flat folder of card images, such as a 10-card Secret Lair, with no Full Deck. */
function smallImageDeck(root: RawNode): RawNode[] | null {
  if (foldersOf(root).some((folder) => !isUtilityFolder(folder.name))) return null;
  const files = (root.children ?? []).filter((child) => !child.folder);
  const images = files.filter((file) => isCardImageName(file.name));
  const others = files.filter((file) => !isCardImageName(file.name) && !/^readme(\b|\.)/i.test(file.name));
  if (!images.length || others.length) return null;
  return images;
}

function findPrintVariants(full: RawNode): RawNode[] {
  const direct = foldersOf(full).filter((folder) => isPrintVariantName(folder.name));
  if (direct.length) return direct;
  for (const child of foldersOf(full)) {
    if (isUtilityFolder(child.name) || isBasicLandsName(child.name)) continue;
    const key = normalizeKey(child.name);
    if (key === "tokens" || key === "card back" || key === "card backs" || key === "backs" || key === "extras") continue;
    const inner = foldersOf(child).filter((folder) => isPrintVariantName(folder.name));
    if (inner.length) return inner;
  }
  return [];
}

function colorVariant(variants: RawNode[]): RawNode | undefined {
  return variants.find((folder) => /^colou?r$/i.test(spacedName(folder.name)));
}

function partialPrintFolder(root: RawNode, which: "color" | "mono"): RawNode | undefined {
  return foldersOf(root).find((folder) => {
    const spaced = spacedName(folder.name);
    if (which === "color") return spaced === "color" || spaced === "colour" || spaced.startsWith("color ") || spaced.startsWith("colour ");
    return spaced === "black and white" || spaced.startsWith("black and white ");
  });
}

function addBlackAndWhite(files: RawNode[], cards: CardDraft[], used: Set<string>, notes: CatalogueNote[], unmatched: CardRole = "main") {
  const fresh: RawNode[] = [];
  for (const file of files) {
    if (!isPrintImage(file.name)) continue;
    const parsed = parsePrintName(file.name);
    const hit = matchExact(parsed, cards);
    if (hit) addAlternate(hit.face, file, parsed);
    else {
      fresh.push(file);
      note(notes, "info", parsed.stem, "Black and White", `No card is named exactly “${parsed.stem}”, so this file was kept as its own card.`);
    }
  }
  if (!fresh.length) return;
  const made = pairMainFiles(fresh, used).map((card) => ({
    ...card,
    role: unmatched,
    defaultQty: unmatched === "main" ? 1 : 0,
    bwOnly: true,
  }));
  cards.push(...made);
}

function addMainOrAlternate(files: RawNode[], cards: CardDraft[], used: Set<string>) {
  const fresh: RawNode[] = [];
  for (const file of files) {
    if (!isPrintImage(file.name)) continue;
    const parsed = parsePrintName(file.name);
    const hit = matchFile(parsed, cards);
    if (hit && "card" in hit) addAlternate(hit.face, file, parsed);
    else fresh.push(file);
  }
  if (fresh.length) cards.push(...pairMainFiles(fresh, used));
}

export function groupStandardEdition(rootIn: RawNode, kind: EditionKind = "standard"): Edition {
  const notes: CatalogueNote[] = [];
  const used = new Set<string>();
  const root = dedupeFileIds(rootIn);
  let full = findFullDeck(root);
  if (!full) {
    const loose = imagesOf(root).filter((file) => isCardImageName(file.name) && !/^card back\b/i.test(stripExt(file.name)));
    const images = smallImageDeck(root);
    const junk = (root.children ?? []).filter((child) => !child.folder && !isCardImageName(child.name) && !/^readme(\b|\.)/i.test(child.name));
    if (images) {
      note(notes, "info", root.name, root.name, "No Full Deck folder. Every file is a card image, so this small set is the main deck.");
      return finishEdition(kind, pairMainFiles(images, used), [], notes);
    }
    if (junk.length && foldersOf(root).every((folder) => isUtilityFolder(folder.name))) {
      note(notes, "ambiguous", root.name, root.name, "No Full Deck folder was found, so no main deck could be built.");
      return finishEdition(kind, [], [], notes);
    }
    if (loose.length) {
      note(notes, "info", root.name, root.name, "No Full Deck folder. The loose card images in this edition are the deck.");
      full = root;
    } else {
      note(notes, "ambiguous", root.name, root.name, "No Full Deck folder was found, so no main deck could be built.");
      return finishEdition(kind, [], [], notes);
    }
  }
  const backFolder = childFolder(full, "card back") ?? childFolder(full, "card backs") ?? childFolder(full, "backs");
  const tokenFolder = childFolder(full, "tokens");
  const backFiles = [
    ...(backFolder ? imagesDeep(backFolder) : []),
    ...imagesOf(full).filter((file) => /^card back\b/i.test(stripExt(file.name))),
  ];
  const mainFiles = imagesOf(full).filter((file) => !/^card back\b/i.test(stripExt(file.name)));
  const cards = pairMainFiles(mainFiles, used);
  const variants = findPrintVariants(full);
  const color = colorVariant(variants);
  const looseImages = mainFiles.filter((file) => isCardImageName(file.name));
  const primary = color ?? (looseImages.length ? undefined : variants[0]);
  const primaryBasics = primary ? foldersOf(primary).filter((folder) => isBasicLandsName(folder.name)) : [];
  const ownBasics = foldersOf(full).filter((folder) => isBasicLandsName(folder.name));
  addMainOrAlternate(
    [...(primary ? imagesOf(primary) : []), ...ownBasics.flatMap((folder) => imagesDeep(folder)), ...primaryBasics.flatMap((folder) => imagesDeep(folder))],
    cards,
    used,
  );
  for (const alt of variants) {
    if (alt === primary) continue;
    const altBasics = foldersOf(alt).filter((folder) => isBasicLandsName(folder.name));
    addMainOrAlternate([...imagesOf(alt), ...altBasics.flatMap((folder) => imagesDeep(folder))], cards, used);
  }
  const optional = foldersOf(full).find((folder) => normalizeKey(folder.name) === "optional");
  if (optional) {
    note(notes, "info", optional.name, optional.name, "Optional print variants were left out of the main deck.");
  }
  if (tokenFolder) {
    const tokenChildren = foldersOf(tokenFolder).slice().sort((a, b) => Number(/^colou?r$/i.test(spacedName(b.name))) - Number(/^colou?r$/i.test(spacedName(a.name))));
    for (const child of tokenChildren) absorbFolder(child, `Tokens/${child.name}`, cards, "token", notes, used);
    for (const file of imagesOf(tokenFolder)) absorbLoose(file, cards, "token", `Tokens/${file.name}`, notes, used);
  }
  const extras = findDescendantFolders(root, (name) => normalizeKey(name) === "extras", [], true).filter((folder) => folder !== tokenFolder && !isInside(folder, tokenFolder) && !isInside(folder, backFolder));
  extras.sort((a, b) => countImages(b) - countImages(a));
  const extraRoot = extras[0];
  if (extraRoot) {
    for (const child of foldersOf(extraRoot)) absorbFolder(child, `Extras/${child.name}`, cards, "extra", notes, used);
    for (const file of imagesOf(extraRoot)) absorbLoose(file, cards, "extra", `Extras/${file.name}`, notes, used);
  }
  if (kind === "deluxe") absorbDeluxeAlt(full, cards, used);
  markTones(cards, variants, primary, tokenFolder);
  const sourceFiles = kind === "deluxe" ? filesInsideStandardEdition(root) : [];
  return finishEdition(kind, cards, collectBacks(backFiles), notes, sourceFiles);
}

function isBlackAndWhiteName(name: string): boolean {
  const spaced = spacedName(name);
  return spaced === "black and white" || spaced === "black & white";
}

/**
 * SxF ships every option card in a Color folder and a Black and White folder.
 * Each file is tagged with the folder it came from, so the builder can switch
 * the whole deck between the two. Nothing is tagged unless both folders exist.
 */
function markTones(cards: CardDraft[], variants: RawNode[], primary: RawNode | undefined, tokenFolder: RawNode | undefined) {
  const tone = new Map<string, ArtTone>();
  const color = primary && /^colou?r$/i.test(spacedName(primary.name)) ? primary : colorVariant(variants);
  const mono = variants.filter((folder) => isBlackAndWhiteName(folder.name));
  if (!color || !mono.length) return;
  for (const file of imagesDeep(color)) tone.set(file.id, "color");
  for (const folder of mono) for (const file of imagesDeep(folder)) tone.set(file.id, "bw");
  for (const child of tokenFolder ? foldersOf(tokenFolder) : []) {
    const which: ArtTone | null = /^colou?r$/i.test(spacedName(child.name)) ? "color" : isBlackAndWhiteName(child.name) ? "bw" : null;
    if (which) for (const file of imagesDeep(child)) tone.set(file.id, which);
  }
  for (const card of cards) {
    for (const face of card.faces) {
      for (const art of [face.defaultArt, ...face.alternates]) {
        const which = art ? tone.get(art.id) : undefined;
        if (art && which) art.tone = which;
      }
    }
  }
}

/** Deluxe Alt is part of that edition. A file whose name matches a main card is another art of it. */
function absorbDeluxeAlt(full: RawNode, cards: CardDraft[], used: Set<string>) {
  const alt = foldersOf(full).find((folder) => normalizeKey(folder.name) === "alt");
  if (!alt) return;
  const visit = (folder: RawNode) => {
    if (isStandardEditionFolder(folder.name)) return;
    for (const child of foldersOf(folder)) visit(child);
    for (const file of folder.children ?? []) {
      if (file.folder || !isPrintImage(file.name)) continue;
      const parsed = parsePrintName(file.name);
      const mains = cards.filter((card) => card.role === "main");
      const hit = matchFile(parsed, mains);
      if (hit && "card" in hit) {
        addAlternate(hit.face, file, parsed);
        continue;
      }
      const belongs = mains.find((card) => fileBelongs(parsed, card));
      if (belongs) {
        const matched =
          belongs.faces.find(
            (face) =>
              face.parsed.key === parsed.key ||
              face.parsed.key === parsed.cardNameKey ||
              (parsed.key && face.parsed.key && (parsed.key.startsWith(`${face.parsed.key} `) || face.parsed.key.startsWith(`${parsed.key} `))),
          ) ?? belongs.faces[0]!;
        addAlternate(matched, file, parsed);
        continue;
      }
      const id = uniqueId(`extra-${slug(parsed.base)}`, used);
      cards.push({
        id,
        name: parsed.base,
        role: "extra",
        defaultQty: 0,
        faces: [makeFace(id, "front", parsed.base, parsed, [{ node: file, parsed }])],
      });
    }
  };
  visit(alt);
}

function isInside(node: RawNode | undefined, parent: RawNode | undefined): boolean {
  if (!node || !parent) return false;
  if (node === parent) return true;
  return foldersOf(parent).some((child) => child === node || isInside(node, child));
}

function imagesDeep(node: RawNode): RawNode[] {
  return [...imagesOf(node), ...foldersOf(node).flatMap(imagesDeep)];
}

function walkFiles(node: RawNode, path: string[] = [], skipOtherEditions = false): { node: RawNode; path: string[] }[] {
  const here = [...path, node.name];
  const out: { node: RawNode; path: string[] }[] = [];
  for (const child of node.children ?? []) {
    if (child.folder) {
      if (isUtilityFolder(child.name)) continue;
      if (skipOtherEditions && isOtherEdition(child.name)) continue;
      out.push(...walkFiles(child, here, skipOtherEditions));
    } else out.push({ node: child, path: [...here, child.name] });
  }
  return out;
}

function treeHasPdf(node: RawNode): boolean {
  if (imagesOf(node).some((file) => /\.pdf$/i.test(file.name))) return true;
  return foldersOf(node).some((child) => treeHasPdf(child));
}

function attachMonoPrints(mono: RawNode, cards: CardDraft[], used: Set<string>, notes: CatalogueNote[]) {
  const source = findDescendantFolders(mono, (name) => normalizeKey(name).startsWith("full deck"), [], true)[0] ?? mono;
  const frontFolder = childFolder(source, "front");
  const backFolder = childFolder(source, "back");
  const direct = pdfPrintFiles(imagesOf(source).filter((file) => !/^card back\b/i.test(stripExt(file.name))));
  const basics = [
    ...direct.filter((file) => basicType(file.name)),
    ...foldersOf(source).filter((folder) => isBasicLandsName(folder.name)).flatMap((folder) => pdfPrintFiles(imagesDeep(folder))),
  ];
  const prints = direct.filter((file) => !basicType(file.name));
  const tokens = prints.filter((file) => /^token\b/i.test(stripExt(file.name)));
  const rest = prints.filter((file) => !/^token\b/i.test(stripExt(file.name)));
  addBlackAndWhite(rest, cards, used, notes, "extra");
  addBlackAndWhite(tokens, cards, used, notes, "token");
  addBlackAndWhite(basics, cards, used, notes, "extra");
  const fronts = frontFolder ? pdfPrintFiles(imagesOf(frontFolder)) : [];
  const backFiles = backFolder ? preferPdf(imagesOf(backFolder)) : [];
  for (const file of fronts) {
    const parsed = parsePrintName(file.name);
    const back = parsed.facePair
      ? backFiles.find((item) => {
          const other = parsePrintName(item.name);
          return other.facePair === parsed.facePair && other.face === 2;
        })
      : backFiles.find((item) => normalizeKey(stripExt(item.name)) === normalizeKey(stripExt(file.name)));
    const hit = matchExact(parsed, cards);
    const token = /^token\b/i.test(stripExt(file.name));
    if (hit) {
      addAlternate(hit.face, file, parsed);
      if (back && hit.card.faces[1]) addAlternate(hit.card.faces[1]!, back, parsePrintName(back.name));
      continue;
    }
    const role: CardRole = token ? "token" : "extra";
    const backParsed = back ? parsePrintName(back.name) : null;
    const name = back && parsed.facePair && backParsed && backParsed.base !== parsed.base ? `${parsed.base} // ${backParsed.base}` : parsed.base;
    const id = uniqueId(`${role}-${slug(name)}`, used);
    const faces = [makeFace(id, "front", name, parsed, [{ node: file, parsed }])];
    if (back && backParsed) faces.push(makeFace(id, "back", backParsed.base, backParsed, [{ node: back, parsed: backParsed }]));
    cards.push({ id, name, role, defaultQty: 0, faces });
  }
}

export function groupPartialFoilEdition(rootIn: RawNode): Edition {
  const root = dedupeFileIds(rootIn);
  const notes: CatalogueNote[] = [];
  const used = new Set<string>();
  let pdfFolders = findDescendantFolders(root, (name) => plainEditionName(name).includes("pdf"), [], true);
  const rootPlain = plainEditionName(root.name);
  if (!pdfFolders.length && rootPlain.includes("pdf") && rootPlain.includes("partialfoil") && treeHasPdf(root)) {
    pdfFolders = [root];
  }
  const namedPartial = pdfFolders.filter((folder) => plainEditionName(folder.name).includes("partialfoil"));
  const onlyDirect = pdfFolders.length === 1 && foldersOf(root).some((child) => child === pdfFolders[0]);
  const chosen = namedPartial.length > 0 ? namedPartial : onlyDirect ? pdfFolders : [];
  if (onlyDirect && namedPartial.length === 0 && pdfFolders[0]) {
    note(
      notes,
      "info",
      pdfFolders[0].name,
      pdfFolders[0].name,
      `Using the only PDF folder “${pdfFolders[0].name}”, which sits directly under this edition.`,
    );
  }
  if (!chosen.length) {
    const onlyNested = pdfFolders.length === 1 ? pdfFolders[0] : undefined;
    note(
      notes,
      "ambiguous",
      root.name,
      root.name,
      onlyNested
        ? `The only PDF folder “${onlyNested.name}” is not directly under this edition, so no print files were used.`
        : pdfFolders.length > 1
          ? "Several PDF folders were found and none is named as partial foil, so no print files were used. The largest folder was not chosen."
          : "No PDF print files were found in this partial foil edition. Deluxe and Standard folders were not searched.",
    );
    return finishEdition("partial_foil", [], collectBacks([]), notes);
  }
  const seenPrint = new Set<string>();
  const take = (files: RawNode[]) => {
    const out: RawNode[] = [];
    for (const file of files) {
      if (seenPrint.has(file.id)) continue;
      seenPrint.add(file.id);
      out.push(file);
    }
    return out;
  };
  const loose: RawNode[] = [];
  const backFiles: RawNode[] = [];
  const faceBacks: RawNode[] = [];
  const frontFiles: RawNode[] = [];
  const extraFolders: RawNode[] = [];
  const monoFolders: RawNode[] = [];
  for (const pdfRoot of chosen) {
    const color = partialPrintFolder(pdfRoot, "color");
    const mono = partialPrintFolder(pdfRoot, "mono");
    const source = color ?? pdfRoot;
    const deckFolder = findDescendantFolders(source, (name) => normalizeKey(name).startsWith("full deck"), [], true)[0] ?? source;
    const frontFolder = childFolder(deckFolder, "front");
    const backFolder = childFolder(deckFolder, "back");
    const direct = pdfPrintFiles(imagesOf(deckFolder).filter((file) => !/^card back\b/i.test(stripExt(file.name))));
    loose.push(...take(direct));
    for (const basics of foldersOf(deckFolder).filter((folder) => isBasicLandsName(folder.name))) {
      loose.push(...take(pdfPrintFiles(imagesDeep(basics))));
    }
    frontFiles.push(...take(pdfPrintFiles(frontFolder ? imagesOf(frontFolder) : [])));
    faceBacks.push(...take(preferPdf(backFolder ? imagesOf(backFolder) : [])));
    backFiles.push(...take(imagesOf(deckFolder).filter((file) => /^card back\b/i.test(stripExt(file.name)))));
    extraFolders.push(...findDescendantFolders(pdfRoot, (name) => normalizeKey(name) === "extras", [], true));
    if (mono) monoFolders.push(mono);
  }
  const legacyMainIds = new Set<string>();
  for (const pdfRoot of chosen) {
    const legacyDeck = findDescendantFolders(pdfRoot, (name) => normalizeKey(name).startsWith("full deck"), [], true)[0] ?? pdfRoot;
    for (const file of pdfPrintFiles(imagesOf(legacyDeck).filter((file) => !/^card back\b/i.test(stripExt(file.name))))) {
      legacyMainIds.add(file.id);
    }
  }
  const cards = pairMainFiles(loose, used);
  // v0.1.13 made every loose Full Deck file a main card, including names that start with Token.
  // Files the Color map added later keep that same main-token id and open as tokens at quantity 0.
  for (const card of cards) {
    if (card.role !== "main" || !/^token\b/i.test(card.name)) continue;
    const artId = card.faces[0]?.defaultArt?.id;
    if (artId && legacyMainIds.has(artId)) continue;
    card.role = "token";
    card.defaultQty = 0;
  }

  const backByKey = new Map<string, RawNode>();
  for (const file of faceBacks) backByKey.set(normalizeKey(stripExt(file.name)), file);
  const flipNames: string[] = [];
  const tokenNames: string[] = [];
  for (const file of frontFiles.sort((a, b) => naturalCompare(a.name, b.name))) {
    const stem = stripExt(file.name);
    const parsedFront = parsePrintName(file.name);
    const key = normalizeKey(stem);
    const paired = parsedFront.facePair
      ? faceBacks.find((back) => {
          const parsed = parsePrintName(back.name);
          return parsed.facePair === parsedFront.facePair && parsed.face === 2;
        })
      : undefined;
    const back = paired ?? backByKey.get(key);
    const token = /^token\b/i.test(stem);
    const role: CardRole = token ? "token" : "main";
    const items: Interpreted[] = [{ node: file, parsed: parsedFront }];
    const backBase = back ? parsePrintName(back.name).base : "";
    const name = back && parsedFront.facePair && backBase !== parsedFront.base ? `${parsedFront.base} // ${backBase}` : repairApostrophes(stem);
    const id = uniqueId(`${role}-${slug(name)}`, used);
    const frontFace = makeFace(id, "front", name, items[0]!.parsed, items);
    const faces = [frontFace];
    if (back) {
      const backParsed = parsePrintName(back.name);
      faces.push(makeFace(id, "back", name, backParsed, [{ node: back, parsed: backParsed }]));
    }
    cards.push({ id, name, role, defaultQty: role === "main" ? 1 : 0, faces });
    if (token) tokenNames.push(name);
    else flipNames.push(name);
  }
  if (flipNames.length || tokenNames.length) {
    note(
      notes,
      "ambiguous",
      "Front / Back",
      "PDF Partial Foil Map/Full Deck/Front",
      `These print files are numbered masks rather than card titles${flipNames.length ? ` (${flipNames.join(", ")})` : ""}${tokenNames.length ? `; tokens: ${tokenNames.join(", ")}` : ""}. They could not be renamed from the preview map with confidence.`,
    );
  }

  for (const mono of monoFolders) attachMonoPrints(mono, cards, used, notes);
  for (const extraRoot of extraFolders) {
    const pdfExtras = omitSeenFiles(retainPdfFiles(extraRoot), seenPrint);
    for (const child of foldersOf(pdfExtras)) absorbFolder(child, `Extras/${child.name}`, cards, "extra", notes, used);
    for (const file of imagesOf(pdfExtras)) absorbLoose(file, cards, "extra", `Extras/${file.name}`, notes, used);
  }
  for (const file of walkFiles(root, [], true)) {
    if (!isPrintImage(file.node.name) && /\.(txt|psd|zip)$/i.test(file.node.name)) {
      note(notes, "skipped", file.node.name, file.path.slice(0, -1).join("/"), "Not a print image.");
    }
  }
  return finishEdition("partial_foil", cards, collectBacks(backFiles), notes);
}

function pdfPrintFiles(files: RawNode[]): RawNode[] {
  return preferPdf(files).filter((file) => /\.pdf$/i.test(file.name));
}

function omitSeenFiles(node: RawNode, seen: Set<string>): RawNode {
  return {
    ...node,
    children: (node.children ?? []).flatMap((child) => {
      if (child.folder) return [omitSeenFiles(child, seen)];
      if (seen.has(child.id)) return [];
      seen.add(child.id);
      return [child];
    }),
  };
}

function retainPdfFiles(node: RawNode): RawNode {
  return {
    ...node,
    children: (node.children ?? []).flatMap((child) => {
      if (child.folder) return [retainPdfFiles(child)];
      return /\.pdf$/i.test(child.name) ? [child] : [];
    }),
  };
}

function holdsCardImages(node: RawNode): number {
  const here = imagesOf(node).filter((file) => isCardImageName(file.name) || /\.pdf$/i.test(file.name)).length;
  const nested = foldersOf(node)
    .filter((child) => !isOtherEdition(child.name) && !isTemplateOrFontFolder(child.name))
    .reduce((sum, child) => sum + holdsCardImages(child), 0);
  return here + nested;
}

function withSiblingStandardFiles(edition: Edition, node: RawNode, grouped: RawNode, kind: EditionKind): Edition {
  if (kind !== "deluxe" || grouped === node) return edition;
  const seen = new Set((edition.sourceFiles ?? []).map((file) => file.id));
  const extra = filesInsideStandardEdition(node).filter((file) => !seen.has(file.id));
  return extra.length ? { ...edition, sourceFiles: [...(edition.sourceFiles ?? []), ...extra] } : edition;
}

export type CatalogueOptions = {
  /** Text of each deck list file, by Drive file id. Read during unlock. */
  decklistTexts?: ReadonlyMap<string, string>;
  /** Lists shipped with the site for the same deck, used when a folder's own list file could not be read. */
  bundledDecklists?: readonly Decklist[];
};

/**
 * Deck lists that sit directly in this edition folder, not in a subfolder.
 * A list that could not be read falls back to the shipped copy with the same
 * file name. Without either, the edition opens with its folder counts.
 */
export function decklistsInFolder(node: RawNode, options: CatalogueOptions = {}): { decklists: Decklist[]; notes: CatalogueNote[] } {
  const files = (node.children ?? []).filter((child) => !child.folder && isDecklistFile(child.name));
  const decklists: Decklist[] = [];
  const notes: CatalogueNote[] = [];
  for (const file of files) {
    const text = options.decklistTexts?.get(file.id);
    if (typeof text === "string" && text.trim()) {
      decklists.push(parseDecklist(text, file.name));
      continue;
    }
    const bundled = options.bundledDecklists?.find((list) => list.fileName.toLowerCase() === file.name.trim().toLowerCase());
    if (bundled) {
      decklists.push(bundled);
      note(notes, "info", file.name, node.name, "This list couldn't be read from Drive, so the copy shipped with BeeLine was used.");
    } else {
      note(notes, "ambiguous", file.name, node.name, "This deck list couldn't be read, so the deck opens with one of every main-folder card.");
    }
  }
  return { decklists: orderDecklists(decklists), notes };
}

function withFolderDecklists(edition: Edition, node: RawNode, options: CatalogueOptions): Edition {
  const { decklists, notes } = decklistsInFolder(node, options);
  if (!decklists.length && !notes.length) return edition;
  return { ...edition, ...(decklists.length ? { decklists } : {}), notes: [...edition.notes, ...notes] };
}

function buildEdition(node: RawNode, kind: EditionKind, options: CatalogueOptions = {}): Edition {
  return withFolderDecklists(groupEditionFolder(node, kind), node, options);
}

function groupEditionFolder(node: RawNode, kind: EditionKind): Edition {
  // A Deluxe or Standard folder is never partial foil, even if it contains a "PDF Print Map".
  if (folderIsPartialFoil(node.name)) return groupPartialFoilEdition(node);
  const resolved: EditionKind = kind === "partial_foil" ? "standard" : kind;
  const nested = foldersOf(node).filter((child) => productEditionKind(child.name) === kind);
  const withDeck = nested.filter((child) => containsFolder(child, "full deck") || findDescendantFolders(child, (name) => normalizeKey(name).startsWith("full deck")).length > 0);
  if (withDeck.length) {
    withDeck.sort((a, b) => countImages(b) - countImages(a));
    const grouped = withDeck[0]!;
    return withSiblingStandardFiles(groupStandardEdition(grouped, resolved), node, grouped, resolved);
  }
  // Nier, Persona 5, and Floating World keep the 1200 DPI art loose inside a nested Deluxe folder.
  const withImages = nested
    .map((child) => ({ child, count: holdsCardImages(child) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const target = withImages[0]?.child ?? node;
  return withSiblingStandardFiles(groupStandardEdition(target, resolved), node, target, resolved);
}

/**
 * Turn a Drive folder into one deck. A deck folder with Standard, Deluxe, and
 * Partial Foil children becomes one catalogue with an edition each. Deluxe
 * stays printType "standard" so it shows under Foil / Non-Foil.
 */
function keptEdition(edition: Edition): boolean {
  if (edition.cards.length > 0 || edition.backs.length > 0) return true;
  // An empty Standard or Deluxe edition is dropped. An empty partial-foil edition is kept so its note is visible.
  return edition.printType === "partial_foil" && edition.notes.some((item) => item.level === "ambiguous");
}

function nestedEditions(node: RawNode, kind: "deluxe" | "standard"): RawNode[] {
  const found: RawNode[] = [];
  for (const child of foldersOf(node)) {
    const childKind = productEditionKind(child.name);
    if (childKind === kind) found.push(child);
    else if (childKind !== "deluxe" && childKind !== "standard") found.push(...nestedEditions(child, kind));
  }
  return found;
}

function editionIsDeluxe(edition: Edition): boolean {
  if (edition.printType !== "standard") return false;
  if (edition.id === "deluxe" || edition.id.startsWith("deluxe-") || edition.id.includes("-deluxe")) return true;
  return edition.name === "Deluxe" || edition.name.startsWith("Deluxe ·") || edition.name.startsWith("Deluxe ");
}

function sameDeck(a: DeckCatalogue, b: DeckCatalogue): boolean {
  return a.id === b.id || normalizeKey(a.name) === normalizeKey(b.name);
}

/** Image file ids keyed by the same card-name keys used for pairing. PDFs are not previews. */
function indexPreviewArt(editions: Edition[]): Map<string, string> {
  const map = new Map<string, string>();
  const put = (key: string, id: string) => {
    if (key && !map.has(key)) map.set(key, id);
  };
  for (const edition of editions) {
    for (const card of edition.cards) {
      for (const face of card.faces) {
        for (const art of [face.defaultArt, ...face.alternates]) {
          if (!art || /\.pdf$/i.test(art.name)) continue;
          const parsed = parsePrintName(art.name);
          put(parsed.cardNameKey, art.id);
          put(parsed.key, art.id);
          put(normalizeKey(face.name), art.id);
          put(normalizeKey(card.name), art.id);
        }
      }
    }
  }
  return map;
}

function previewKey(art: ArtFile, faceName: string, cardName: string, thumbs: Map<string, string>): string | undefined {
  const parsed = parsePrintName(art.name);
  return [parsed.cardNameKey, parsed.key, normalizeKey(faceName), normalizeKey(cardName)].find((item) => item && thumbs.has(item));
}

function isOwnPreview(name: string): boolean {
  return isPrintImage(name) && !/\.pdf$/i.test(name);
}

/**
 * Partial foil print files stay the export ids. Previews prefer the Deluxe
 * art from this unlock, then a Standard art from this deck, then the PDF.
 * The Partial Foil Map mask is not used.
 * Deluxe previews use the Deluxe file itself. A PDF falls back to the shipped
 * Standard art for the same card. Export ids are unchanged.
 */
export function assignPartialFoilThumbs(catalogue: DeckCatalogue, external: DeckCatalogue[] = []): DeckCatalogue {
  const related = external.filter((deck) => sameDeck(deck, catalogue));
  const deluxe = [catalogue, ...related].flatMap((deck) => deck.editions.filter(editionIsDeluxe));
  const standardEditions = [catalogue, ...related].flatMap((deck) =>
    deck.editions.filter((edition) => edition.printType === "standard" && !editionIsDeluxe(edition)),
  );
  const thumbs = indexPreviewArt(deluxe);
  const standardThumbs = indexPreviewArt(standardEditions);
  for (const [key, id] of standardThumbs) if (!thumbs.has(key)) thumbs.set(key, id);
  for (const edition of catalogue.editions) {
    if (edition.printType === "partial_foil") {
      for (const card of edition.cards) {
        for (const face of card.faces) {
          for (const art of [face.defaultArt, ...face.alternates]) {
            if (!art) continue;
            const key = previewKey(art, face.name, card.name, thumbs);
            art.thumbId = (key && thumbs.get(key)) || art.id;
          }
        }
      }
    }
    if (!editionIsDeluxe(edition)) continue;
    for (const card of edition.cards) {
      for (const face of card.faces) {
        for (const art of [face.defaultArt, ...face.alternates]) {
          if (!art) continue;
          if (isOwnPreview(art.name)) {
            art.thumbId = art.id;
            continue;
          }
          const key = previewKey(art, face.name, card.name, standardThumbs);
          art.thumbId = (key && standardThumbs.get(key)) || art.id;
        }
      }
    }
  }
  return catalogue;
}

function emptyEditionError(name: string, edition: Edition): Error {
  const reason = edition.notes.find((item) => item.reason)?.reason;
  return new Error(reason || `No printable cards found in “${name}”.`);
}

/**
 * The catalogue for a pasted or crawled tree. A Partial Foil unlock's mask folders (see
 * splitFoilMasks) are taken out first, so cards, totals and XML never see them; then each Partial Foil
 * print file gets its mask id by name.
 */
export function catalogueFromTree(root: RawNode, deckName?: string, external: DeckCatalogue[] = [], options: CatalogueOptions = {}): DeckCatalogue {
  if (!root.maskScan) return catalogueFromPlainTree(root, deckName, external, options);
  const { tree, masks } = splitFoilMasks(root);
  const catalogue = catalogueFromPlainTree(tree, deckName, external, options);
  return { ...catalogue, editions: attachFoilMaps(catalogue.editions, masks) };
}

function catalogueFromPlainTree(root: RawNode, deckName?: string, external: DeckCatalogue[] = [], options: CatalogueOptions = {}): DeckCatalogue {
  const name = (deckName ?? cleanDeckName(root.name)).trim() || root.name;
  const rootKind = productEditionKind(root.name);
  const childEditions = foldersOf(root).filter((child) => productEditionKind(child.name));
  // A partial-foil folder is that edition. Deluxe and Standard children stay out of its PDF tree.
  if (rootKind === "partial_foil") {
    const partial = buildEdition(root, rootKind, options);
    const deluxe = assignEditionIds(
      nestedEditions(root, "deluxe").map((folder) => ({ folder, edition: buildEdition(folder, "deluxe", options) })),
    ).filter(keptEdition);
    const editions = [partial, ...deluxe].filter(keptEdition);
    if (!editions.length) throw emptyEditionError(root.name, partial);
    return assignPartialFoilThumbs({ id: slug(name), name, creator: "Beespair", editions }, external);
  }
  // A pasted pack title does not decide the print type. Edition folders inside it do.
  if (childEditions.length) {
    const editions = assignEditionIds(
      childEditions.map((child) => ({ folder: child, edition: buildEdition(child, productEditionKind(child.name)!, options) })),
    ).filter(keptEdition);
    if (!editions.length) throw new Error(`No printable cards found in “${root.name}”.`);
    return assignPartialFoilThumbs({ id: slug(name), name, creator: "Beespair", editions }, external);
  }
  if (rootKind) {
    const edition = assignEditionIds([{ folder: root, edition: buildEdition(root, rootKind, options) }])[0]!;
    if (!keptEdition(edition)) throw emptyEditionError(root.name, edition);
    return assignPartialFoilThumbs({ id: slug(name), name, creator: "Beespair", editions: [edition] }, external);
  }
  const folders = foldersOf(root);
  const numbered = folders.filter((child) => /^\d+(?:\.\d+)?[_\s.-]/.test(child.name));
  const hasDeckShape = folders.some((child) => ["full deck", "extras"].includes(normalizeKey(child.name)) || normalizeKey(child.name).startsWith("full deck"));
  if (numbered.length >= 2 && !hasDeckShape) {
    throw new Error(
      `That folder contains several decks (${numbered.map((child) => child.name).join(", ")}). Paste the link for one deck or one edition.`,
    );
  }
  const kind = productEditionKind(root.name) ?? "standard";
  const edition = buildEdition(root, kind, options);
  if (!edition.cards.length && !edition.backs.length) {
    throw new Error(`No printable cards found in “${root.name}”.`);
  }
  return assignPartialFoilThumbs({ id: slug(name), name, creator: "Beespair", editions: [edition] }, external);
}

/** Drive file ids of PDF print files in this edition. JPG previews are not included. */
export function pdfIdsInEdition(edition: Edition): Set<string> {
  const ids = new Set<string>();
  for (const card of edition.cards) {
    for (const face of card.faces) {
      for (const art of [face.defaultArt, ...face.alternates]) {
        if (art && /\.pdf$/i.test(art.name)) ids.add(art.id);
      }
    }
  }
  return ids;
}

export function artIdsOf(edition: Edition): Set<string> {
  const ids = new Set<string>();
  for (const back of edition.backs) ids.add(back.id);
  for (const card of edition.cards) {
    for (const face of card.faces) {
      if (face.defaultArt) ids.add(face.defaultArt.id);
      for (const art of face.alternates) ids.add(art.id);
    }
  }
  return ids;
}
