import { useEffect, useState } from "react";
import type { CardFacts } from "@/lib/card-facts";

type Lookup = Readonly<Record<string, CardFacts>>;
let loaded: Lookup | null = null;
let loading: Promise<Lookup> | null = null;

/** Loads the static card facts (src/data/card-lookup.ts) as its own file, once. Null until it has loaded. Never calls Scryfall. */
export function loadCardLookup(): Promise<Lookup> {
  loading ??= import("@/data/card-lookup").then((module) => (loaded = module.CARD_LOOKUP));
  return loading;
}

export function useCardLookup(): Lookup | null {
  const [lookup, setLookup] = useState<Lookup | null>(loaded);
  useEffect(() => {
    if (lookup) return;
    let live = true;
    void loadCardLookup().then((value) => live && setLookup(value));
    return () => {
      live = false;
    };
  }, [lookup]);
  return lookup;
}
