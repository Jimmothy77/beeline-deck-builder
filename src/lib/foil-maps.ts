import type { ArtFile, DeckCard, Edition, RawNode } from "@/lib/types";

/**
 * Partial Foil masks ("Partial Foil Map": black-and-white PNGs named like the cards, white = foil).
 * A Partial Foil unlock lists that folder for masks only. Masks never become cards: the mask folder
 * is taken out of the tree before the catalogue is built, so cards, totals and XML are the same as
 * without it, and each print file then gets the id of its mask (`ArtFile.maskId`) by name.
 * Mask ids, like art ids, live only on the device (the unlocked catalogue in localStorage).
 */

const MASK_IMAGE = /\.(png|jpe?g|webp)$/i;
const FACE_PREFIX = /^(\d+)_([12])[_ ]\s*(\S.*)$/;

/**
 * The key a mask and a print file are matched on: Unicode NFC, case, extension, outer and doubled
 * spaces, and the underscore Drive names use for an apostrophe ("Akroma_s Will" = "Akroma's Will").
 * A face prefix ("1_2_") is kept as the face, so a back's mask never matches its front.
 */
export function maskKey(name: string): string {
  let stem = name.normalize("NFC").trim().replace(/\.[a-z0-9]{2,4}$/i, "").trim();
  let face = "";
  const prefix = FACE_PREFIX.exec(stem);
  if (prefix) {
    face = `${prefix[1]}_${prefix[2]} `;
    stem = prefix[3]!;
  }
  const words = stem.toLowerCase().replace(/[’‘'_]/g, "'").replace(/\s+/g, " ").trim();
  return face + words;
}

/**
 * A key split for the by-card match: face prefix, card name, "(Variant)" text and trailing art number.
 * "Forest (Greenpath) 2" -> base "forest", variant "greenpath", art "2".
 */
type KeyParts = { face: string; base: string; variant: string | null; art: string | null };

function partsOf(key: string): KeyParts {
  const face = /^\d+_[12] /.exec(key)?.[0] ?? "";
  const rest = key.slice(face.length);
  const variants = [...rest.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]!.replace(/\s+/g, " ").trim()).filter(Boolean);
  const plain = rest.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const number = /\s+(\d+)$/.exec(plain);
  return {
    face,
    base: number ? plain.slice(0, number.index).trim() : plain,
    variant: variants.length ? variants.join(" | ") : null,
    art: number ? String(Number(number[1])) : null,
  };
}

/**
 * Whether a mask may stand for a print file it does not name exactly. When both name a variant, the
 * variants must be the same ("Forest (Greenpath)" never takes "Forest (Fog Canyon)"). When the card has
 * more than one art, the variant must be exactly the same, "no variant" counting as its own value
 * (a plain "Forest" never takes "Forest (Greenpath)"), and so must the art number, an unnumbered file
 * counting as art 1 ("Sol Ring 2" never takes "Sol Ring").
 */
function sameCard(target: KeyParts, mask: KeyParts, manyArts: boolean): boolean {
  if (target.variant && mask.variant && target.variant !== mask.variant) return false;
  if (manyArts && target.variant !== mask.variant) return false;
  if (manyArts && (target.art ?? "1") !== (mask.art ?? "1")) return false;
  return true;
}

export type FoilMask = { id: string; name: string; group: "tokens" | "extras" | "main" };

/** A folder that holds the masks: a Partial Foil Map that is not the PDF print map. */
export function isFoilMaskFolderName(name: string): boolean {
  const plain = name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return plain.includes("partialfoil") && plain.includes("map") && !plain.includes("pdf");
}

/**
 * Takes the mask folders (marked by the crawl) out of a tree. The tree that is left is the one the
 * catalogue is built from; the masks are every image under those folders.
 */
export function splitFoilMasks(root: RawNode): { tree: RawNode; masks: FoilMask[] } {
  const masks: FoilMask[] = [];
  const collect = (node: RawNode, group: FoilMask["group"]) => {
    for (const child of node.children ?? []) {
      if (child.folder) {
        const plain = child.name.toLowerCase();
        collect(child, plain.includes("token") ? "tokens" : plain.includes("extra") ? "extras" : group);
      } else if (MASK_IMAGE.test(child.name)) {
        masks.push({ id: child.id, name: child.name, group });
      }
    }
  };
  const strip = (node: RawNode): RawNode => {
    if (!node.children?.some((child) => child.folder)) return node;
    const children: RawNode[] = [];
    for (const child of node.children) {
      if (child.folder && child.masks) collect(child, "main");
      else children.push(child.folder ? strip(child) : child);
    }
    const { maskScan: _scan, ...rest } = node;
    void _scan;
    return { ...rest, children };
  };
  const { maskScan: _scan, ...bare } = root;
  void _scan;
  return { tree: strip(bare), masks };
}

function groupOf(card: DeckCard): FoilMask["group"] {
  return card.role === "token" ? "tokens" : card.role === "extra" ? "extras" : "main";
}

/**
 * Gives every print file of each Partial Foil edition the id of its mask, by name: the file's own
 * name first, then the face's (or a one-faced card's) name when exactly one mask has it. Masks in the
 * card's own group (Tokens, Extras, the main folder) win over the others. Cards with no mask keep
 * their art and are left without a maskId ("no foil map"). Returns new editions; ids are unchanged.
 */
export function attachFoilMaps(editions: Edition[], masks: FoilMask[]): Edition[] {
  const exact = new Map<string, FoilMask[]>();
  const byCard = new Map<string, { mask: FoilMask; parts: KeyParts }[]>();
  for (const mask of masks) {
    const key = maskKey(mask.name);
    const list = exact.get(key) ?? [];
    if (!list.some((item) => item.id === mask.id)) list.push(mask);
    exact.set(key, list);
    const parts = partsOf(key);
    if (!parts.base) continue;
    const cardKey = parts.face + parts.base;
    const same = byCard.get(cardKey) ?? [];
    if (!same.some((item) => item.mask.id === mask.id)) same.push({ mask, parts });
    byCard.set(cardKey, same);
  }
  const pick = (list: FoilMask[] | undefined, group: FoilMask["group"], unique: boolean): FoilMask | undefined => {
    if (!list?.length) return undefined;
    const own = list.filter((mask) => mask.group === group);
    const pool = own.length ? own : list;
    if (unique && pool.length !== 1) return undefined;
    return pool[0];
  };
  const byCardPick = (target: KeyParts, manyArts: boolean, group: FoilMask["group"]): FoilMask | undefined => {
    if (!target.base) return undefined;
    const list = byCard.get(target.face + target.base)?.filter((item) => sameCard(target, item.parts, manyArts));
    return pick(list?.map((item) => item.mask), group, true);
  };
  return editions.map((edition) => {
    if (edition.printType !== "partial_foil") return edition;
    let found = 0;
    let total = 0;
    const cards = edition.cards.map((card) => {
      const group = groupOf(card);
      const faces = card.faces.map((face, index) => {
        const withMask = (art: ArtFile): ArtFile => {
          total += 1;
          const key = maskKey(art.name);
          const artParts = partsOf(key);
          const manyArts = (face.defaultArt ? 1 : 0) + face.alternates.length > 1;
          // A face or card name stands in for the file's name, keeping the file's own variant and art number.
          const asName = (name: string): KeyParts => {
            const parts = partsOf(maskKey(name));
            return { face: "", base: parts.base, variant: artParts.variant ?? parts.variant, art: artParts.art };
          };
          const mask =
            pick(exact.get(key), group, false) ??
            byCardPick(artParts, manyArts, group) ??
            (artParts.face ? undefined : byCardPick(asName(face.name), manyArts, group)) ??
            (card.faces.length === 1 && index === 0 ? byCardPick(asName(card.name), manyArts, group) : undefined);
          const { maskId: _old, ...plain } = art;
          void _old;
          if (!mask) return plain;
          found += 1;
          return { ...plain, maskId: mask.id };
        };
        return { ...face, defaultArt: face.defaultArt ? withMask(face.defaultArt) : null, alternates: face.alternates.map(withMask) };
      });
      return { ...card, faces };
    });
    return { ...edition, cards, foilMaps: { found, total } };
  });
}

/** The edition can show foiled areas: an unlocked Partial Foil edition. */
export function canShowFoil(edition: Pick<Edition, "printType" | "origin">): boolean {
  return edition.printType === "partial_foil" && edition.origin === "unlocked";
}

/** The edition was unlocked before masks were read (v0.1.35 and older), so it has no mask data at all. */
export function foilMapsMissing(edition: Pick<Edition, "foilMaps">): boolean {
  return !edition.foilMaps;
}

/**
 * The edition as shown with "Show foiled area" on: each print file's thumbnail is its mask, and a file
 * with no mask keeps its own art, marked `noFoilMap`. Only `thumbId` changes, which is display only;
 * export ids, card ids and counts read `id`, so the XML is the same either way.
 */
export function foilView(edition: Edition): Edition {
  if (!canShowFoil(edition) || foilMapsMissing(edition)) return edition;
  const show = (art: ArtFile): ArtFile => (art.maskId ? { ...art, thumbId: art.maskId } : { ...art, noFoilMap: true });
  return {
    ...edition,
    cards: edition.cards.map((card) => ({
      ...card,
      faces: card.faces.map((face) => ({ ...face, defaultArt: face.defaultArt ? show(face.defaultArt) : null, alternates: face.alternates.map(show) })),
    })),
  };
}

export const FOIL_SESSION_KEY = "printabee.showFoil.v1";
export const FOIL_CAPTION = "White marks the foiled area.";
export const NO_FOIL_MAP = "no foil map";
export const FOIL_MAPS_MISSING_NOTE = "This deck was unlocked before BeeLine read foil maps. Paste its Drive link again to see the foiled areas.";

/** The switch's remembered state for this tab. A storage that can't be read means off. */
export function readShowFoil(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(FOIL_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowFoil(store: Pick<Storage, "setItem" | "removeItem"> | null, on: boolean): void {
  try {
    if (on) store?.setItem(FOIL_SESSION_KEY, "1");
    else store?.removeItem(FOIL_SESSION_KEY);
  } catch {
    // Not remembered; the switch still works for this view.
  }
}
