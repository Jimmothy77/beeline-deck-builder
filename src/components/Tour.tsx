import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CircleQuestionMark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findTourTarget, type TourStep, type TourView } from "@/lib/tour";

/**
 * A small in-house coach-mark tour (no library). Each step highlights the real control with a cut-out ring
 * and a short caption, with Back, Next and Skip. Esc closes it at any point. It only looks: the page under it
 * can't be clicked while it is open, and it never changes a count or a saved deck.
 */

/** What the app did to show a step's view: ok = the view is up (a note says what it opened, if anything). */
export type TourViewResult = { ok: boolean; note?: string | null };

type Rect = { top: number; left: number; width: number; height: number };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PAD = 6;

function measure(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
}

const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

export function Tour({ steps, onNeedView, onClose }: { steps: TourStep[]; onNeedView: (view: TourView) => TourViewResult; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [viewOk, setViewOk] = useState(true);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  const needViewRef = useRef(onNeedView);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    needViewRef.current = onNeedView;
  });
  const step = steps[index]!;
  const last = index === steps.length - 1;

  // Remember what had focus, and give it back when the tour closes. Started from the first-run prompt, whose
  // buttons are gone by then, focus goes to the Tour button instead.
  useEffect(() => {
    opener.current = document.activeElement === document.body ? null : document.activeElement;
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else document.querySelector<HTMLElement>("[data-tour-button]")?.focus();
    };
  }, []);

  // Esc closes the tour from anywhere, before anything else on the page sees the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Show the step's view, then wait a moment for its control to appear. A control that never shows up
  // (the deck view's Add cards tab is open, say) gets the caption on its own, in the middle of the screen.
  useEffect(() => {
    const shown = needViewRef.current(step.view);
    setViewOk(shown.ok);
    setNote(shown.note ?? null);
    setRect(null);
    setMissing(false);
    targetRef.current = null;
    let tries = 0;
    let timer = 0;
    const look = () => {
      const found = shown.ok ? findTourTarget(step.targets) : null;
      if (found) {
        targetRef.current = found;
        found.scrollIntoView?.({ block: "center", inline: "nearest" });
        setRect(measure(found));
      } else if (++tries < 20) {
        timer = window.setTimeout(look, 50);
      } else setMissing(true);
    };
    look();
    nextRef.current?.focus();
    return () => window.clearTimeout(timer);
  }, [step]);

  // Keep the ring on the control while the page scrolls or resizes.
  useEffect(() => {
    const update = () => {
      const target = targetRef.current;
      if (!target) return;
      const next = target.isConnected ? measure(target) : null;
      setRect((current) => (sameRect(current, next) ? current : next));
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const timer = window.setInterval(update, 300);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.clearInterval(timer);
    };
  }, []);

  // Tab stays inside the caption.
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const items = [...(captionRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0]!;
    const end = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      end.focus();
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault();
      first.focus();
    } else if (!items.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  const phone = window.innerWidth < 640;
  const viewportHeight = window.innerHeight;
  let captionStyle: CSSProperties;
  if (!rect) captionStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  else if (phone) captionStyle = rect.top + rect.height / 2 > viewportHeight / 2 ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
  else {
    const below = rect.top + rect.height + 12;
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - 400));
    captionStyle = below + 220 < viewportHeight ? { left, top: below } : { left, top: Math.max(16, rect.top - 12), transform: "translateY(-100%)" };
  }
  const titleId = `tour-title-${step.id}`;

  return createPortal(
    <div data-tour-overlay="" className="fixed inset-0 z-[60]">
      {/* Blocks the page while the tour is open; clicking it does nothing. */}
      <div className={`absolute inset-0 ${rect ? "" : "bg-black/60"}`} aria-hidden="true" />
      {rect ? (
        <div
          data-tour-ring=""
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-all duration-200"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }}
        />
      ) : null}
      <div
        ref={captionRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-body`}
        data-tour-step={step.id}
        onKeyDown={trapTab}
        className="fixed w-auto max-w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-primary/50 bg-card p-4 text-sm shadow-2xl sm:w-96"
        style={captionStyle}
      >
        <p className="text-xs font-semibold tracking-[0.14em] uppercase text-primary">
          Step {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="font-heading mt-1 text-xl">
          {step.title}
        </h2>
        <p id={`${titleId}-body`} className="mt-1 text-muted-foreground">
          {step.body}
        </p>
        {note ? <p className="mt-2 text-xs text-amber-200/90" data-tour-note="">{note}</p> : null}
        {missing || !viewOk ? (
          <p className="mt-2 text-xs text-amber-200/90" data-tour-missing="">
            {step.view === "builder" ? "This control is in the deck view, on the Deck tab. Open a deck to see it there." : "This control isn't on screen right now."}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" className="px-2 text-muted-foreground" onClick={() => onClose()}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              Back
            </Button>
            <Button ref={nextRef} type="button" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The first-run question. Not modal: the page stays usable behind it. Esc answers No thanks. */
export function TourPrompt({ onTake, onDecline }: { onTake: () => void; onDecline: () => void }) {
  const takeRef = useRef<HTMLButtonElement | null>(null);
  const declineRef = useRef(onDecline);
  useLayoutEffect(() => {
    declineRef.current = onDecline;
  });
  useEffect(() => {
    takeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      declineRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="tour-prompt-title" data-tour-prompt="" className="fixed right-3 bottom-3 left-3 z-[55] mx-auto max-w-md rounded-2xl border border-primary/50 bg-card p-4 shadow-2xl sm:right-auto sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2">
      <h2 id="tour-prompt-title" className="font-heading text-xl">
        New to BeeLine? Want a quick tour?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Six short steps: picking a deck, unlocking a paid one, card art and backs, and the search and filters. It changes nothing.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button ref={takeRef} type="button" onClick={onTake}>
          Take the tour
        </Button>
        <Button type="button" variant="outline" onClick={onDecline}>
          No thanks
        </Button>
      </div>
    </div>
  );
}

/** Replays the tour at any time. */
export function TourButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" data-tour-button="" aria-label="Take the tour" title="Take the tour" className="fixed bottom-4 left-4 z-40 h-10 rounded-full bg-card/90 px-3 shadow-lg shadow-black/40" onClick={onClick}>
      <CircleQuestionMark /> <span className="hidden sm:inline">Tour</span>
    </Button>
  );
}
