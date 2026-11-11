import { useEffect, useMemo, useRef, useState } from "react";
import { BuilderBoundary, BuilderView } from "@/components/BuilderView";
import { HomeView, type DeckChoice } from "@/components/HomeView";
import { Splash } from "@/components/Splash";
import { Tour, TourButton, TourPrompt, type TourViewResult } from "@/components/Tour";
import { SPLASH_ASSETS, SPLASH_FALLBACK } from "@/data/splash-assets";
import { treatmentsFor } from "@/data/treatments";
import { bundledDecklistsFor, freshDraft } from "@/lib/draft";
import { assertApiKey, parentFolderName, parseDriveFolderId, readConfigKey, readDecklistTexts, readDriveTree } from "@/lib/drive";
import { downloadText, publicUrl, xmlFilename } from "@/lib/download";
import { artIdsOf, assignPartialFoilThumbs, catalogueFromTree, pdfIdsInEdition } from "@/lib/group";
import { preferDeckName } from "@/lib/names";
import { selectionToSlots } from "@/lib/selection";
import {
  exportSavedJson,
  forgetUnlocked,
  importSavedJson,
  LEGACY_BACKUP_KEY,
  loadSaved,
  loadUnlocked,
  mergeCatalogues,
  mergeSaved,
  packHash,
  resolveSavedDeck,
  restoreLegacyBackup,
  upsertUnlocked,
  writeSaved,
  writeUnlocked,
  type SavedDeck,
  type UnlockedPack,
} from "@/lib/storage";
import { rememberSplash, shouldPlaySplash, splashFor, type SplashChoice } from "@/lib/splash";
import { rememberTourAnswer, shouldOfferTour, TOUR_IN_DECK_INTRO, TOUR_STEPS, type TourStep, type TourView } from "@/lib/tour";
import type { DeckCatalogue, DeckIndex, Edition } from "@/lib/types";
import { assertIdsAllowed, splitExportByPrintType } from "@/lib/xml";

