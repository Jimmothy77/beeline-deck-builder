import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { publicUrl } from "@/lib/download";
import { guardOverlay } from "@/lib/modal-guard";
import { frameUrl, SPLASH_READY_TIMEOUT_MS, splashLimitMs, type SplashChoice } from "@/lib/splash";

export type SplashEnd = "complete" | "skip" | "failed";

/** Where focus goes when the splash closes and its opener is gone: the deck heading, else the deck search. */
const SPLASH_FOCUS_AFTER = '[data-deck-heading], input[aria-label="Search this deck"]';

/**
 * The deck splash: a full-screen overlay that plays once when a deck is first opened in a session.
 * Click or tap anywhere, Esc, or the Skip button ends it. It only covers the page: the deck view is
 * already open underneath, nothing behind it can be reached while it shows (inert + a focus guard),
 * and it never changes a count or a save. A missing or failed asset ends it at once ("failed").
 */
export function Splash({ deckName, choice, reducedMotion, onDone }: { deckName: string; choice: SplashChoice; reducedMotion: boolean; onDone: (end: SplashEnd) => void }) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const doneRef = useRef(onDone);
  const finished = useRef(false);
  const [ready, setReady] = useState(choice.kind === "generic");
  const finishRef = useRef((end: SplashEnd) => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current(end);
  });
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });
  const finish = (end: SplashEnd) => finishRef.current(end);

  // Nothing behind the splash can be reached; focus goes to Skip and comes back afterwards.
  useEffect(() => {
    const opener = document.activeElement === document.body ? null : document.activeElement;
    const release = overlayRef.current ? guardOverlay(overlayRef.current, () => skipRef.current?.focus()) : () => undefined;
    skipRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRef.current("skip");
        return;
      }
      // Skip is the only control, so Tab never moves focus (not even out to the browser and back to the page).
      if (event.key === "Tab" || ((event.key === "Enter" || event.key === " ") && document.activeElement !== skipRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        skipRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      release();
      // The Build or Open button that opened the splash is usually gone by now (the deck list was
      // replaced by the deck view), so focus goes to the deck view's heading, or its search box.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else document.querySelector<HTMLElement>(SPLASH_FOCUS_AFTER)?.focus({ preventScroll: true });
    };
  }, []);

  // Close on its own once it has played (or held its still frame) for its time.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => finishRef.current("complete"), splashLimitMs(choice, reducedMotion));
    return () => window.clearTimeout(timer);
  }, [ready, choice, reducedMotion]);

  // An asset that never says it is ready (a 404 page, a broken file) is skipped.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => finishRef.current("failed"), SPLASH_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // A Frame Lab page reports "ready" and "end" with postMessage; only messages from our own frame count.
  useEffect(() => {
    if (choice.kind !== "frame") return;
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === "beeline-splash:ready") setReady(true);
      else if (type === "beeline-splash:end") finishRef.current("complete");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [choice]);

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${deckName}: opening`}
      data-splash=""
      data-splash-kind={choice.kind}
      data-splash-motion={reducedMotion ? "still" : "play"}
      className="beeline-splash fixed inset-0 z-[65] flex cursor-pointer items-center justify-center bg-[#0d0906]"
      style={choice.kind === "frame" && choice.background ? { backgroundColor: choice.background } : undefined}
      onClick={() => finish("skip")}
    >
      {choice.kind === "generic" ? (
        <div className="beeline-splash-generic pointer-events-none flex flex-col items-center gap-4 px-6 text-center" data-splash-generic="">
          <img src={publicUrl("brand/beespair-bee-yellow.svg")} alt="" className="h-20 w-20" onError={(event) => (event.currentTarget.style.display = "none")} />
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">BeeLine</p>
          <p className="font-heading text-3xl text-foreground sm:text-4xl">{deckName}</p>
        </div>
      ) : choice.kind === "image" ? (
        <img
          src={publicUrl(choice.src)}
          alt=""
          className="pointer-events-none max-h-full max-w-full object-contain"
          data-splash-asset=""
          onLoad={() => setReady(true)}
          onError={() => finish("failed")}
        />
      ) : (
        <iframe
          ref={frameRef}
          title={`${choice.label} splash`}
          src={publicUrl(frameUrl(choice.src, reducedMotion))}
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none h-full w-full border-0"
          data-splash-asset=""
          onError={() => finish("failed")}
        />
      )}
      <button
        ref={skipRef}
        type="button"
        data-splash-skip=""
        className="absolute right-4 bottom-4 rounded-full border border-primary/50 bg-card/90 px-4 py-2 text-sm shadow-lg"
        onClick={(event) => {
          event.stopPropagation();
          finish("skip");
        }}
      >
        Skip
      </button>
    </div>,
    document.body,
  );
}
