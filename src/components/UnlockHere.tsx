import { type RefObject, useEffect, useState } from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REDUCED_MOTION_MEDIA } from "@/lib/desktop";
import { unlockPlace, type UnlockPlace } from "@/lib/unlock-place";

/**
 * Floating "Unlock Here" button for the home page. It shows only while the unlock section is out of
 * view (IntersectionObserver), and the arrows point toward it. It sits bottom centre, clear of the Tour
 * button (bottom left) and of Back to top (bottom right, deck view only). Without IntersectionObserver
 * it stays hidden.
 */
export function UnlockHere({ target, focusTarget, hidden }: { target: RefObject<HTMLElement | null>; focusTarget?: RefObject<HTMLElement | null>; hidden?: boolean }) {
  const [place, setPlace] = useState<UnlockPlace>("in-view");

  useEffect(() => {
    const node = target.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setPlace(unlockPlace(entry));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);

  if (hidden || place === "in-view") return null;
  const Arrow = place === "above" ? ChevronsUp : ChevronsDown;
  return (
    <Button
      type="button"
      data-unlock-here={place}
      className="unlock-here fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 h-11 -translate-x-1/2 gap-1.5 rounded-full px-4 shadow-lg shadow-black/40"
      onClick={() => {
        const reduced = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_MEDIA).matches;
        target.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        focusTarget?.current?.focus({ preventScroll: true });
      }}
    >
      <Arrow className="unlock-here-arrow" aria-hidden="true" />
      Unlock Here
      <span className="sr-only">: go to Unlock a paid deck</span>
      <Arrow className="unlock-here-arrow" aria-hidden="true" />
    </Button>
  );
}
