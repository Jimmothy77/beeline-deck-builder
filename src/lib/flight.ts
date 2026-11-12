/**
 * The banner bee's flight, ported from the approved meridian mockup.
 * One loop around the meridian card window, exit down and to the left,
 * a swoop up across the banner, then a tight clockwise spiral into the slot
 * left of the wordmark. All points are in banner pixels.
 */

export type Point = { x: number; y: number };
export type PathPoint = Point & { t: number; kind: "fig" | "home" | "spiral" };

export type Box = { left: number; top: number; width: number; height: number };

/** Meridian card window inside the emblem image, as fractions of the image box. */
export const MERIDIAN_WINDOW = { l: 0.119, t: 0.0773, r: 0.881, b: 0.9227 } as const;

export const DURATION_MS = 4400;

/**
 * The flight is measured on the meridian art's original size (the v0.1.34 PNGs), not the shiny webp's
 * (292 x 450, a hair narrower), so the bee's path is pixel for pixel what it was before the logo changed.
 */
export const MERIDIAN_ART = { width: 437, height: 673 } as const;
export const LOOPS = 1;
const FLIGHT_WIDTH = 40;
const SPIRAL_START = 0.8;

export type Measure = {
  bw: number;
  bh: number;
  box: Box;
  win: { left: number; top: number; right: number; bottom: number; cx: number; cy: number; width: number; height: number };
  land: { x: number; y: number; s: number };
};

/** Where the image content sits inside an `object-fit: contain` box. */
export function containBox(element: Box, natural: { width: number; height: number }): Box {
  const nw = natural.width || 1;
  const nh = natural.height || 1;
  const scale = Math.min(element.width / nw, element.height / nh);
  const width = nw * scale;
  const height = nh * scale;
  return { left: element.left + (element.width - width) / 2, top: element.top + (element.height - height) / 2, width, height };
}

export function measureFrom(banner: { width: number; height: number }, box: Box, slot: Box): Measure {
  const w = MERIDIAN_WINDOW;
  const left = box.left + box.width * w.l;
  const top = box.top + box.height * w.t;
  const right = box.left + box.width * w.r;
  const bottom = box.top + box.height * w.b;
  return {
    bw: banner.width,
    bh: banner.height,
    box,
    win: { left, top, right, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2, width: right - left, height: bottom - top },
    land: { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2, s: slot.width },
  };
}

function sampleCubic(p0: Point, c1: Point, c2: Point, p3: Point, steps: number, kind: PathPoint["kind"], tRef: number, out: PathPoint[]) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
      t: tRef,
      kind,
    });
  }
}

export function buildPath(m: Measure): { fig: PathPoint[]; swoop: PathPoint[]; spiral: PathPoint[]; all: PathPoint[] } {
  const { win, box, land, bh } = m;
  const rx = Math.max(win.width * 0.5 + 22, box.width * 0.5 + 16);
  const ry = win.height * 0.52;
  const start = Math.PI / 2;
  // Leave at 7π/6: left of the card, still heading down-left.
  const exit = (7 * Math.PI) / 6;
  const end = start + LOOPS * 2 * Math.PI + (exit - start);
  const fig: PathPoint[] = [];
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = start + (end - start) * (i / steps);
    fig.push({ x: win.cx + rx * Math.sin(t), y: win.cy + ry * Math.sin(t) * Math.cos(t), t, kind: "fig" });
  }
  const last = fig[fig.length - 1]!;
  const tx = rx * Math.cos(last.t);
  const ty = ry * Math.cos(2 * last.t);
  const tlen = Math.hypot(tx, ty) || 1;
  const nx = tx / tlen;
  const ny = ty / tlen;

  // Tight clockwise spiral, starting just below the slot.
  const r0 = 28;
  const turns = 1.05;
  const theta0 = Math.PI / 2;
  const omega = 2 * Math.PI * turns;
  const A = { x: land.x + r0 * Math.cos(theta0), y: land.y + r0 * Math.sin(theta0) };
  let sx = -Math.cos(theta0) - omega * Math.sin(theta0);
  let sy = -Math.sin(theta0) + omega * Math.cos(theta0);
  const slen = Math.hypot(sx, sy) || 1;
  sx /= slen;
  sy /= slen;

  const yMax = Math.min(bh - 64, last.y + 48);
  const Q = { x: last.x + (A.x - last.x) * 0.36, y: Math.min(yMax, last.y + Math.max(28, (yMax - last.y) * 0.7)) };
  const troughT = { x: -1, y: 0.08 };
  const tt = Math.hypot(troughT.x, troughT.y);
  troughT.x /= tt;
  troughT.y /= tt;

  const span1 = Math.hypot(Q.x - last.x, Q.y - last.y);
  const span2 = Math.hypot(A.x - Q.x, A.y - Q.y);
  const swoop: PathPoint[] = [];
  sampleCubic(
    last,
    { x: last.x + nx * span1 * 0.45, y: Math.min(yMax, last.y + ny * span1 * 0.45) },
    { x: Q.x - troughT.x * span1 * 0.35, y: Q.y - troughT.y * span1 * 0.35 },
    Q,
    36,
    "home",
    end,
    swoop,
  );
  sampleCubic(Q, { x: Q.x + troughT.x * span2 * 0.38, y: Q.y + troughT.y * span2 * 0.38 }, { x: A.x - sx * span2 * 0.32, y: A.y - sy * span2 * 0.32 }, A, 48, "home", end, swoop);

  const spiral: PathPoint[] = [];
  const ss = 70;
  for (let i = 1; i <= ss; i++) {
    const s = i / ss;
    const th = theta0 + omega * s;
    const r = r0 * (1 - s);
    spiral.push({ x: land.x + r * Math.cos(th), y: land.y + r * Math.sin(th), t: end, kind: "spiral" });
  }
  return { fig, swoop, spiral, all: [...fig, ...swoop, ...spiral] };
}

