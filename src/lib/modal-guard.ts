/**
 * Keeps keyboard and pointer focus inside a full-screen overlay (the tour, the deck splash).
 *
 * - Every other child of <body> (the app root, toasts, other portals) gets the `inert` attribute while the
 *   overlay is open, so Tab, Enter and clicks can't reach controls behind it (Clear all, Save, …).
 *   Elements that were already inert are left as they were.
 * - A focusin guard sends focus back into the overlay if anything outside it still gets focus
 *   (a browser without `inert`, or a script calling .focus()).
 * Undo it with the returned function, before focus is given back to the page.
 */
export function guardOverlay(overlay: HTMLElement, focusInside: () => void): () => void {
  const doc = overlay.ownerDocument;
  const made: Element[] = [];
  for (const child of Array.from(doc.body.children)) {
    if (child === overlay || child.contains(overlay) || child.hasAttribute("inert")) continue;
    child.setAttribute("inert", "");
    made.push(child);
  }
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof Node && !overlay.contains(target)) focusInside();
  };
  doc.addEventListener("focusin", onFocusIn, true);
  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    for (const element of made) element.removeAttribute("inert");
  };
}

/** For a backdrop: pressing on it must not move focus out of the overlay (to <body>). */
export function keepFocusOnPress(event: { preventDefault: () => void }): void {
  event.preventDefault();
}
