import type { CSSProperties } from "react";
import { useState } from "react";
import type { FlipPlan, FlyoutPlacement } from "@/lib/desktop";
import { FLYOUT_FLIP_EASING, FLYOUT_FLIP_MS, FLYOUT_GROW_EASING, FLYOUT_GROW_MS } from "@/lib/desktop";
import { largeThumbSources, thumbSources } from "@/lib/thumb-load";

/** One card the flyout can show. `dfcBack` is the chosen back face of a double-faced card. */
export type FlyoutCard = { key: string; front?: string | null; dfcBack?: string | null; alt: string };

export type FlyoutShown = { card: FlyoutCard; placement: FlyoutPlacement; plan: FlipPlan };

function FlyoutImage({ id, alt }: { id: string; alt: string }) {
  const large = largeThumbSources(id);
  const [source, setSource] = useState(0);
  return (
    <>
      <img src={thumbSources(id)[0]} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      {source < large.length ? (
        <img
          src={large[source]}
          alt={alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setSource((value) => value + 1)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </>
  );
}

export function FlyoutLayer({ shown }: { shown: FlyoutShown }) {
  const { card, placement, plan } = shown;
  const front = card.front!;
  // A card with neither its own back nor a deck back spins with its front on both sides.
  const back = plan.turns > 0 ? (plan.backImage ?? front) : null;
  const style = {
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
    "--flyout-turn": `${plan.turns * 360}deg`,
    // Timing comes from desktop.ts so it is tested; the reduced-motion and fade rules in index.css do not use these.
    "--flyout-flip-ms": `${FLYOUT_FLIP_MS}ms`,
    "--flyout-flip-ease": FLYOUT_FLIP_EASING,
    "--flyout-grow-ms": `${FLYOUT_GROW_MS}ms`,
    "--flyout-grow-ease": FLYOUT_GROW_EASING,
    transformOrigin: placement.side === "left" ? "right center" : placement.side === "right" ? "left center" : "center",
  } as CSSProperties;
  return (
    <div
      aria-hidden="true"
      data-flyout=""
      data-flyout-mode={plan.mode}
      data-flyout-side={placement.side}
      data-flyout-faces={plan.faces.join(" ")}
      className="beeline-flyout pointer-events-none fixed z-[70]"
      style={style}
    >
      <div className="beeline-flyout-card" data-mode={plan.mode}>
        <div className="beeline-flyout-face" data-face="front">
          <FlyoutImage id={front} alt={card.alt} />
        </div>
        {back ? (
          <div className="beeline-flyout-face beeline-flyout-back" data-face="back">
            <FlyoutImage id={back} alt="" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
