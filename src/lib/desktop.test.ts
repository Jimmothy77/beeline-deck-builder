import { describe, expect, it } from "vitest";
import {
  CARD_RATIO,
  DESKTOP_THUMB_WIDTH,
  FLYOUT_BACK_SCALE,
  FLYOUT_GAP,
  FLYOUT_MIN_PAIR_WIDTH,
  FLYOUT_POP_EASING,
  FLYOUT_POP_FROM_SCALE,
  FLYOUT_POP_MS,
  FLYOUT_REDUCED_FADE_MS,
  TOKEN_TILE_THRESHOLD,
  backToTopVisible,
  flyoutBack,
  flyoutLayout,
  flyoutPlacement,
  popOrigin,
  flyoutSize,
  sideTileSummary,
  usesSideTile,
} from "@/lib/desktop";

const viewport = { width: 1440, height: 900 };
const size = { width: 400, height: Math.floor(400 * CARD_RATIO) };
const overlaps = (a: { left: number; right: number }, left: number, width: number) => !(left >= a.right || left + width <= a.left);

describe("flyout back", () => {
  it("shows a back picked in the card editor over a double-faced card's own back face", () => {
    expect(flyoutBack({ customBack: "pick", dfcBack: "lost-vale" })).toEqual({ kind: "custom", image: "pick" });
  });

  it("shows a double-faced card's own back face", () => {
    expect(flyoutBack({ dfcBack: "lost-vale" })).toEqual({ kind: "dfc", image: "lost-vale" });
  });

  it("shows no back for a one-faced card without a pick (its back is the deck back)", () => {
    expect(flyoutBack({})).toBeNull();
    expect(flyoutBack({ customBack: null, dfcBack: null })).toBeNull();
  });
});

describe("flyout layout with a back beside the front", () => {
  const leftRow = { left: 40, top: 300, right: 340, bottom: 560 };
  it("keeps the front alone at full size when there is no back", () => {
    expect(flyoutLayout(leftRow, viewport, false)).toEqual({ front: size, back: null, size });
  });

  it("puts the back beside the front at half its width, at full size when the pair fits", () => {
    const layout = flyoutLayout(leftRow, viewport, true);
    expect(layout.front).toEqual(size);
    expect(layout.back).toEqual({ width: 400 * FLYOUT_BACK_SCALE, height: Math.floor(200 * CARD_RATIO) });
    expect(layout.size).toEqual({ width: 400 + FLYOUT_GAP + 200, height: size.height });
    const place = flyoutPlacement(leftRow, viewport, layout.size);
    expect(place.side).toBe("right");
    expect(place.left + place.width).toBeLessThanOrEqual(viewport.width - 12);
  });

  it("shrinks the pair to fit beside a row in the middle of the screen, so it never covers that row", () => {
    const middle = { left: 560, top: 300, right: 860, bottom: 560 };
    const layout = flyoutLayout(middle, viewport, true);
    expect(layout.front.width).toBeLessThan(400);
    expect(layout.front.width).toBeGreaterThanOrEqual(FLYOUT_MIN_PAIR_WIDTH);
    const place = flyoutPlacement(middle, viewport, layout.size);
    expect(place.side).not.toBe("over");
    expect(overlaps(middle, place.left, place.width)).toBe(false);
  });

  it("never shrinks the front below the minimum, even with no room at all", () => {
    expect(flyoutLayout({ left: 300, top: 0, right: 1140, bottom: 100 }, viewport, true).front.width).toBe(FLYOUT_MIN_PAIR_WIDTH);
  });
});

describe("flyout pop-up", () => {
  it("scales in from the centre of the hovered thumbnail", () => {
    expect(popOrigin({ left: 100, top: 200, right: 260, bottom: 424 }, { left: 352, top: 100 })).toEqual({ x: -172, y: 212 });
  });

  it("is quick (150-200ms), eases out without overshoot, and fades near-instantly with reduced motion", () => {
    expect(FLYOUT_POP_MS).toBeGreaterThanOrEqual(150);
    expect(FLYOUT_POP_MS).toBeLessThanOrEqual(200);
    const [x1, y1, x2, y2] = /^cubic-bezier\(([^)]*)\)$/.exec(FLYOUT_POP_EASING)![1]!.split(",").map(Number);
    expect([x1, x2].every((x) => x! >= 0 && x! <= 1)).toBe(true);
    expect(y1! > 0 && y2! <= 1).toBe(true);
    expect(FLYOUT_POP_FROM_SCALE).toBeGreaterThan(0);
    expect(FLYOUT_POP_FROM_SCALE).toBeLessThan(1);
    expect(FLYOUT_REDUCED_FADE_MS).toBeLessThanOrEqual(80);
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
