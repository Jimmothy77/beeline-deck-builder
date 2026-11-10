import { describe, expect, it } from "vitest";
import {
  CARD_RATIO,
  DESKTOP_THUMB_WIDTH,
  FLYOUT_FADE_MS,
  FLYOUT_FLIP_EASING,
  FLYOUT_FLIP_MS,
  FLYOUT_GROW_EASING,
  FLYOUT_GROW_MS,
  bezierPoints,
  smoothFlipEasing,
  TOKEN_TILE_THRESHOLD,
  backToTopVisible,
  flipPlan,
  flyoutPlacement,
  flyoutSize,
  sideTileSummary,
  usesSideTile,
} from "@/lib/desktop";

const viewport = { width: 1440, height: 900 };
const size = { width: 400, height: Math.floor(400 * CARD_RATIO) };
const overlaps = (a: { left: number; right: number }, left: number, width: number) => !(left >= a.right || left + width <= a.left);

describe("flyout flip plan", () => {
  it("turns twice and ends on the front", () => {
    const plan = flipPlan({ cardback: "deck-back", reducedMotion: false });
    expect(plan.turns).toBe(2);
    expect(plan.faces).toEqual(["front", "back", "front", "back", "front"]);
    expect(plan.faces.at(-1)).toBe("front");
  });

  it("ends on the front for any number of turns", () => {
    for (const turns of [1, 2, 3]) expect(flipPlan({ cardback: "b", reducedMotion: false, turns }).faces.at(-1)).toBe("front");
  });

  it("shows a double-faced card's own back, not the deck back", () => {
    const plan = flipPlan({ dfcBack: "lost-vale", cardback: "deck-back", reducedMotion: false });
    expect(plan.mode).toBe("dfc");
    expect(plan.backImage).toBe("lost-vale");
  });

  it("uses the deck card back for a one-faced card", () => {
    const plan = flipPlan({ dfcBack: null, cardback: "deck-back", reducedMotion: false });
    expect(plan.mode).toBe("cardback");
    expect(plan.backImage).toBe("deck-back");
  });

  it("just spins when there is no back at all", () => {
    const plan = flipPlan({ reducedMotion: false });
    expect(plan.mode).toBe("spin");
    expect(plan.backImage).toBeNull();
    expect(plan.turns).toBeGreaterThan(0);
  });

  it("does no flips with reduced motion, even for a double-faced card", () => {
    const plan = flipPlan({ dfcBack: "lost-vale", cardback: "deck-back", reducedMotion: true });
    expect(plan).toEqual({ mode: "fade", turns: 0, faces: ["front"], backImage: null });
  });
});

