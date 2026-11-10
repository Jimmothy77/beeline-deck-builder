import { describe, expect, it } from "vitest";
import { buildFlight, buildPath, containBox, DURATION_MS, isBehind, LOOPS, MERIDIAN_WINDOW, measureFrom, poseAt, trailDots } from "@/lib/flight";

// Desktop banner: card at the right, slot left of the wordmark.
const m = measureFrom({ width: 1100, height: 300 }, containBox({ left: 900, top: 40, width: 133, height: 200 }, { width: 437, height: 673 }), { left: 40, top: 40, width: 72, height: 72 });
const flight = buildFlight(m);

describe("bee flight", () => {
  it("makes exactly one loop around the card window, then swoops home and spirals into the slot", () => {
    expect(LOOPS).toBe(1);
    const { fig, swoop, spiral } = buildPath(m);
    const sweep = fig[fig.length - 1]!.t - fig[0]!.t;
    expect(sweep).toBeGreaterThan(2 * Math.PI);
    expect(sweep).toBeLessThan(4 * Math.PI);
    const xs = fig.map((pt) => pt.x);
    expect(Math.min(...xs)).toBeLessThan(m.win.left);
    expect(Math.max(...xs)).toBeGreaterThan(m.win.right);
    expect(swoop.length).toBeGreaterThan(0);
    const last = spiral[spiral.length - 1]!;
    expect(last.x).toBeCloseTo(m.land.x, 6);
    expect(last.y).toBeCloseTo(m.land.y, 6);
  });

  it("leaves the loop heading down and to the left", () => {
    const { fig, swoop } = buildPath(m);
    const exit = fig[fig.length - 1]!;
    const next = swoop[3]!;
    expect(next.x).toBeLessThan(exit.x);
    expect(next.y).toBeGreaterThan(exit.y);
    expect(exit.x).toBeLessThan(m.win.cx);
  });

  it("lands centred on the slot at the slot's size at t = 1, the reduced-motion pose", () => {
    const pose = poseAt(flight, 1);
    expect(pose.x + pose.width / 2).toBeCloseTo(m.land.x, 4);
    expect(pose.y + pose.height / 2).toBeCloseTo(m.land.y, 4);
    expect(pose.width).toBeCloseTo(72, 4);
    expect(pose.behind).toBe(false);
    expect(trailDots(flight, pose.dist, 1)).toEqual([]);
    expect(poseAt(flight, 7)).toEqual(pose);
  });

  it("only goes behind the card on the far half of the loop, never on the way home", () => {
    const behind = flight.pts.filter(isBehind);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.every((pt) => pt.kind === "fig")).toBe(true);
    for (let t = 0.6; t <= 1; t += 0.02) expect(poseAt(flight, t).behind).toBe(false);
  });

  it("moves forward along the path over time", () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const { dist } = poseAt(flight, t);
      expect(dist).toBeGreaterThanOrEqual(last - 1e-6);
      last = dist;
    }
    expect(last).toBeCloseTo(flight.total, 3);
    expect(DURATION_MS).toBeGreaterThan(2000);
  });

  it("uses the card window from the mockup", () => {
    expect(MERIDIAN_WINDOW).toEqual({ l: 0.119, t: 0.0773, r: 0.881, b: 0.9227 });
    const box = containBox({ left: 0, top: 0, width: 200, height: 200 }, { width: 437, height: 673 });
    expect(box.height).toBe(200);
    expect(box.width).toBeCloseTo(200 * (437 / 673), 6);
  });
});