/** sessionStorage, or null where it can't even be reached (some privacy modes throw on access). */
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function keyReady(): boolean {
  try {
    assertApiKey(readConfigKey());
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [shipped, setShipped] = useState<DeckCatalogue[]>([]);
  const [unlocked, setUnlocked] = useState<UnlockedPack[]>([]);
  const [saved, setSaved] = useState<SavedDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "builder">("home");
  const [session, setSession] = useState<SavedDeck | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [legacyBackup, setLegacyBackup] = useState(false);
  const [offerTour, setOfferTour] = useState(() => shouldOfferTour(localStorage));
  const [touring, setTouring] = useState(false);
  /** Where the tour started, and whether it opened a deck to show the deck view (put back when it ends). */
  const tourStart = useRef<{ view: "home" | "builder"; session: SavedDeck | null; opened: string | null }>({ view: "home", session: null, opened: null });
  const [tourSteps, setTourSteps] = useState<TourStep[]>(TOUR_STEPS);
  const [tourIntro, setTourIntro] = useState<string | null>(null);
  /** The deck splash showing now, if any. */
  const [splash, setSplash] = useState<{ deckName: string; choice: SplashChoice; reducedMotion: boolean } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setUnlocked(loadUnlocked(localStorage));
        setSaved(loadSaved(localStorage));
        const indexRes = await fetch(publicUrl("decks/index.json"));
        if (!indexRes.ok) throw new Error("The deck index didn't load.");
        const index = (await indexRes.json()) as DeckIndex;
        const decks: DeckCatalogue[] = [];
        for (const entry of index.decks ?? []) {
          const res = await fetch(publicUrl(entry.file));
          if (!res.ok) throw new Error(`Couldn't load ${entry.name}.`);
          decks.push((await res.json()) as DeckCatalogue);
        }
        if (!cancel) {
          setShipped(decks);
          try {
            setLegacyBackup(Boolean(localStorage.getItem(LEGACY_BACKUP_KEY)));
          } catch {
            setLegacyBackup(false);
          }
        }
      } catch (caught) {
        if (!cancel) setError(caught instanceof Error ? caught.message : "Couldn't load decks.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const merged = useMemo(() => mergeCatalogues(shipped, unlocked), [shipped, unlocked]);
  const savedNotes = useMemo(() => {
    const notes = new Map<string, string>();
    if (loading) return notes;
    for (const deck of saved) {
      const note = resolveSavedDeck(deck, unlocked, merged).note;
      if (note) notes.set(deck.id, note);
    }
    return notes;
  }, [loading, merged, saved, unlocked]);

  useEffect(() => {
    if (loading || !session) return;
    const resolved = resolveSavedDeck(session, unlocked, merged);
    if (!resolved.note && resolved.edition && (resolved.deck.editionName !== session.editionName || resolved.deck.editionId !== session.editionId || resolved.deck.packHash !== session.packHash)) {
      setSession(resolved.deck);
    }
  }, [loading, merged, unlocked, session]);

  const foil: DeckChoice[] = [];
  const partial: DeckChoice[] = [];
  for (const deck of merged) {
    for (const edition of deck.editions) {
      const choice = { deck, edition };
      if (edition.printType === "partial_foil") partial.push(choice);
      else foil.push(choice);
    }
  }

  function locate(draft: SavedDeck): { deck: DeckCatalogue; edition: Edition; saved: SavedDeck; note: string | null } | { note: string } {
    const resolved = resolveSavedDeck(draft, unlocked, merged);
    if (!resolved.catalogue || !resolved.edition) {
      return { note: resolved.note ?? "That saved deck's files aren't loaded. If it was a paid folder, unlock it again on this device." };
    }
    return { deck: resolved.catalogue, edition: resolved.edition, saved: resolved.deck, note: resolved.note };
  }

  const located = session ? locate(session) : null;
  const building = view === "builder" && session && located && "edition" in located ? { draft: located.saved, edition: located.edition } : null;

  function remember(next: SavedDeck[]): false | string | null {
    setSaved(next);
    try {
      const notice = writeSaved(localStorage, next);
      try {
        setLegacyBackup(Boolean(localStorage.getItem(LEGACY_BACKUP_KEY)));
      } catch {
        setLegacyBackup(false);
      }
      return notice;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save on this device.");
      return false;
    }
  }

  function exportDeck(draft: SavedDeck) {
    try {
    const found = locate(draft);
    if (!("edition" in found)) {
      setError(found.note);
      return;
    }
    if (found.note) setToast(found.note);
    try {
      const treatment = treatmentsFor(found.edition.printType).some((item) => item.name === draft.treatment) ? draft.treatment : null;
      const cardback = found.saved.cardbackId || found.edition.backs[0]?.id || "";
      const slots = selectionToSlots(found.edition, found.saved.cards, {
        printFlipBacksAsFronts: found.saved.printFlipBacksAsFronts === true,
        cardBacks: found.saved.cardBacks,
        cardback,
      });
      assertIdsAllowed(slots, cardback, artIdsOf(found.edition));
      const [xml] = splitExportByPrintType({
        slots: slots.map((slot) => ({ ...slot, printType: found.edition.printType })),
        cardback,
        deck: found.saved.deckName,
        treatment,
        foil: Boolean(treatment),
        pdfIds: pdfIdsInEdition(found.edition),
      });
      if (!xml) throw new Error("Nothing to export yet.");
      downloadText(xmlFilename(found.saved.name, found.edition.printType, treatment, found.saved.id), xml);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export that deck.");
    }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export that deck.");
    }
  }

  function startTour() {
    tourStart.current = { view, session, opened: null };
    // Started in a deck: only the deck-view steps, so the deck view stays mounted and keeps its search,
    // its Clear undo and everything else. Going to the deck list would unmount it.
    const inDeck = building !== null;
    setTourSteps(inDeck ? TOUR_STEPS.filter((step) => step.view === "builder") : TOUR_STEPS);
    setTourIntro(inDeck ? TOUR_IN_DECK_INTRO : null);
    setTouring(true);
  }

  /**
   * Plays the deck's splash the first time it is opened this session (Build, a saved deck, Continue).
   * The tour's preview deck never calls this, and the splash isn't drawn while the tour is open.
   */
  function openDeckSplash(deckId: string, deckName: string) {
    const store = sessionStore();
    if (!shouldPlaySplash(store, deckId)) return;
    if (!rememberSplash(store, deckId)) return;
    setSplash({ deckName, choice: splashFor(deckId, SPLASH_ASSETS, SPLASH_FALLBACK), reducedMotion: reducedMotion() });
  }

  /** Shows a tour step's view. The deck view uses the deck being built; with none, it opens the first deck as an unsaved preview. */
  function showTourView(target: TourView): TourViewResult {
    if (target === "home") {
      setView("home");
      return { ok: true };
    }
    const opened = tourStart.current.opened;
    if (opened) {
      setView("builder");
      return { ok: true, note: `The tour opened ${opened} to show this. Nothing is saved, and you go back where you were when the tour ends.` };
    }
    const current = session ? locate(session) : null;
    if (current && "edition" in current) {
      setView("builder");
      return { ok: true };
    }
    const first = foil[0] ?? partial[0];
    if (!first) return { ok: false };
    tourStart.current.opened = first.deck.name;
    setSession(freshDraft(first.deck, first.edition));
    setView("builder");
    return { ok: true, note: `The tour opened ${first.deck.name} to show this. Nothing is saved, and you go back where you were when the tour ends.` };
  }

  function endTour() {
    const start = tourStart.current;
    setTouring(false);
    if (start.opened) setSession(start.session);
    setView(start.view);
  }

  async function unlock(url: string) {
    setUnlockBusy(true);
    setError(null);
    try {
      const apiKey = assertApiKey(readConfigKey());
      const folderId = parseDriveFolderId(url);
      if (!folderId) throw new Error("Paste a Google Drive folder link, the kind on a Ko-fi order page.");
      const tree = await readDriveTree(folderId, apiKey);
      const parent = await parentFolderName(folderId, apiKey).catch(() => null);
      const decklistTexts = await readDecklistTexts(tree, apiKey);
      const deckName = preferDeckName(tree.name, parent);
      const catalogue = assignPartialFoilThumbs(
        catalogueFromTree(tree, deckName, [], { decklistTexts, bundledDecklists: bundledDecklistsFor(shipped, deckName) }),
        [...shipped, ...unlocked.map((item) => item.catalogue)],
      );
      const pack: UnlockedPack = {
        packHash: packHash(folderId),
        folderId,
        savedAt: new Date().toISOString(),
        catalogue,
      };
      const next = upsertUnlocked(unlocked, pack);
      setUnlocked(next);
      writeUnlocked(localStorage, next);
      const labels = catalogue.editions.map((edition) => `${catalogue.name} ${edition.name}`).join(", ");
      setToast(`Unlocked ${labels}. It stays in this browser.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock that folder.");
    } finally {
      setUnlockBusy(false);
    }
  }

  return (
    <div className="min-h-svh bg-[radial-gradient(900px_420px_at_0%_-10%,oklch(0.45_0.08_75/0.35),transparent_60%),radial-gradient(700px_380px_at_100%_0%,oklch(0.45_0.05_210/0.28),transparent_55%)]">
      {building ? (
        <BuilderBoundary onBack={() => setView("home")}>
        <BuilderView
          draft={building.draft}
          edition={building.edition}
          notice={located && "note" in located ? located.note : null}
          onChange={setSession}
          onBack={() => setView("home")}
          onSave={() => {
            const stamped = { ...building.draft, updatedAt: new Date().toISOString() };
            setSession(stamped);
            const notice = remember(mergeSaved(saved, [stamped]));
            if (notice !== false) setToast(notice ?? `Saved “${stamped.name}”.`);
          }}
          onSaveNew={() => {
            const copy: SavedDeck = {
              ...building.draft,
              id: crypto.randomUUID(),
              name: `${building.draft.name} copy`,
              updatedAt: new Date().toISOString(),
            };
            setSession(copy);
            const notice = remember(mergeSaved(saved, [copy]));
            if (notice !== false) setToast(notice ?? `Saved a new deck, “${copy.name}”.`);
          }}
          onToast={setToast}
        />
        </BuilderBoundary>
      ) : (
        <HomeView
          loading={loading}
          error={error}
          foil={foil}
          partial={partial}
          saved={saved}
          legacyNotes={savedNotes}
          sessionLabel={session ? session.name : null}
          keyReady={keyReady()}
          unlockBusy={unlockBusy}
          onBuild={(choice) => {
            setError(null);
            setSession(freshDraft(choice.deck, choice.edition));
            setView("builder");
            openDeckSplash(choice.deck.id, choice.deck.name);
          }}
          onContinue={() => {
            if (!session) return;
            setView("builder");
            openDeckSplash(session.deckId, session.deckName);
          }}
          onUnlock={(url) => void unlock(url)}
          onForgetUnlocks={() => {
            try {
              forgetUnlocked(localStorage);
              setUnlocked([]);
              setToast("Unlocked folders were forgotten on this device.");
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Couldn't update storage on this device.");
            }
          }}
          onOpenSaved={(deck) => {
            const found = locate(deck);
            if (!("edition" in found)) {
              setError(found.note);
              return;
            }
            setError(null);
            setSession(found.saved);
            setView("builder");
            openDeckSplash(found.deck.id, found.deck.name);
            if (found.note) setToast(found.note);
          }}
          onDeleteSaved={(id) => remember(saved.filter((deck) => deck.id !== id))}
          onExportSaved={exportDeck}
          legacyBackup={legacyBackup}
          onRestoreBackup={() => {
            if (!window.confirm("Replace the saved decks on this device with the original copy from before they were converted?")) return;
            try {
              const restored = restoreLegacyBackup(localStorage);
              if (!restored) {
                setError("No original copy is stored on this device.");
                return;
              }
              setSaved(restored);
              setLegacyBackup(true);
              setToast("Restored the original saved decks.");
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Couldn't restore the original save.");
            }
          }}
          onExportJson={() => downloadText("beeline-decks.json", exportSavedJson(saved), "application/json")}
          onImportJson={(file) => {
            void file.text().then((text) => {
              try {
                const incoming = importSavedJson(text);
                const notice = remember(mergeSaved(saved, incoming));
                if (notice !== false) setToast(notice ?? `Imported ${incoming.length} saved ${incoming.length === 1 ? "deck" : "decks"}.`);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not import that file.");
              }
            });
          }}
        />
      )}
      {!loading && offerTour && !touring && !splash ? (
        <TourPrompt
          onTake={() => {
            rememberTourAnswer(localStorage, "taken");
            setOfferTour(false);
            startTour();
          }}
          onDecline={() => {
            rememberTourAnswer(localStorage, "declined");
            setOfferTour(false);
            setToast("No problem. The Tour button at the bottom left shows it any time.");
          }}
        />
      ) : null}
      {/* Stays mounted under the tour, so focus can go back to it when the tour ends. */}
      {!loading ? <TourButton onClick={startTour} /> : null}
      {touring ? <Tour steps={tourSteps} intro={tourIntro} onNeedView={showTourView} onClose={endTour} /> : null}
      {/* The splash comes first: the first-run prompt waits under it, and the tour can't start while it shows. */}
      {splash && !touring ? <Splash deckName={splash.deckName} choice={splash.choice} reducedMotion={splash.reducedMotion} onDone={() => setSplash(null)} /> : null}
      {toast && (
        <p role="status" className="fixed top-4 right-4 left-4 z-50 mx-auto max-w-md rounded-2xl border border-primary/40 bg-card px-4 py-3 text-sm shadow-2xl sm:left-auto">
          {toast}
        </p>
      )}
    </div>
  );
}