describe("flyout placement", () => {
  it("goes right of the card row when it fits, clear of that row's controls", () => {
    const anchor = { left: 100, top: 300, right: 260, bottom: 460 };
    const place = flyoutPlacement(anchor, viewport, size);
    expect(place.side).toBe("right");
    expect(place.left).toBe(272);
    expect(overlaps(anchor, place.left, place.width)).toBe(false);
  });

  it("flips to the left near the right edge", () => {
    const anchor = { left: 1150, top: 300, right: 1330, bottom: 460 };
    const place = flyoutPlacement(anchor, viewport, size);
    expect(place.side).toBe("left");
    expect(place.left).toBe(1150 - 12 - 400);
    expect(place.left + place.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(overlaps(anchor, place.left, place.width)).toBe(false);
  });

  it("clamps inside the viewport when neither side fits", () => {
    const narrow = { width: 700, height: 900 };
    const anchor = { left: 200, top: 300, right: 500, bottom: 460 };
    const place = flyoutPlacement(anchor, narrow, size);
    expect(place.side).toBe("over");
    expect(place.left).toBeGreaterThanOrEqual(12);
    expect(place.left + place.width).toBeLessThanOrEqual(narrow.width - 12);
  });

  it("centres on the row and clamps at the top and bottom edges", () => {
    const middle = flyoutPlacement({ left: 100, top: 400, right: 260, bottom: 500 }, viewport, size);
    expect(middle.top).toBe(Math.round(450 - size.height / 2));
    const high = flyoutPlacement({ left: 100, top: -50, right: 260, bottom: 20 }, viewport, size);
    expect(high.top).toBe(12);
    const low = flyoutPlacement({ left: 100, top: 860, right: 260, bottom: 1000 }, viewport, size);
    expect(low.top).toBe(viewport.height - 12 - size.height);
  });

  it("shrinks the card to fit a short window and keeps card proportions", () => {
    expect(flyoutSize({ width: 1440, height: 900 })).toEqual({ width: 400, height: Math.floor(400 * CARD_RATIO) });
    const short = flyoutSize({ width: 1440, height: 400 });
    expect(short.height).toBeLessThanOrEqual(400 - 24);
    expect(short.width).toBe(Math.floor((400 - 24) / CARD_RATIO));
  });
});

describe("flyout flip timing (v0.1.27)", () => {
  // v0.1.26 turned in 900ms on cubic-bezier(0.2, 0.7, 0.2, 1), which whips through the first turn.
  const OLD_FLIP_MS = 900;
  const OLD_FLIP_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

  it("is about twice as long as v0.1.26, and still settles quickly enough to stay snappy", () => {
    expect(FLYOUT_FLIP_MS).toBe(1800);
    expect(FLYOUT_FLIP_MS / OLD_FLIP_MS).toBe(2);
    expect(FLYOUT_GROW_MS).toBeLessThan(FLYOUT_FLIP_MS);
    expect(FLYOUT_FADE_MS).toBeLessThanOrEqual(200);
  });

  it("eases in and out with no whip at the start and no swing past the front", () => {
    expect(bezierPoints(FLYOUT_FLIP_EASING)).toEqual([0.45, 0, 0.25, 1]);
    expect(smoothFlipEasing(FLYOUT_FLIP_EASING)).toBe(true);
    expect(smoothFlipEasing(OLD_FLIP_EASING)).toBe(false);
    expect(smoothFlipEasing("cubic-bezier(0, 0, 1, 1)")).toBe(false);
    expect(smoothFlipEasing("cubic-bezier(0.45, 0, 0.25, 1.3)")).toBe(false);
    expect(smoothFlipEasing("ease")).toBe(false);
    expect(bezierPoints(FLYOUT_GROW_EASING)).not.toBeNull();
  });

});

describe("flyout size against the v0.1.27 thumbnails", () => {
  it("stays clearly larger than the 160px desktop thumbnail", () => {
    expect(DESKTOP_THUMB_WIDTH).toBe(160);
    expect(flyoutSize({ width: 1440, height: 900 }).width).toBeGreaterThanOrEqual(2.5 * DESKTOP_THUMB_WIDTH);
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      const fly = flyoutSize(viewport);
      expect(fly.width).toBeGreaterThanOrEqual(2 * DESKTOP_THUMB_WIDTH);
      expect(fly.height).toBeLessThanOrEqual(viewport.height - 24);
    }
  });
});

describe("back to top", () => {
  it("is hidden only at the very top", () => {
    expect(backToTopVisible(0)).toBe(false);
    expect(backToTopVisible(1)).toBe(true);
    expect(backToTopVisible(2400)).toBe(true);
  });
});

describe("side tiles", () => {
  it("always gives extras the tile, and tokens only past the threshold", () => {
    expect(TOKEN_TILE_THRESHOLD).toBe(8);
    expect(usesSideTile("extras", 1)).toBe(true);
    expect(usesSideTile("extras", 0)).toBe(false);
    expect(usesSideTile("tokens", 8)).toBe(false);
    expect(usesSideTile("tokens", 9)).toBe(true);
    expect(usesSideTile("tokens", 0)).toBe(false);
  });

  it("writes the tile count", () => {
    expect(sideTileSummary("extras", 24, 3)).toBe("24 extras, 3 added");
    expect(sideTileSummary("extras", 1, 0)).toBe("1 extra, 0 added");
    expect(sideTileSummary("tokens", 194, 0)).toBe("194 tokens, 0 added");
  });
});
