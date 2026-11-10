import { type RefObject, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REDUCED_MOTION_MEDIA, backToTopVisible } from "@/lib/desktop";

/**
 * Floating "Back to top" button, desktop widths only (it would sit on the - / +
 * buttons on a phone). Hidden only at the very top of the page. After it scrolls
 * up, focus moves to `focusTarget` so keyboard users land at the top too.
 */
export function BackToTop({ focusTarget }: { focusTarget?: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(() => typeof window !== "undefined" && backToTopVisible(window.scrollY));

  useEffect(() => {
    const update = () => setVisible(backToTopVisible(window.scrollY));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;
  return (
    <Button
      type="button"
      data-back-to-top=""
      className="fixed right-6 bottom-6 z-40 hidden h-11 rounded-full px-4 shadow-lg shadow-black/40 lg:inline-flex"
      onClick={() => {
        const reduced = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_MEDIA).matches;
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        focusTarget?.current?.focus({ preventScroll: true });
      }}
    >
      <ArrowUp aria-hidden="true" /> Back to top
    </Button>
  );
}
