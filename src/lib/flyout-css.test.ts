import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLYOUT_FLIP_EASING, FLYOUT_FLIP_MS, FLYOUT_GROW_EASING, FLYOUT_GROW_MS } from "@/lib/desktop";

// The flyout animation lives in index.css; its timing comes from desktop.ts through --flyout-* custom properties.
const css = readFileSync(path.resolve(import.meta.dirname, "../index.css"), "utf8");

describe("flyout flip stylesheet", () => {
  it("keeps the stylesheet fallbacks in step with these constants, and reduced motion only fades", () => {
    expect(css).toContain(`var(--flyout-flip-ms, ${FLYOUT_FLIP_MS}ms) var(--flyout-flip-ease, ${FLYOUT_FLIP_EASING})`);
    expect(css).toContain(`var(--flyout-grow-ms, ${FLYOUT_GROW_MS}ms) var(--flyout-grow-ease, ${FLYOUT_GROW_EASING})`);
    // One continuous turn: the flip keyframes have only a start and an end, so there is no stop between flips.
    const flip = /@keyframes beeline-flyout-flip \{([^}]*\}[^}]*\})\s*\}/.exec(css)![1]!;
    expect(flip.match(/\{/g)).toHaveLength(2);
    expect(flip).toContain("rotateY(0deg)");
    expect(flip).toContain("rotateY(var(--flyout-turn, 720deg))");
    expect(css).toMatch(/\.beeline-flyout\[data-flyout-mode="fade"\] \{ animation: beeline-flyout-appear \d+ms ease-out both; \}/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.beeline-flyout,\s*\.beeline-flyout\[data-flyout-mode\] \{ animation: beeline-flyout-appear 160ms ease-out both; \}/);
  });
});
