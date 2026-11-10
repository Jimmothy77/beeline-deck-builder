import { naturalCompare, normalizeKey, parsePrintName, slug } from "@/lib/names";
import type { ArtFile, CardRole, CatalogueNote, DeckCard } from "@/lib/types";

/**
 * Double-faced prints are named by a pair number and a face number:
 * "1_1_Dowsing Dagger" is the front and "1_2 Lost Vale" the back of card 1,
 * even when the two faces have different names. Grouping usually pairs them
 * while it reads a folder. This pass catches faces that ended up as two
 * separate one-faced cards (different folders, or an older catalogue), and
 * a back face with no front.
 *
 * - One lone front and its lone back(s) in the same role become one card.
 *   The card keeps the front's id, so its copies and saved picks stay put.
 * - A lone face whose pair is already a double-faced card in that role joins
 *   that card as another art of the same face.
 * - A main-deck back with no front is never its own main-deck card. It is
 *   kept as an extra at 0, and no front is invented for it.
 * - A few known double-faced cards were once shared without the face prefix
 *   (KNOWN_UNPREFIXED_PAIRS). Their unprefixed files pair the same way, but
 *   only when the front and the back are both there, once each in the role,
 *   and the role has no prefixed front of the same name (then the renamed
 *   files already make the card); a known back on its own is left as it is.
 */
export type FacePairing = { cards: DeckCard[]; notes: CatalogueNote[] };

type Lone = { card: DeckCard; pair: string; face: 1 | 2; base: string; known?: boolean };

/**
 * Double-faced cards whose files were shared without "1_1_"/"1_2_" (front
 * name key, back name key, as parsePrintName's cardNameKey). SxF's
 * Hydroelectric Specimen // Hydroelectric Laboratory was named this way
 * before the source folders were renamed; paid packs unlocked before the
 * rename may still carry the old names.
 */
export const KNOWN_UNPREFIXED_PAIRS: readonly (readonly [front: string, back: string])[] = [["hydroelectric specimen", "hydroelectric laboratory"]];

/** The card-name key of a face, from its first file ("1_1_Name (Theme).jpg" and "Name (Theme).png" give "name"). */
function faceKey(card: DeckCard, index: number): string {
  const face = card.faces[index];
  if (!face) return "";
  return parsePrintName(face.defaultArt?.name ?? `${face.name}.png`).cardNameKey;
}

/**
 * True for a double-faced card that is one of KNOWN_UNPREFIXED_PAIRS (SxF's
 * Hydroelectric Specimen // Hydroelectric Laboratory), whether its files are
 * named 1_1_/1_2_ or not. Saved decks from before the pair was joined fold
 * their old back-face row onto this card in the deck's print set; no other
 * card's saved rows are touched that way.
 */
export function isKnownUnprefixedPair(card: DeckCard): boolean {
  if (card.faces.length < 2) return false;
  const front = faceKey(card, 0);
  const back = faceKey(card, 1);
  return KNOWN_UNPREFIXED_PAIRS.some(([knownFront, knownBack]) => knownFront === front && knownBack === back);
}

function artsOf(card: DeckCard): ArtFile[] {
  return card.faces.flatMap((face) => [face.defaultArt, ...face.alternates]).filter((art): art is ArtFile => Boolean(art));
}

/** The pair and face of a one-faced card whose every file carries the same face prefix. */
function loneFace(card: DeckCard): Lone | null {
  if (card.faces.length !== 1) return null;
  const arts = artsOf(card);
  if (!arts.length) return null;
  const parsed = arts.map((art) => parsePrintName(art.name));
  const first = parsed[0]!;
  if (!first.facePair && !first.face) {
    if (!parsed.every((item) => !item.facePair && item.cardNameKey === first.cardNameKey)) return null;
    for (const [index, pair] of KNOWN_UNPREFIXED_PAIRS.entries()) {
      const face = pair[0] === first.cardNameKey ? 1 : pair[1] === first.cardNameKey ? 2 : null;
      if (face) return { card, pair: `known-${index}`, face, base: first.base, known: true };
    }
    return null;
  }
  if (!first.facePair || !first.face) return null;
  if (!parsed.every((item) => item.facePair === first.facePair && item.face === first.face)) return null;
  return { card, pair: first.facePair, face: first.face, base: first.base };
}

