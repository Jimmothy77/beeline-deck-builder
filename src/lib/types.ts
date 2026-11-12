export type PrintType = "standard" | "partial_foil";

export type ArtFile = {
  id: string;
  /** Drive file name. This is what the XML <name> uses. */
  name: string;
  /** File id used for the thumbnail. Public PDFs can use their own id. */
  thumbId: string;
  /** Short label in the art picker, usually the file name without its extension. */
  label: string;
  /**
   * Which print set this file came from when an edition ships both, such as
   * SxF's Color and Black and White options. Absent when there is only one.
   */
  tone?: ArtTone;
  /**
   * Partial Foil only: the file id of this print's foil mask ("Partial Foil Map", white = foil).
   * Device-only, like every unlocked file id. Absent when the print has no mask.
   */
  maskId?: string;
  /** Set only on the display copy made by foilView, for a print with no mask. Never stored. */
  noFoilMap?: true;
};

export type ArtTone = "color" | "bw";

export type CardFace = {
  id: string;
  name: string;
  defaultArt: ArtFile | null;
  alternates: ArtFile[];
};

export type CardRole = "main" | "token" | "extra";

export type DeckCard = {
  id: string;
  name: string;
  role: CardRole;
  /** One face, or two when the card is double-faced. */
  faces: CardFace[];
  defaultQty: number;
  /** Unmatched black-and-white print. Absent on shipped catalogues. */
  bwOnly?: boolean;
};

export type CardBack = {
  id: string;
  name: string;
  thumbId: string;
};

export type DecklistEntry = {
  qty: number;
  name: string;
  set?: string;
  number?: string;
};

/** A Tapped Out text export that sits in an edition folder. It holds no Drive ids. */
export type Decklist = {
  /** Stable id from the label, used by saved decks. */
  id: string;
  /** Dropdown label: the text after "decklist - " in the file name. */
  label: string;
  fileName: string;
  /** The list's own "Name" line from its About section. */
  title?: string;
  commander: DecklistEntry[];
  main: DecklistEntry[];
  /** Parsed apart and never added to the main-deck counts. */
  sideboard: DecklistEntry[];
  /** Lines that were not a card or a section header. */
  skipped?: string[];
  /** True when the file had no section headers (a plain "1 Name" list). */
  plain?: boolean;
};

export type CatalogueNote = {
  level: "ambiguous" | "info" | "skipped";
  name: string;
  path: string;
  reason: string;
};

export type Edition = {
  id: string;
  name: string;
  printType: PrintType;
  cards: DeckCard[];
  backs: CardBack[];
  notes: CatalogueNote[];
  /**
   * Files that belong to this edition but are not cards, such as a Deluxe
   * folder's own Standard Edition (600 DPI) prints. Used only to retarget a
   * saved file by its name. Shipped JSON leaves this off.
   */
  sourceFiles?: { id: string; name: string }[];
  /**
   * Deck lists found in this edition's own folder. When present, a new deck
   * opens on list quantities instead of one of every main-folder card.
   */
  decklists?: Decklist[];
  /** Set at runtime. Shipped JSON leaves this off. */
  origin?: "shipped" | "unlocked";
  /** Id inside the unlocked pack, before two packs are given distinct ids. */
  sourceId?: string;
  /** Short hash of the unlocked folder. Memory and localStorage only, never a Drive id. */
  packHash?: string;
  /**
   * Partial Foil editions unlocked by v0.1.36 or later: how many print files got a foil mask, of how
   * many. Absent on older unlocks (masks were never read) and on every other edition.
   */
  foilMaps?: { found: number; total: number };
};

export type DeckCatalogue = {
  id: string;
  name: string;
  creator: "Beespair";
  editions: Edition[];
};

export type DeckIndex = {
  decks: { id: string; name: string; file: string }[];
};

/** A node in a Drive folder listing. Paid unlock and the crawl script both produce this. */
export type RawNode = {
  id: string;
  name: string;
  folder: boolean;
  children?: RawNode[];
  /** A Partial Foil Map mask folder, listed for masks only (see splitFoilMasks). */
  masks?: true;
  /** On the root of a Partial Foil unlock: mask folders were looked for. */
  maskScan?: true;
};
