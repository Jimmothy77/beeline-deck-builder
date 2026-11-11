import { type FocusEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FLYOUT_MEDIA, REDUCED_MOTION_MEDIA, flyoutBack, flyoutLayout, flyoutPlacement, popOrigin } from "@/lib/desktop";
import { FlyoutLayer, type FlyoutShown } from "@/components/CardFlyout";

export type { FlyoutCard } from "@/components/CardFlyout";
import type { FlyoutCard } from "@/components/CardFlyout";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Keyboard focus only. A mouse click also focuses a button, and the hover already handled that. */
function keyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export type FlyoutBinding = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
};

/**
 * Desktop card-art flyout. Spread `bind(card)` on a thumbnail button and render
 * `layer` once. Opens on mouse hover or keyboard focus at desktop widths, never
 * on touch. Closes on leave, blur, Escape, click, scroll,
 * or resize. The layer ignores the pointer, so it never takes a click meant for
 * the - / + buttons.
 */
export function useCardFlyout() {
  const [shown, setShown] = useState<FlyoutShown | null>(null);
  const openRef = useRef(false);
  /** The thumbnail button the flyout belongs to. */
  const targetRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setShown(null), []);

  const show = useCallback(
    (card: FlyoutCard, target: HTMLElement) => {
      if (!card.front || !matches(FLYOUT_MEDIA)) return;
      const anchor = target.closest<HTMLElement>("[data-flyout-anchor]") ?? target;
      const rect = anchor.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const back = flyoutBack({ customBack: card.customBack, dfcBack: card.dfcBack });
      const layout = flyoutLayout(rect, viewport, back !== null);
      const placement = flyoutPlacement(rect, viewport, layout.size);
      const origin = popOrigin(target.getBoundingClientRect(), placement);
      targetRef.current = target;
      setShown({ card, placement, layout, back, origin, reducedMotion: matches(REDUCED_MOTION_MEDIA) });
    },
    [],
  );

  const isOpen = shown !== null;
  useEffect(() => {
    openRef.current = isOpen;
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(null);
    };
    const onMove = () => setShown(null);
    // A card can leave the page while it is hovered (a search hides it, a list switch, the overlay closing).
    // No pointerleave fires then, so close as soon as its button is no longer in the document.
    const gone = new MutationObserver(() => {
      if (!targetRef.current?.isConnected) setShown(null);
    });
    gone.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      gone.disconnect();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [isOpen]);

  const bind = (card: FlyoutCard): FlyoutBinding => ({
    onPointerEnter: (event) => {
      if (event.pointerType === "mouse") show(card, event.currentTarget);
    },
    onPointerLeave: close,
    onPointerDown: close,
    onFocus: (event) => {
      if (keyboardFocus(event.currentTarget)) show(card, event.currentTarget);
    },
    onBlur: close,
  });

  const layer = shown && typeof document !== "undefined" ? createPortal(<FlyoutLayer key={shown.card.key} shown={shown} />, document.body) : null;
  return { bind, layer, isOpen, openRef, close };
}