/** The pair number of a double-faced card, read from its front files. */
function pairOfDoubleFaced(card: DeckCard): string | null {
  if (card.faces.length < 2) return null;
  const front = [card.faces[0]!.defaultArt, ...card.faces[0]!.alternates].filter((art): art is ArtFile => Boolean(art));
  const pairs = new Set(front.map((art) => parsePrintName(art.name)).filter((item) => item.face === 1).map((item) => item.facePair));
  return pairs.size === 1 ? [...pairs][0]! : null;
}

function sortArts(arts: ArtFile[]): ArtFile[] {
  return [...arts].sort((a, b) => naturalCompare(a.label, b.label));
}

function mergeArts(base: ArtFile | null, rest: ArtFile[], extra: ArtFile[]): { defaultArt: ArtFile | null; alternates: ArtFile[] } {
  const seen = new Set<string>();
  const all = [base, ...rest, ...extra]
    .filter((art): art is ArtFile => {
      if (!art || seen.has(art.id)) return false;
      seen.add(art.id);
      return true;
    })
    .map(relabel);
  const [first, ...others] = all;
  return { defaultArt: first ?? null, alternates: sortArts(others) };
}

/** The art picker label drops the face prefix, as grouping does for "1_2_Name". */
function relabel(art: ArtFile): ArtFile {
  const label = parsePrintName(art.name).stem;
  return label === art.label ? art : { ...art, label };
}

const ROLE_ORDER: CardRole[] = ["main", "token", "extra"];

