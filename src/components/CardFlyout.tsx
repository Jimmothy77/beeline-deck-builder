import type { CSSProperties } from "react";
import { useState } from "react";
import type { FlyoutBack, FlyoutLayout, FlyoutPlacement } from "@/lib/desktop";
import { FLYOUT_BACK_LABEL, FLYOUT_GAP, FLYOUT_POP_EASING, FLYOUT_POP_FROM_SCALE, FLYOUT_POP_MS, FLYOUT_REDUCED_FADE_MS } from "@/lib/desktop";
import { largeThumbSources, thumbSources } from "@/lib/thumb-load";

/** One card the flyout can show. `dfcBack` is the chosen back face of a double-faced card; `customBack` is a back picked in the card editor, which wins over both. */
export type FlyoutCard = { key: string; front?: string | null; dfcBack?: string | null; customBack?: string | null; alt: string };

export type FlyoutShown = {
  card: FlyoutCard;
  placement: FlyoutPlacement;
  layout: FlyoutLayout;
  back: FlyoutBack;
  /** Where the pop-up scales in from (the hovered thumbnail's centre), relative to its top-left corner. */
  origin: { x: number; y: number };
  reducedMotion: boolean;
};

const BACK_LABEL = { custom: "Chosen back", dfc: "Back face" } as const;

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

/**
 * The desktop card-art pop-up: the front up to 400px wide and, for a card with
 * its own back (a back picked in the card editor, or a double-faced card's back
 * face), that back beside it at half size with a label. No flip: it fades and
 * scales in from the thumbnail; with reduced motion it only fades, near-instantly.
 */
export function FlyoutLayer({ shown }: { shown: FlyoutShown }) {
  const { card, placement, layout, back, origin, reducedMotion } = shown;
  const front = card.front!;
  const style = {
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
    gap: FLYOUT_GAP,
    // The front sits next to the card row; the back goes on the far side.
    flexDirection: placement.side === "left" ? "row-reverse" : "row",
    // Timing comes from desktop.ts so it is tested; index.css has matching fallbacks.
    "--flyout-pop-ms": `${FLYOUT_POP_MS}ms`,
    "--flyout-pop-ease": FLYOUT_POP_EASING,
    "--flyout-pop-from": String(FLYOUT_POP_FROM_SCALE),
    "--flyout-fade-ms": `${FLYOUT_REDUCED_FADE_MS}ms`,
    transformOrigin: `${origin.x}px ${origin.y}px`,
  } as CSSProperties;
  return (
    <div
      aria-hidden="true"
      data-flyout=""
      data-flyout-motion={reducedMotion ? "fade" : "pop"}
      data-flyout-side={placement.side}
      data-flyout-back={back?.kind ?? "none"}
      className="beeline-flyout pointer-events-none fixed z-[70] flex items-start"
      style={style}
    >
      <div className="beeline-flyout-face relative shrink-0" data-face="front" style={{ width: layout.front.width, height: layout.front.height }}>
        <FlyoutImage id={front} alt={card.alt} />
      </div>
      {back && layout.back ? (
        <figure className="m-0 flex shrink-0 flex-col items-center gap-1" data-face="back" style={{ width: layout.back.width, height: layout.back.height + FLYOUT_BACK_LABEL }}>
          <div className="beeline-flyout-face relative" style={{ width: layout.back.width, height: layout.back.height }}>
            <FlyoutImage id={back.image} alt="" />
          </div>
          <figcaption className="beeline-flyout-label rounded-full px-2 text-xs font-medium" data-flyout-label="">
            {BACK_LABEL[back.kind]}
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