export function polyLength(pts: Point[]): { len: number; acc: number[] } {
  let len = 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    acc.push(len);
  }
  return { len, acc };
}

export function atLength(pts: PathPoint[], acc: number[], dist: number): PathPoint {
  if (dist <= 0) return { ...pts[0]! };
  const total = acc[acc.length - 1]!;
  if (dist >= total) return { ...pts[pts.length - 1]! };
  let lo = 0;
  let hi = acc.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (acc[mid]! < dist) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const span = acc[i]! - acc[i - 1]! || 1;
  const u = (dist - acc[i - 1]!) / span;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t: a.t + (b.t - a.t) * u, kind: u < 1 ? a.kind : b.kind };
}

function hermiteEase(u: number, vNorm: number): number {
  const a = Math.min(2.8, Math.max(0.12, vNorm));
  const b = 3 - 2 * a;
  const c = a - 2;
  return a * u + b * u * u + c * u * u * u;
}

/** Loop and swoop at matched speed, then a quicker eased spiral. */
export function distanceForTime(figLen: number, swoopEnd: number, total: number, t: number): number {
  const swoopLen = Math.max(0, swoopEnd - figLen);
  const spiralLen = Math.max(0, total - swoopEnd);
  const t2 = SPIRAL_START;
  const body = figLen + swoopLen;
  const t1 = body > 0 ? t2 * (figLen / body) : t2 * 0.6;
  if (t <= t1) return (t / Math.max(t1, 1e-6)) * figLen;
  if (t <= t2) return figLen + ((t - t1) / Math.max(t2 - t1, 1e-6)) * swoopLen;
  const u = (t - t2) / (1 - t2);
  const vSwoop = swoopLen / Math.max(t2 - t1, 1e-6);
  const vNorm = (vSwoop * (1 - t2)) / Math.max(spiralLen, 1);
  return swoopEnd + Math.min(1, Math.max(0, hermiteEase(u, vNorm))) * spiralLen;
}

/** Bee width: flight size until the spiral, then it grows into the slot with a small settle. */
export function flightScale(landWidth: number, t: number): number {
  if (t <= SPIRAL_START) return FLIGHT_WIDTH;
  const u = (t - SPIRAL_START) / (1 - SPIRAL_START);
  let size = FLIGHT_WIDTH + (landWidth - FLIGHT_WIDTH) * hermiteEase(u, 1);
  if (u > 0.82) size *= 1 + 0.07 * Math.sin(Math.PI * Math.min(1, (u - 0.82) / 0.18));
  return size;
}

export function trailOpacity(t: number): number {
  if (t <= 0.02) return 0;
  if (t >= 0.94) return Math.max(0, 1 - (t - 0.94) / 0.06);
  return 1;
}

/** Behind the card's front layer on the far half of the loop. Never behind on the way home. */
export function isBehind(pt: PathPoint): boolean {
  if (pt.kind === "home" || pt.kind === "spiral") return false;
  return Math.cos(pt.t) < 0;
}

export type Flight = { pts: PathPoint[]; acc: number[]; figLen: number; swoopEnd: number; total: number; m: Measure };

export function buildFlight(m: Measure): Flight {
  const path = buildPath(m);
  const figM = polyLength(path.fig);
  const allM = polyLength(path.all);
  const spiralAt = path.all.findIndex((pt) => pt.kind === "spiral");
  const swoopEnd = spiralAt >= 0 ? allM.acc[spiralAt]! : allM.len;
  return { pts: path.all, acc: allM.acc, figLen: figM.len, swoopEnd, total: allM.len, m };
}

export type Pose = { x: number; y: number; width: number; height: number; behind: boolean; dist: number };

/** Bee box at time t in [0, 1]. t = 1 is the landed pose used for reduced motion. */
export function poseAt(flight: Flight, t: number): Pose {
  const clamped = Math.max(0, Math.min(1, t));
  const dist = distanceForTime(flight.figLen, flight.swoopEnd, flight.total, clamped);
  const pt = atLength(flight.pts, flight.acc, dist);
  const width = flightScale(flight.m.land.s, clamped);
  const height = width * (170 / 200);
  return { x: pt.x - width / 2, y: pt.y - height / 2, width, height, behind: isBehind(pt), dist };
}

/** Sixteen trail dots behind the bee, newest largest. */
export function trailDots(flight: Flight, dist: number, t: number): { cx: number; cy: number; r: number; opacity: number }[] {
  const fade = trailOpacity(t);
  if (fade <= 0.01 || dist <= 4) return [];
  const trailLen = 128;
  const start = Math.max(0, dist - trailLen);
  const n = 16;
  const dots: { cx: number; cy: number; r: number; opacity: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const d = start + trailLen * u;
    if (d > dist) continue;
    const p = atLength(flight.pts, flight.acc, d);
    dots.push({ cx: p.x, cy: p.y, r: 1.3 + 1.7 * u, opacity: (0.28 + 0.62 * u) * fade });
  }
  return dots;
}
