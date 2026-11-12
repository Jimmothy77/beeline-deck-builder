export type UnlockPlace = "in-view" | "below" | "above";

/** Where the unlock section sits from an observer entry: in view, or past the bottom or top edge. */
export function unlockPlace(entry: Pick<IntersectionObserverEntry, "isIntersecting" | "boundingClientRect" | "rootBounds">): UnlockPlace {
  if (entry.isIntersecting) return "in-view";
  const viewTop = entry.rootBounds ? entry.rootBounds.top : 0;
  return entry.boundingClientRect.top >= viewTop ? "below" : "above";
}
