import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { retryDelayMs, thumbGate, thumbSources, THUMB_RETRIES, type ThumbGate } from "@/lib/thumb-load";

export function CardThumb({
  id,
  alt,
  className,
  gate = thumbGate,
}: {
  id?: string | null;
  alt: string;
  className?: string;
  gate?: ThumbGate;
}) {
  const [visible, setVisible] = useState(false);
  const [slot, setSlot] = useState(false);
  const [source, setSource] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const held = useRef(false);
  const sources = id ? thumbSources(id) : [];

  useEffect(() => {
    const element = rootRef.current;
    if (!element || !id) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    if (!id || !visible) return;
    let cancel = false;
    held.current = false;
    void gate.acquire().then(() => {
      if (cancel) {
        gate.release();
        return;
      }
      held.current = true;
      setSlot(true);
    });
    return () => {
      cancel = true;
      if (held.current) {
        held.current = false;
        gate.release();
      }
    };
  }, [gate, id, visible]);

  function releaseSlot() {
    if (!held.current) return;
    held.current = false;
    gate.release();
  }

  const waiting = !id || failed || !slot;
  const src = sources[Math.min(source, sources.length - 1)];

  return (
    <div ref={rootRef} className={cn("w-full", className)}>
      {waiting || !src ? (
        <div className="flex aspect-[63/88] w-full items-center justify-center rounded-md bg-black/25 px-2 text-center text-[10px] leading-tight text-muted-foreground">
          {alt}
        </div>
      ) : (
        <img
          key={`${src}:${attempt}`}
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={releaseSlot}
          onError={() => {
            if (attempt + 1 < THUMB_RETRIES) {
              window.setTimeout(() => setAttempt((value) => value + 1), retryDelayMs(attempt));
              return;
            }
            if (source + 1 < sources.length) {
              setSource((value) => value + 1);
              setAttempt(0);
              return;
            }
            setFailed(true);
            releaseSlot();
          }}
          className="aspect-[63/88] w-full rounded-md bg-black/20 object-cover"
        />
      )}
    </div>
  );
}
