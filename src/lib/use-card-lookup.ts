import { useCallback, useEffect, useState } from "react";
import type { CardFacts } from "@/lib/card-facts";

type Lookup = Readonly<Record<string, CardFacts>>;
let loaded: Lookup | null = null;
let loading: Promise<Lookup> | undefined;

/** How the lookup file is fetched. Tests swap it to simulate a failed load. */
let importLookup: () => Promise<{ CARD_LOOKUP: Lookup }> = () => import("@/data/card-lookup");

/** For tests: replace the import (null puts the real one back) and forget what was loaded. */
export function setCardLookupImportForTests(next: (() => Promise<{ CARD_LOOKUP: Lookup }>) | null) {
  importLookup = next ?? (() => import("@/data/card-lookup"));
  loaded = null;
  loading = undefined;
}

/**
 * Loads the static card facts (src/data/card-lookup.ts) as its own file, once. Never calls Scryfall.
 * A failed load (a dropped connection, a stale deploy) is not cached here: the next call tries again.
 * Try again imports the same chunk URL, and some browsers keep a failed module import for the life of
 * the page, so the note under the search box also says to reload the page, which always fetches afresh.
 * (Moving the facts to a JSON fetch would avoid that, but it would change the generated file, its
 * --check and the build; v0.1.31 keeps the chunk and the message says what to do.)
 */
export function loadCardLookup(): Promise<Lookup> {
  loading ??= importLookup()
    .then((module) => (loaded = module.CARD_LOOKUP))
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

export type CardLookupState = {
  /** The facts, or null while loading or after a failed load. */
  lookup: Lookup | null;
  /** The last load failed. */
  failed: boolean;
  /** Try loading again after a failure. */
  retry: () => void;
};

export function useCardLookup(): CardLookupState {
  const [lookup, setLookup] = useState<Lookup | null>(loaded);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (lookup) return;
    let live = true;
    loadCardLookup()
      .then((value) => {
        if (!live) return;
        setFailed(false);
        setLookup(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [lookup, attempt]);
  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);
  return { lookup, failed, retry };
}
