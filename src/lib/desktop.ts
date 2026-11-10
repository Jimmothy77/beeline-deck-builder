/**
 * Desktop-only builder helpers: the card-art flyout, the Back to top button,
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
export const FLYOUT_MAX_WIDTH = 320;
export const FLYOUT_MARGIN = 12;
export const FLYOUT_GAP = 12;
/** Whole turns the card makes while it expands. Two turns show the back twice. */
export const FLYOUT_TURNS = 2;
export const FLYOUT_FLIP_MS = 900;
export const FLYOUT_FADE_MS = 160;

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type FlyoutSide = "right" | "left" | "over";
export type FlyoutPlacement = { left: number; top: number; width: number; height: number; side: FlyoutSide };

export type FlipMode = "dfc" | "cardback" | "spin" | "fade";
export type FlipPlan = {
  mode: FlipMode;
  /** Whole turns. 0 means no flip. */
  turns: number;
  /** The side that faces the viewer at each half turn, first to last. Always ends on "front". */
  faces: Array<"front" | "back">;
  /** Thumbnail id shown on the back while it turns. Null when nothing is drawn on the back. */
  backImage: string | null;
};

/**
 * How the flyout turns while it opens. A double-faced card shows its own back,
 * any other card shows the deck's card back, and a card with neither just spins
 * (its front on both sides). With reduced motion there is no turn, only a fade.
 */
export function flipPlan({
  dfcBack,
  cardback,
  reducedMotion,
  turns = FLYOUT_TURNS,
}: {
  dfcBack?: string | null;
  cardback?: string | null;
  reducedMotion: boolean;
  turns?: number;
}): FlipPlan {
  if (reducedMotion || turns <= 0) return { mode: "fade", turns: 0, faces: ["front"], backImage: null };
  const mode: FlipMode = dfcBack ? "dfc" : cardback ? "cardback" : "spin";
  const faces: Array<"front" | "back"> = [];
  for (let half = 0; half <= turns * 2; half += 1) faces.push(half % 2 === 0 ? "front" : "back");
  return { mode, turns, faces, backImage: dfcBack || cardback || null };
}

/** Flyout size: up to 320px wide, never taller than the viewport minus its margins. */
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
