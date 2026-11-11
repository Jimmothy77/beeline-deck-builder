import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLYOUT_POP_EASING, FLYOUT_POP_FROM_SCALE, FLYOUT_POP_MS, FLYOUT_REDUCED_FADE_MS } from "@/lib/desktop";

// The pop-up animation lives in index.css; its timing comes from desktop.ts through --flyout-* custom properties.
const css = readFileSync(path.resolve(import.meta.dirname, "../index.css"), "utf8");
const keyframes = (name: string) => new RegExp(`@keyframes ${name} \\{([^}]*\\}[^}]*\\})\\s*\\}`).exec(css)?.[1] ?? "";

describe("flyout pop-up stylesheet", () => {
  it("keeps the stylesheet fallbacks in step with these constants", () => {
    expect(css).toContain(`.beeline-flyout {\n  animation: beeline-flyout-pop var(--flyout-pop-ms, ${FLYOUT_POP_MS}ms) var(--flyout-pop-ease, ${FLYOUT_POP_EASING}) both;\n}`);
    const pop = keyframes("beeline-flyout-pop");
    expect(pop).toContain(`from { opacity: 0; transform: scale(var(--flyout-pop-from, ${FLYOUT_POP_FROM_SCALE})); }`);
    expect(pop).toContain("to { opacity: 1; transform: scale(1); }");
    expect(css).toContain(`.beeline-flyout[data-flyout-motion="fade"] { animation: beeline-flyout-fade-in var(--flyout-fade-ms, ${FLYOUT_REDUCED_FADE_MS}ms) linear both; }`);
  });

  it("only fades with reduced motion: no scale anywhere in the fade", () => {
    const fade = keyframes("beeline-flyout-fade-in");
    expect(fade).toContain("opacity: 0");
    expect(fade).not.toContain("transform");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.beeline-flyout,\s*\.beeline-flyout\[data-flyout-motion\] \{ animation: beeline-flyout-fade-in var\(--flyout-fade-ms, \d+ms\) linear both; \}/);
  });

  it("has no flip left: no turn, no 3D faces, no back-face hiding", () => {
    for (const gone of ["rotateY", "beeline-flyout-flip", "beeline-flyout-grow", "preserve-3d", "backface-visibility", "--flyout-turn", "--flyout-flip", "beeline-flyout-back", "data-flyout-mode"]) {
      expect(css, gone).not.toContain(gone);
    }
  });
});