export function pairLooseFaces(input: DeckCard[], depth = 0): FacePairing {
  const notes: CatalogueNote[] = [];
  const byGroup = new Map<string, Lone[]>();
  for (const card of input) {
    const lone = loneFace(card);
    if (!lone) continue;
    const key = `${card.role}\u0000${lone.pair}`;
    const list = byGroup.get(key) ?? [];
    list.push(lone);
    byGroup.set(key, list);
  }
  if (!byGroup.size) return { cards: input, notes };

  const used = new Set(input.map((card) => card.id));
  let deferKnown = false;
  // Front name keys of prefixed fronts ("1_1_Name"), per role, whether already paired or still loose.
  const prefixedFronts = new Set<string>();
  for (const card of input) {
    for (const art of artsOf({ ...card, faces: card.faces.slice(0, 1) })) {
      const parsed = parsePrintName(art.name);
      if (parsed.facePair && parsed.face === 1) prefixedFronts.add(`${card.role}\u0000${parsed.cardNameKey}`);
    }
  }
  const replace = new Map<string, DeckCard | null>();
  const grow = new Map<string, DeckCard>();
  for (const [key, list] of byGroup) {
    const [role, pair] = key.split("\u0000") as [CardRole, string];
    const fronts = list.filter((item) => item.face === 1);
    const backs = list.filter((item) => item.face === 2);
    const known = list.some((item) => item.known);
    // The old unprefixed Hydroelectric files fold into the renamed 1_1_/1_2_ card as more arts of the same faces.
    const knownFront = known ? KNOWN_UNPREFIXED_PAIRS[Number(pair.slice("known-".length))]?.[0] : undefined;
    const existing = known
      ? input.filter((card) => card.role === role && card.faces.length >= 2 && faceKey(card, 0) === knownFront && !list.some((item) => item.card.id === card.id))
      : input.filter((card) => card.role === role && pairOfDoubleFaced(card) === pair);
    if (existing.length === 1) {
      const target = grow.get(existing[0]!.id) ?? existing[0]!;
      const faces = target.faces.map((face, index) => {
        const joining = (index === 0 ? fronts : index === 1 ? backs : []).flatMap((item) => artsOf(item.card));
        return joining.length ? { ...face, ...mergeArts(face.defaultArt, face.alternates, joining) } : face;
      });
      grow.set(target.id, { ...target, faces });
      for (const item of [...fronts, ...backs]) replace.set(item.card.id, null);
      if (known) {
        notes.push({
          level: "info",
          name: target.name,
          path: "",
          reason: `Added the files without the 1_1_/1_2_ prefix (${[...fronts, ...backs].map((item) => item.card.name).join(", ")}) to ${target.name} as more arts of the same faces, so the card is listed once.`,
        });
      }
      continue;
    }
    if (existing.length > 1) continue;
    if (known && (fronts.length !== 1 || backs.length !== 1)) continue;
    // The renamed 1_1_/1_2_ files are still two loose faces: they pair in this pass, and the old files join them in the next.
    if (known && prefixedFronts.has(`${role}\u0000${parsePrintName(fronts[0]!.card.faces[0]!.defaultArt?.name ?? "").cardNameKey}`)) {
      deferKnown = true;
      continue;
    }
    if (fronts.length === 1 && backs.length >= 1) {
      const front = fronts[0]!;
      const [firstBack, ...moreBacks] = backs;
      const backArts = [...artsOf(firstBack!.card), ...moreBacks.flatMap((item) => artsOf(item.card))];
      const backName = firstBack!.base;
      const frontFace = front.card.faces[0]!;
      const sameName = normalizeKey(front.base) === normalizeKey(backName) || normalizeKey(front.card.name) === normalizeKey(backName);
      const name = sameName ? front.card.name : `${front.card.name} // ${backName}`;
      const merged: DeckCard = {
        ...front.card,
        name,
        faces: [
          { ...frontFace, id: `${front.card.id}:front` },
          { id: `${front.card.id}:back`, name: backName, ...mergeArts(backArts[0] ?? null, [], backArts.slice(1)) },
        ],
      };
      replace.set(front.card.id, merged);
      for (const item of backs) replace.set(item.card.id, null);
      notes.push({
        level: "info",
        name,
        path: "",
        reason: known
          ? `Paired ${front.card.name} with its back face ${backName} (a known double-faced card whose files have no 1_1_/1_2_ prefix) so the back is printed with its front and is not counted as its own card.`
          : `Paired face ${pair}_1 with face ${pair}_2 so the back is printed with its front and is not counted as its own card.`,
      });
      continue;
    }
    if (role !== "main") continue;
    for (const item of fronts.length ? [] : backs) {
      let id = `extra-${slug(item.base)}`;
      for (let n = 2; used.has(id); n++) id = `extra-${slug(item.base)}-${n}`;
      used.add(id);
      const face = item.card.faces[0]!;
      replace.set(item.card.id, {
        ...item.card,
        id,
        name: item.base,
        role: "extra",
        defaultQty: 0,
        faces: [{ ...face, id: `${id}:front`, name: item.base, ...mergeArts(face.defaultArt, face.alternates, []) }],
      });
      notes.push({
        level: "info",
        name: item.base,
        path: "",
        reason: `This is the back face (${pair}_2) of a card with no ${pair}_1 front here, so it is listed as an extra and not counted as a main-deck card.`,
      });
    }
  }
  if (!replace.size && !grow.size) return { cards: input, notes };
  const out: DeckCard[] = [];
  for (const card of input) {
    if (grow.has(card.id)) {
      out.push(grow.get(card.id)!);
      continue;
    }
    if (!replace.has(card.id)) {
      out.push(card);
      continue;
    }
    const next = replace.get(card.id);
    if (next) out.push(next);
  }
  const ordered = out
    .map((card, index) => ({ card, index }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.card.role) - ROLE_ORDER.indexOf(b.card.role) || a.index - b.index)
    .map((item) => item.card);
  if (deferKnown && depth === 0) {
    const again = pairLooseFaces(ordered, 1);
    return { cards: again.cards, notes: [...notes, ...again.notes] };
  }
  return { cards: ordered, notes };
}
