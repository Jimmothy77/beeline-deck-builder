/**
 * Desktop-only builder helpers: the card-art pop-up (the "flyout"), the Back to top button,
 * and the Extras / Tokens side tiles. Pure functions so they can be tested
 * without a browser. The phone layout does not use any of this.
 */

/** Same switch as the builder's two-pane layout (Tailwind `lg`). Below it the phone and tablet tabs are used. */
export const DESKTOP_MIN_WIDTH = 1024;
/**
 * The flyout opens only at desktop widths. On top of this, a pointer opens it
 * only when the pointer is a mouse (never touch or pen), and focus opens it
 * only when it is keyboard focus (:focus-visible), which a tap never gives.
 */
export const FLYOUT_MEDIA = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
export const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)";

/** Card proportions (63 x 88 mm). */
export const CARD_RATIO = 88 / 63;
/** Main-deck art width at desktop widths (Tailwind `lg:w-40`). Phones keep `w-12`. */
export const DESKTOP_THUMB_WIDTH = 160;
export const FLYOUT_MAX_WIDTH = 400;
export const FLYOUT_MARGIN = 12;
export const FLYOUT_GAP = 12;
/**
 * The flyout pops up: a quick fade plus a scale-in from the hovered thumbnail,
 * with an ease-out that settles without overshoot. With reduced motion there is
 * no scale, only a near-instant fade.
 */
export const FLYOUT_POP_MS = 180;
export const FLYOUT_POP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
export const FLYOUT_POP_FROM_SCALE = 0.6;
export const FLYOUT_REDUCED_FADE_MS = 60;
/** A card's own back is shown beside the front, at this fraction of the front's width. */
export const FLYOUT_BACK_SCALE = 0.5;
/** Room for the "Back face" / "Chosen back" label under the back. */
export const FLYOUT_BACK_LABEL = 24;
/** A front shown with its back never shrinks below this to fit beside the row. */
export const FLYOUT_MIN_PAIR_WIDTH = 280;

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type FlyoutSide = "right" | "left" | "over";
export type FlyoutPlacement = { left: number; top: number; width: number; height: number; side: FlyoutSide };

export type FlyoutBackKind = "custom" | "dfc";
/** The back the flyout shows beside the front, or null for a one-faced card with no back picked. */
export type FlyoutBack = { kind: FlyoutBackKind; image: string } | null;

/**
 * Which back the flyout shows. A back picked in the card editor wins (it is what
 * prints, even over a double-faced card's own back face); otherwise a
 * double-faced card shows its own back face. Any other card shows only its
 * front: its back is the deck's card back, the same for every card and shown in
 * the Card back picker.
 */
export function flyoutBack({ customBack, dfcBack }: { customBack?: string | null; dfcBack?: string | null }): FlyoutBack {
  if (customBack) return { kind: "custom", image: customBack };
  if (dfcBack) return { kind: "dfc", image: dfcBack };
  return null;
}

export type FlyoutLayout = {
  /** The front card. */
  front: Size;
  /** The back beside it, or null. */
  back: Size | null;
  /** The whole pop-up: front, gap and back. */
  size: Size;
};

/**
 * Sizes for the pop-up. Without a back it is the front alone, as large as
 * flyoutSize allows (up to 400px). With a back, the back sits beside the front
 * at FLYOUT_BACK_SCALE of its width, and the pair shrinks (never below
 * FLYOUT_MIN_PAIR_WIDTH for the front) until it fits on one side of the row.
 */
export function flyoutLayout(anchor: Rect, viewport: Size, hasBack: boolean, margin = FLYOUT_MARGIN, gap = FLYOUT_GAP): FlyoutLayout {
  const full = flyoutSize(viewport);
  if (!hasBack) return { front: full, back: null, size: full };
  const pair = (width: number) => width + gap + Math.floor(width * FLYOUT_BACK_SCALE);
  const room = Math.max(viewport.width - margin - anchor.right - gap, anchor.left - gap - margin, 0);
  let width = full.width;
  if (pair(width) > room) width = Math.min(full.width, Math.max(FLYOUT_MIN_PAIR_WIDTH, Math.floor((room - gap) / (1 + FLYOUT_BACK_SCALE))));
  const front = { width, height: Math.floor(width * CARD_RATIO) };
  const backWidth = Math.floor(width * FLYOUT_BACK_SCALE);
  const back = { width: backWidth, height: Math.floor(backWidth * CARD_RATIO) };
  return { front, back, size: { width: pair(width), height: front.height } };
}

/** Where the pop-up scales in from: the centre of the hovered thumbnail, relative to the pop-up's top-left corner. */
export function popOrigin(thumb: Rect, placement: { left: number; top: number }): { x: number; y: number } {
  return { x: Math.round((thumb.left + thumb.right) / 2 - placement.left), y: Math.round((thumb.top + thumb.bottom) / 2 - placement.top) };
}

/** Flyout size: up to FLYOUT_MAX_WIDTH (400px) wide, never taller than the viewport minus its margins. */
export function flyoutSize(viewport: Size, maxWidth = FLYOUT_MAX_WIDTH, margin = FLYOUT_MARGIN): Size {
  const byHeight = Math.max(0, (viewport.height - margin * 2) / CARD_RATIO);
  const byWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.floor(Math.min(maxWidth, byHeight, byWidth));
  return { width, height: Math.floor(width * CARD_RATIO) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the flyout goes. The anchor is the whole card row (art and count
 * controls), so the flyout sits beside it and never on top of that card's
 * - / + buttons: right of the row when it fits, otherwise left, otherwise
 * the wider side, clamped. Vertically it is centred on the row and kept
 * inside the viewport.
 */
export function flyoutPlacement(anchor: Rect, viewport: Size, size: Size = flyoutSize(viewport), margin = FLYOUT_MARGIN, gap = FLYOUT_GAP): FlyoutPlacement {
  const { width, height } = size;
  let left: number;
  let side: FlyoutSide;
  if (anchor.right + gap + width <= viewport.width - margin) {
    left = anchor.right + gap;
    side = "right";
  } else if (anchor.left - gap - width >= margin) {
    left = anchor.left - gap - width;
    side = "left";
  } else {
    const roomRight = viewport.width - anchor.right;
    const roomLeft = anchor.left;
    left = roomRight >= roomLeft ? anchor.right + gap : anchor.left - gap - width;
    left = clamp(left, margin, viewport.width - margin - width);
    side = "over";
  }
  const middle = (anchor.top + anchor.bottom) / 2;
  const top = clamp(middle - height / 2, margin, viewport.height - margin - height);
  return { left: Math.round(left), top: Math.round(top), width, height, side };
}

/** Back to top shows as soon as the page has scrolled at all, and hides only at the very top. */
export function backToTopVisible(scrollY: number): boolean {
  return scrollY > 0;
}

export type SideKind = "extras" | "tokens";

/**
 * Tokens get the compact tile and overlay when there are more than this many.
 * Eight sidebar rows already reach past a 900px-tall window. Extras always get the tile.
 */
export const TOKEN_TILE_THRESHOLD = 8;

export function usesSideTile(kind: SideKind, count: number): boolean {
  if (count <= 0) return false;
  return kind === "extras" ? true : count > TOKEN_TILE_THRESHOLD;
}

/** "24 extras, 3 added". Added counts cards with at least one copy. */
export function sideTileSummary(kind: SideKind, total: number, added: number): string {
  const noun = kind === "extras" ? (total === 1 ? "extra" : "extras") : total === 1 ? "token" : "tokens";
  return `${total} ${noun}, ${added} added`;
}
