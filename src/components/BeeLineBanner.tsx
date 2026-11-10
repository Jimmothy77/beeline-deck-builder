import { useEffect, useRef } from "react";
import { publicUrl } from "@/lib/download";
import { BANNER_COPY, SHOP_URL } from "@/components/banner-copy";
import { buildFlight, containBox, DURATION_MS, measureFrom, poseAt, trailDots, type Flight } from "@/lib/flight";


const SVG_NS = "http://www.w3.org/2000/svg";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function relative(rect: DOMRect, to: DOMRect) {
  return { left: rect.left - to.left, top: rect.top - to.top, width: rect.width, height: rect.height };
}

/**
 * Honey banner with the meridian Leyline mark and the yellow bee.
 * Stacking: the card back is z 1, the bee is z 2 (behind) or 4, the card front is z 3.
 * The orbit box and .banner-top set no z-index, filter, opacity, or transform,
 * so they do not form a stacking context and the bee can weave between the layers.
 */
export function BeeLineBanner() {
  const bannerRef = useRef<HTMLElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLImageElement>(null);
  const frontRef = useRef<HTMLImageElement>(null);
  const beeRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const trailRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const banner = bannerRef.current;
    const slot = slotRef.current;
    const back = backRef.current;
    const front = frontRef.current;
    const bee = beeRef.current;
    const svg = svgRef.current;
    const trail = trailRef.current;
    if (!banner || !slot || !back || !front || !bee || !svg || !trail) return;
    let raf = 0;
    let cancelled = false;
    let playing = false;

    const measure = (): Flight => {
      const bannerRect = banner.getBoundingClientRect();
      const image = back.naturalWidth ? back : front;
      const box = containBox(relative(image.getBoundingClientRect(), bannerRect), { width: image.naturalWidth, height: image.naturalHeight });
      return buildFlight(measureFrom(bannerRect, box, relative(slot.getBoundingClientRect(), bannerRect)));
    };

    const apply = (flight: Flight, t: number) => {
      const pose = poseAt(flight, t);
      bee.style.width = `${pose.width}px`;
      bee.style.visibility = "visible";
      bee.style.transform = `translate(${pose.x}px, ${pose.y}px)`;
      bee.classList.toggle("behind", pose.behind);
      svg.setAttribute("viewBox", `0 0 ${flight.m.bw} ${flight.m.bh}`);
      while (trail.firstChild) trail.removeChild(trail.firstChild);
      for (const dot of trailDots(flight, pose.dist, t)) {
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", dot.cx.toFixed(2));
        circle.setAttribute("cy", dot.cy.toFixed(2));
        circle.setAttribute("r", dot.r.toFixed(2));
        circle.setAttribute("fill", "#3d2a18");
        circle.setAttribute("opacity", dot.opacity.toFixed(3));
        trail.appendChild(circle);
      }
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      playing = false;
    };

    const land = () => {
      stop();
      apply(measure(), 1);
    };

    const play = () => {
      stop();
      const flight = measure();
      const start = performance.now();
      playing = true;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION_MS);
        apply(flight, t);
        if (t < 1) raf = requestAnimationFrame(tick);
        else playing = false;
      };
      raf = requestAnimationFrame(tick);
    };

    const begin = () => {
      if (cancelled) return;
      if (prefersReducedMotion()) land();
      else play();
    };

    const decode = (img: HTMLImageElement) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve());
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve();
    void Promise.all([decode(back), decode(front), decode(bee), fonts]).then(() => requestAnimationFrame(() => requestAnimationFrame(begin)));

    const onResize = () => {
      if (playing) play();
      else land();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <header ref={bannerRef} className="beeline-banner">
      <div className="banner-top">
        <div ref={slotRef} className="brand-slot" aria-hidden="true" />
        <div className="banner-copy">
          <p className="kicker">{BANNER_COPY.kicker}</p>
          <h1 className="wordmark">{BANNER_COPY.title}</h1>
          <p className="tagline">{BANNER_COPY.tagline}</p>
          <p className="blurb">{BANNER_COPY.blurb}</p>
        </div>
        <div className="orbit" aria-hidden="true">
          <img ref={backRef} className="emblem-back" src={publicUrl("brand/meridian-back.png")} alt="" />
          <img ref={frontRef} className="emblem-front" src={publicUrl("brand/meridian-front.png")} alt="" />
        </div>
      </div>
      <p className="credits">
        Card designs and deck lists by <strong>Beespair</strong>. Standard prints are free. Deluxe and Partial Foil unlock from the Drive link on a Ko-fi order.
        <br />
        Head over to{" "}
        <a href={SHOP_URL} target="_blank" rel="noopener noreferrer">
          Beespair's Shop
        </a>{" "}
        to get your premium files if you haven't already.
      </p>
      <svg ref={svgRef} className="trail-svg" aria-hidden="true">
        <g ref={trailRef} />
      </svg>
      <img ref={beeRef} className="flyer" src={publicUrl("brand/beespair-bee-yellow.svg")} alt="" />
    </header>
  );
}
