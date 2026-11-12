import { canShowFoil, FOIL_CAPTION, FOIL_MAPS_MISSING_NOTE, foilMapsMissing, foilView, NO_FOIL_MAP, readShowFoil, writeShowFoil } from "@/lib/foil-maps";
import { Component, type ReactNode, useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Copy, Dices, Download, Eraser, Lock, LockOpen, Save, SlidersHorizontal, Undo2 } from "lucide-react";
import { BackToTop } from "@/components/BackToTop";
import { CardFilterPanel } from "@/components/CardFilterPanel";
import type { FlyoutCard } from "@/components/CardFlyout";
import { useCardFlyout, type FlyoutBinding } from "@/components/use-card-flyout";
import { SideTile } from "@/components/SideTile";
import { CardThumb } from "@/components/thumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { treatmentsFor } from "@/data/treatments";
import { usesSideTile } from "@/lib/desktop";
import { downloadText, xmlFilename } from "@/lib/download";
import { factsFor, type FactsStatus } from "@/lib/card-facts";
import { attributeFilters, EMPTY_FILTER, formatQuery, isFilterActive, matchCard, parseQuery, withoutAttributeFilters, type CardFilter, type FilterResult } from "@/lib/card-filter";
import { clearCounts, clearMessage, clearSummary, type ClearScope } from "@/lib/clear";
import { decklistNotes, findDecklist, isBasicCard, withDecklist } from "@/lib/decklist";
import { artIdsOf, pdfIdsInEdition } from "@/lib/group";
import {
  applyListQuantities,
  applyTone,
  artsOf,
  chosenArt,
  copyCount,
  droppedSavedCardIds,
  hasToneChoice,
  newPair,
  oversizedDeckWarning,
  randomizeUnlocked,
  selectAllCards,
  selectionToSlots,
  activeBackOverrides,
  backOptions,
  BACK_KINDS,
  toneCardBacks,
  type ArtQty,
  type BackKind,
  type BackOption,
  type SavedCard,
} from "@/lib/selection";
import type { SavedDeck } from "@/lib/storage";
import { isTokenCard } from "@/lib/tokens";
import { useCardLookup } from "@/lib/use-card-lookup";
import type { CardBack, DeckCard, Edition } from "@/lib/types";
import { assertIdsAllowed, bracketFor, splitExportByPrintType } from "@/lib/xml";

/** Sets or clears the back printed on every copy of one card. The map is dropped when it empties, so the save looks like an older one. */
function withCardBack(draft: SavedDeck, cardId: string, fileId: string | null): SavedDeck {
  const next = { ...(draft.cardBacks ?? {}) };
  if (fileId) next[cardId] = fileId;
  else delete next[cardId];
  const rest: SavedDeck = { ...draft };
  delete rest.cardBacks;
  return Object.keys(next).length ? { ...rest, cardBacks: next } : rest;
}

/** "color", "color or type", "color, type or mana value". */
/** "the color filter is", "the color and type filters are". */
const unusedFacts = (items: string[]) => `the ${items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`} ${items.length === 1 ? "filter is" : "filters are"}`;
const orList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

/** The time a change is saved with. Called from event handlers only. */
const nowStamp = () => new Date().toISOString();

/** The three back lists in the card editor. */
const BACK_LABELS: Record<BackKind, string> = { cardback: "Card Back", alt: "Alt Back", token: "Token Backs" };

export class BuilderBoundary extends Component<{ onBack: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-heading text-2xl">This deck could not be opened</h1>
        <p className="mt-3 text-sm text-muted-foreground">{this.state.error.message}</p>
        <button type="button" className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={this.props.onBack}>
          Back to decks
        </button>
      </div>
    );
  }
}

/** sessionStorage, or null where it can't be reached (some privacy modes throw on access). */
function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function BuilderView({
  draft,
  edition: baseEdition,
  notice,
  onChange,
  onBack,
  onSave,
  onSaveNew,
  onToast,
}: {
  draft: SavedDeck;
  edition: Edition;
  notice?: string | null;
  onChange: (draft: SavedDeck) => void;
  onBack: () => void;
  onSave: () => void;
  onSaveNew: () => void;
  onToast: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** The last Clear all or Clear shown. Any other change in the builder ends it, so Undo never throws away a later edit. */
  const [cleared, setCleared] = useState<{ scope: ClearScope; deckId: string; before: SavedCard[]; after: string; status: string; undo: string } | null>(null);
  const [artTarget, setArtTarget] = useState<{ cardId: string; pairIndex: number; side: "front" | "back" } | null>(null);
  const [backsOpen, setBacksOpen] = useState(false);
  /** The back list shown in the card editor. Null opens on the list of the card's current pick, or Card Back. */
  const [backTab, setBackTab] = useState<BackKind | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // "Show foiled area": one switch for the session, shown only on an unlocked Partial Foil edition.
  const [showFoil, setShowFoil] = useState(() => readShowFoil(sessionStore()));
  const foilable = canShowFoil(baseEdition);
  const foilOn = foilable && showFoil;
  const foilMissing = foilable && foilMapsMissing(baseEdition);
  // Only thumbnails change (thumbId); export, counts and ids read the same edition either way.
  const edition = useMemo(() => (foilOn ? foilView(baseEdition) : baseEdition), [foilOn, baseEdition]);
  const foilCaptionId = useId();

  const byId = useMemo(() => new Map(draft.cards.map((card) => [card.cardId, card])), [draft.cards]);
  const treatmentOptions = treatmentsFor(edition.printType);
  const treatment = treatmentOptions.some((item) => item.name === draft.treatment) ? draft.treatment : null;
  let copies = 0;
  let resolveNote: string | null = notice ?? null;
  try {
    const dropped = droppedSavedCardIds(edition, draft.cards);
    copies = selectionToSlots(edition, draft.cards, {
      printFlipBacksAsFronts: draft.printFlipBacksAsFronts === true,
      cardBacks: draft.cardBacks,
    }).length;
    if (dropped.length && !resolveNote) resolveNote = "Some saved cards were dropped.";
  } catch (error) {
    resolveNote = error instanceof Error ? error.message : "Some saved cards were dropped.";
  }
  let bracket = "";
  try {
    bracket = copies > 0 ? String(bracketFor(copies)) : "";
  } catch (error) {
    bracket = error instanceof Error ? error.message : "Too many cards";
  }
  const back = edition.backs.find((item) => item.id === draft.cardbackId) ?? edition.backs[0];
  const deckId = draft.deckId;
  // Hand token decisions (src/data/token-overrides.ts) are per deck, so the deck id goes with every token test.
  const tokenTest = useCallback((card: DeckCard) => isTokenCard(card, deckId), [deckId]);
  const overrides = useMemo(() => activeBackOverrides(edition, draft.cardBacks, tokenTest), [edition, draft.cardBacks, tokenTest]);
  const flyout = useCardFlyout();
  const topRef = useRef<HTMLButtonElement | null>(null);
  // The search box reads a Scryfall-style query; plain words search card names, as before.
  const parsed = useMemo(() => parseQuery(query), [query]);
  const { lookup, failed: lookupFailed, retry: retryLookup } = useCardLookup();
  const needsFacts = attributeFilters(parsed.filter).length > 0;
  // If the card data couldn't load, the filters that need it are not applied (rather than hiding every card); the note under the box says so.
  const filter = useMemo(() => (lookupFailed ? withoutAttributeFilters(parsed.filter) : parsed.filter), [lookupFailed, parsed.filter]);
  const filtering = isFilterActive(filter);
  const results = useMemo(() => {
    const out = new Map<string, { result: FilterResult; status: FactsStatus }>();
    for (const card of edition.cards) {
      const { status, facts } = lookup ? factsFor(card, lookup) : { status: "unmatched" as const, facts: null };
      const subject = {
        names: [card.name, ...card.faces.map((face) => face.name), ...(facts ? [facts.scryfall] : [])],
        role: card.role,
        dfc: card.faces.length === 2,
        basic: isBasicCard(card),
        copies: copyCount(byId.get(card.id)),
        status,
        facts,
      };
      out.set(card.id, { result: matchCard(subject, filter), status });
    }
    return out;
  }, [edition.cards, lookup, filter, byId]);
  const shown = (card: DeckCard) => results.get(card.id)?.result === "shown";
  const mains = edition.cards.filter((card) => card.role === "main" && shown(card));
  const tokens = edition.cards.filter((card) => card.role === "token" && shown(card));
  const extras = edition.cards.filter((card) => card.role === "extra" && shown(card));
  const leftOut = lookup && needsFacts ? edition.cards.filter((card) => results.get(card.id)?.result === "unknown").length : 0;
  // The "unmatched" marker only shows while filtering, so the plain deck view looks as before.
  const factsMark = (card: DeckCard): FactsStatus | undefined => {
    const status = results.get(card.id)?.status;
    return filtering && lookup && status !== "matched" ? status : undefined;
  };
  const shownIds = new Set([...mains, ...tokens, ...extras].map((card) => card.id));
  const allSummary = clearSummary(draft.cards);
  const shownSummary = clearSummary(draft.cards, shownIds);
  const undoable = cleared && cleared.deckId === draft.id && cleared.after === JSON.stringify(draft.cards) ? cleared : null;
  const lists = edition.decklists ?? [];
  const list = findDecklist(edition, draft.decklistId);
  const listed = withDecklist(edition, list);
  const listNotes = list ? decklistNotes(edition, list) : [];
  const toneChoice = hasToneChoice(edition);
  const tone = toneChoice ? (draft.tone ?? "color") : null;
  const infoNotes = [...edition.notes, ...listNotes].filter((note) => note.level === "info");
  const sizeWarning = oversizedDeckWarning(listed);
  const ambiguous = [...edition.notes, ...listNotes].filter((note) => note.level === "ambiguous");

  function commit(next: SavedDeck) {
    setCleared(null);
    onChange({ ...next, updatedAt: nowStamp() });
  }

  function writeCard(card: DeckCard, pairs: ArtQty[], locked = byId.get(card.id)?.locked ?? false) {
    const cards = draft.cards.filter((item) => item.cardId !== card.id);
    if (pairs.length) cards.push({ cardId: card.id, locked, pairs });
    commit({ ...draft, cards });
  }

  function changePair(card: DeckCard, index: number, qty: number) {
    const saved = byId.get(card.id);
    if (!saved?.pairs.length) {
      if (qty > 0) writeCard(card, [newPair(card, qty, tone)]);
      return;
    }
    const pairs = saved.pairs.map((pair, item) => (item === index ? { ...pair, qty } : pair)).filter((pair) => pair.qty > 0);
    writeCard(card, pairs, saved.locked);
  }

  function addPair(card: DeckCard) {
    const saved = byId.get(card.id);
    const pairs = [...(saved?.pairs ?? []), newPair(card, 1, tone)];
    writeCard(card, pairs, saved?.locked ?? false);
  }

  function closeEditor() {
    setArtTarget(null);
    setBackTab(null);
  }

  function chooseArt(card: DeckCard, pairIndex: number, side: "front" | "back", artId: string) {
    const saved = byId.get(card.id);
    const pairs = (saved?.pairs ?? []).map((pair, index) => (index === pairIndex ? { ...pair, [side === "back" ? "back" : "art"]: artId } : pair));
    writeCard(card, pairs.length ? pairs : [{ ...newPair(card, 1, tone), ...(side === "back" ? { back: artId } : { art: artId }) }], saved?.locked ?? false);
    closeEditor();
  }

  function setFilter(next: CardFilter) {
    setQuery(formatQuery(next));
  }

  function runClear(scope: ClearScope) {
    const ids = scope === "shown" ? shownIds : undefined;
    const done = clearSummary(draft.cards, ids);
    const after = clearCounts(draft.cards, ids);
    commit({ ...draft, cards: after });
    setCleared({ scope, deckId: draft.id, before: draft.cards, after: JSON.stringify(after), ...clearMessage(scope, done) });
  }

  function undoClear() {
    if (!undoable) return;
    commit({ ...draft, cards: undoable.before });
    setCleared(null);
    onToast(undoable.scope === "all" ? "Restored every count from before Clear all." : "Restored the counts from before Clear shown.");
  }

  function pickCardBack(card: DeckCard, fileId: string | null) {
    commit(withCardBack(draft, card.id, fileId));
  }

  function runAll() {
    commit({ ...draft, cards: selectAllCards(edition, draft.cards, tone) });
    onToast("Added 1 of each missing card; kept your existing picks.");
  }

  function runRandom() {
    const mainsOnly = edition.cards.filter((card) => card.role === "main");
    const locked = mainsOnly.filter((card) => byId.get(card.id)?.locked).length;
    if (locked === mainsOnly.length && mainsOnly.length > 0) {
      onToast("Every main-deck card is locked, so nothing was rerolled.");
      return;
    }
    commit({ ...draft, cards: randomizeUnlocked(listed, draft.cards, Math.random, tone) });
    onToast(`New art for ${mainsOnly.length - locked} unlocked card${mainsOnly.length - locked === 1 ? "" : "s"}. ${locked} locked.`);
  }

  function chooseList(id: string) {
    const next = lists.find((item) => item.id === id);
    if (!next || next.id === list?.id) return;
    commit({ ...draft, decklistId: next.id, cards: applyListQuantities(withDecklist(edition, next), draft.cards, tone) });
    onToast(`Opened the ${next.label} list. Locked cards kept their counts.`);
  }

  function chooseTone(next: "color" | "bw") {
    if (next === tone) return;
    const cardBacks = toneCardBacks(edition, draft.cardBacks, next);
    commit({ ...draft, tone: next, cards: applyTone(edition, draft.cards, next), ...(cardBacks ? { cardBacks: { ...cardBacks } } : {}) });
    onToast(next === "bw" ? "Switched the option cards to Black and White." : "Switched the option cards to Color.");
  }

  function openExport() {
    setXml(null);
    setXmlError(null);
    setExportOpen(true);
    try {
      const cardback = draft.cardbackId || edition.backs[0]?.id || "";
      const slots = selectionToSlots(edition, draft.cards, {
        printFlipBacksAsFronts: draft.printFlipBacksAsFronts === true,
        cardBacks: draft.cardBacks,
        cardback,
      });
      assertIdsAllowed(slots, cardback, artIdsOf(edition));
      const [xml] = splitExportByPrintType({
        slots: slots.map((slot) => ({ ...slot, printType: edition.printType })),
        cardback,
        deck: draft.deckName,
        treatment,
        foil: Boolean(treatment),
        stock: "(S30) Standard Smooth",
        pdfIds: pdfIdsInEdition(edition),
      });
      if (!xml) throw new Error("Nothing to export yet.");
      setXml(xml);
    } catch (error) {
      setXmlError(error instanceof Error ? error.message : "Could not build the XML.");
    }
  }

  const artCard = artTarget ? edition.cards.find((card) => card.id === artTarget.cardId) : undefined;
  const artFace = artTarget?.side === "back" ? artCard?.faces[1] : artCard?.faces[0];
  const artOptions = artFace ? artsOf(artFace) : [];
  const artPair = artTarget ? byId.get(artTarget.cardId)?.pairs[artTarget.pairIndex] : undefined;
  const artBacks = artCard ? backOptions(edition, artCard.id, tone, tokenTest) : null;
  const artOverride = artCard ? overrides.get(artCard.id) : undefined;
  const artBackTab: BackKind = backTab ?? artOverride?.kind ?? "cardback";
  const artOwnBack = artCard?.faces[1];
  const sectionLabel = edition.printType === "partial_foil" ? "Partial Foil" : "Foil / Non-Foil";

  const deckPane = (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl">Deck</h2>
        <p className="text-xs text-muted-foreground" data-shown-count="">
          {mains.length} shown
          {leftOut ? ` · ${leftOut} left out: Scryfall has no clear ${orList(attributeFilters(filter))} for ${leftOut === 1 ? "it" : "them"} (unmatched or ambiguous names)` : ""}
        </p>
      </div>
      {mains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No main-deck cards match that search.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
          {mains.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              saved={byId.get(card.id)}
              customBack={overrides.get(card.id)}
              mark={factsMark(card)}
              showLock
              flyout={flyout.bind}
              onQty={(index, qty) => changePair(card, index, qty)}
              onLock={(locked) => writeCard(card, byId.get(card.id)?.pairs ?? [], locked)}
              onArt={(index, side) => setArtTarget({ cardId: card.id, pairIndex: index, side })}
              onAdd={() => addPair(card)}
            />
          ))}
        </ul>
      )}
    </div>
  );

  const addPane = (
    <div className="flex flex-col gap-6">
      <AddGroup title="Tokens" cards={tokens} empty={filtering ? "No tokens match the filter." : "No tokens in this deck."} byId={byId} overrides={overrides} mark={factsMark} flyout={flyout.bind} onQty={(card, index, qty) => changePair(card, index, qty)} onArt={(card, index, side) => setArtTarget({ cardId: card.id, pairIndex: index, side })} onAdd={(card) => addPair(card)} />
      <AddGroup title="Extras" cards={extras} empty={filtering ? "No extras match the filter." : "No sideboard or extra cards in this deck."} byId={byId} overrides={overrides} mark={factsMark} flyout={flyout.bind} onQty={(card, index, qty) => changePair(card, index, qty)} onArt={(card, index, side) => setArtTarget({ cardId: card.id, pairIndex: index, side })} onAdd={(card) => addPair(card)} />
    </div>
  );

  // Desktop side column: a long Extras (or Tokens) list becomes one tile that opens an overlay.
  const sideGroup = (kind: "tokens" | "extras", title: string, cards: DeckCard[], empty: string) =>
    usesSideTile(kind, cards.length) ? (
      <SideTile
        kind={kind}
        title={title}
        cards={cards}
        byId={byId}
        flyoutOpen={flyout.openRef}
        onFlyoutClose={flyout.close}
        renderItem={(card) => (
          <AddItem
            key={card.id}
            card={card}
            saved={byId.get(card.id)}
            customBack={overrides.get(card.id)}
            mark={factsMark(card)}
            flyout={flyout.bind}
            onQty={(index, qty) => changePair(card, index, qty)}
            onArt={(index, side) => setArtTarget({ cardId: card.id, pairIndex: index, side })}
            onAdd={() => addPair(card)}
          />
        )}
      />
    ) : (
      <AddGroup title={title} cards={cards} empty={empty} byId={byId} overrides={overrides} mark={factsMark} flyout={flyout.bind} onQty={(card, index, qty) => changePair(card, index, qty)} onArt={(card, index, side) => setArtTarget({ cardId: card.id, pairIndex: index, side })} onAdd={(card) => addPair(card)} />
    );

  const desktopAddPane = (
    <div className="flex flex-col gap-6">
      {sideGroup("tokens", "Tokens", tokens, filtering ? "No tokens match the filter." : "No tokens in this deck.")}
      {sideGroup("extras", "Extras", extras, filtering ? "No extras match the filter." : "No sideboard or extra cards in this deck.")}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:max-w-[96rem]">
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={topRef} type="button" variant="ghost" onClick={onBack}>
          <ChevronLeft /> Decks
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.16em] text-primary uppercase">{sectionLabel}</p>
          <h1 className="font-heading truncate text-3xl outline-none sm:text-4xl" tabIndex={-1} data-deck-heading="">
            {draft.deckName} <span className="text-muted-foreground">{edition.name}</span>
          </h1>
        </div>
      </div>
      {resolveNote ? <p className="rounded-2xl border border-amber-300/40 bg-amber-200/10 px-4 py-3 text-sm text-amber-100">{resolveNote}</p> : null}

      <div className="grid gap-3 rounded-3xl border border-border bg-card/70 p-4 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Saved name</span>
          <Input value={draft.name} onChange={(event) => commit({ ...draft, name: event.target.value })} className="h-10" />
        </label>
        {lists.length > 1 && list ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Deck list</span>
            <Select value={list.id} onValueChange={chooseList}>
              <SelectTrigger className="h-10 w-full" aria-label="Deck list">
                <SelectValue placeholder="Choose a list" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : list ? (
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Deck list</span>
            <p className="flex h-10 items-center truncate">{list.label}</p>
          </div>
        ) : null}
        {toneChoice && (
          <div className="grid gap-1 text-sm" role="group" aria-label="Print set">
            <span className="text-muted-foreground">Print set</span>
            <div className="inline-flex h-10 rounded-lg border border-border p-0.5">
              <Button type="button" size="sm" variant={tone === "color" ? "default" : "ghost"} aria-pressed={tone === "color"} className="h-full" onClick={() => chooseTone("color")}>
                Color
              </Button>
              <Button type="button" size="sm" variant={tone === "bw" ? "default" : "ghost"} aria-pressed={tone === "bw"} className="h-full" onClick={() => chooseTone("bw")}>
                Black and White
              </Button>
            </div>
          </div>
        )}
        {foilable && (
          <div className="grid gap-1 self-end text-sm" data-foil-switch="">
            <div className="flex h-10 items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={foilOn}
                aria-describedby={foilOn ? foilCaptionId : undefined}
                onClick={() => {
                  writeShowFoil(sessionStore(), !foilOn);
                  setShowFoil(!foilOn);
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${foilOn ? "bg-primary" : "bg-muted"}`}
              >
                <span className="sr-only">Show foiled area</span>
                <span aria-hidden="true" className={`inline-block size-4 rounded-full bg-background shadow transition-transform ${foilOn ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <span aria-hidden="true">Show foiled area</span>
            </div>
            {foilOn ? (
              <p id={foilCaptionId} data-foil-caption="" className="text-xs text-muted-foreground">
                {FOIL_CAPTION}
                {foilMissing ? <span className="mt-1 block text-amber-100" data-foil-missing="">{FOIL_MAPS_MISSING_NOTE}</span> : null}
              </p>
            ) : null}
          </div>
        )}
        {edition.printType === "partial_foil" && (
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={draft.printFlipBacksAsFronts === true}
              onChange={(event) => commit({ ...draft, printFlipBacksAsFronts: event.target.checked })}
            />
            <span>
              Print flip backs as fronts
              <span className="mt-1 block text-xs text-muted-foreground">
                Also prints the back face of each double-faced main card, flip card, and token as its own card when that back is a partial-foil PDF. A back without that PDF stays on the back of the card.
              </span>
            </span>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Treatment</span>
          <Select value={treatment ?? "none"} onValueChange={(value) => commit({ ...draft, treatment: value === "none" ? null : value })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="No treatment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No treatment</SelectItem>
              {treatmentOptions.map((item) => (
                <SelectItem key={item.id} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Card back</span>
          <Button type="button" variant="outline" className="h-10 justify-start" onClick={() => setBacksOpen(true)}>
            {back ? <img src={`https://drive.google.com/thumbnail?id=${encodeURIComponent(back.thumbId)}&sz=w400`} alt="" referrerPolicy="no-referrer" className="h-7 w-5 rounded-sm object-cover" /> : null}
            <span className="truncate">{back?.name ?? "Choose a back"}</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={runAll}>
          All cards
        </Button>
        <Button type="button" variant="secondary" onClick={runRandom}>
          <Dices /> Random
        </Button>
        <Button type="button" variant="outline" data-tour="clear" disabled={allSummary.copies === 0} title="Set every card in this deck to 0, tokens and extras too. You can undo it." onClick={() => runClear("all")}>
          <Eraser /> Clear all
        </Button>
        {filtering ? (
          <Button type="button" variant="outline" disabled={shownSummary.copies === 0} title="Set only the cards the filter shows to 0. Cards the filter hides keep their counts. You can undo it." onClick={() => runClear("shown")}>
            <Eraser /> Clear shown ({shownSummary.cards})
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onSave}>
          <Save /> Save
        </Button>
        <Button type="button" variant="outline" onClick={onSaveNew}>
          Save as new
        </Button>
        <Button type="button" onClick={openExport}>
          <Download /> Export XML
        </Button>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {copies} {copies === 1 ? "card" : "cards"}
          {bracket && !bracket.includes(" ") ? ` · bracket ${bracket}` : bracket ? ` · ${bracket}` : ""}
        </p>
      </div>

      {undoable ? (
        <div role="status" data-clear-undo="" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/40 bg-card px-4 py-2 text-sm">
          <span>{undoable.status}</span>
          <Button type="button" size="sm" onClick={undoClear}>
            <Undo2 /> {undoable.undo}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex gap-2">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this deck" aria-label="Search this deck" className="h-10" />
          <Button type="button" variant={filtersOpen ? "secondary" : "outline"} className="h-10 shrink-0" aria-expanded={filtersOpen} aria-label="Filters" onClick={() => setFiltersOpen(!filtersOpen)}>
            <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>
          </Button>
        </div>
        {parsed.unknown.length ? (
          <p className="text-xs text-amber-200" data-query-unknown="">
            Not understood, so not used: {parsed.unknown.join(", ")}
          </p>
        ) : null}
        {lookupFailed ? (
          <p className="text-xs text-amber-200" role="status" data-lookup-failed="">
            The card data couldn't load, so {needsFacts ? `${unusedFacts(attributeFilters(parsed.filter))} not applied: the list shows every card that matches the rest of the search` : "the color, type, mana value, rarity, rules text, power and toughness filters can't be used right now"}.{" "}
            <button type="button" className="underline" onClick={retryLookup}>
              Try again
            </button>
            , or reload the page if that doesn't work.
          </p>
        ) : needsFacts && !lookup ? (
          <p className="text-xs text-muted-foreground">Loading card data…</p>
        ) : null}
        {filtersOpen ? <CardFilterPanel filter={parsed.filter} onChange={setFilter} onReset={() => setQuery(formatQuery(EMPTY_FILTER))} /> : null}
      </div>

      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        {deckPane}
        <aside className="lg:sticky lg:top-4 lg:self-start">{desktopAddPane}</aside>
      </div>
      <Tabs defaultValue="deck" className="lg:hidden">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="deck">Deck</TabsTrigger>
          <TabsTrigger value="add">Add cards</TabsTrigger>
        </TabsList>
        <TabsContent value="deck" className="pt-3">
          {deckPane}
        </TabsContent>
        <TabsContent value="add" className="pt-3">
          {addPane}
        </TabsContent>
      </Tabs>

      {sizeWarning && (
        <p role="status" className="rounded-2xl border border-primary/40 bg-card px-4 py-3 text-sm">
          {sizeWarning}
        </p>
      )}

      {infoNotes.length > 0 && (
        <ul className="grid gap-2 rounded-2xl border border-border bg-card/70 px-4 py-3 text-sm">
          {infoNotes.map((note) => (
            <li key={`${note.path}:${note.name}`}>
              <span className="font-medium">{note.name}.</span> {note.reason}
            </li>
          ))}
        </ul>
      )}

      {ambiguous.length > 0 && (
        <details className="rounded-2xl border border-border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Names the catalogue couldn't place ({ambiguous.length})</summary>
          <ul className="mt-3 grid gap-2 text-muted-foreground">
            {ambiguous.map((note) => (
              <li key={`${note.path}:${note.name}`}>
                <span className="text-foreground">{note.name}.</span> {note.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="pb-6 text-xs text-muted-foreground lg:pb-20">Card designs by Beespair. A deck list sets the opening counts, basic lands included. Without a list, basic lands never open at 0. Main-deck tokens never open at 0. Random rerolls unlocked main-deck cards to one print. All cards does the same, and leaves a black-and-white-only card at zero until you add it. Add another art when you want a second file of the same card.</p>

      <Dialog open={Boolean(artFace)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{artFace?.name}</DialogTitle>
            <DialogDescription>Choose the art for this face. The deck's own file is marked In deck.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {artOptions.map((art) => {
              const selected = (artTarget?.side === "back" ? artPair?.back : artPair?.art) === art.id;
              const inDeck = art.id === artFace?.defaultArt?.id;
              return (
                <li key={art.id}>
                  <button
                    type="button"
                    onClick={() => artCard && artTarget && chooseArt(artCard, artTarget.pairIndex, artTarget.side, art.id)}
                    className={`w-full rounded-xl border p-2 text-left ${selected ? "border-primary ring-2 ring-primary" : "border-border"}`}
                  >
                    <CardThumb id={art.thumbId} alt={art.label} tag={art.noFoilMap ? NO_FOIL_MAP : undefined} />
                    <span className="mt-2 block text-xs leading-snug">{art.label}</span>
                    {inDeck && (
                      <Badge variant="secondary" className="mt-1">
                        In deck
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {artCard && artBacks ? (
            <CardBackSection ownBack={artOwnBack?.name ?? null} deckBack={back ?? null} options={artBacks} override={artOverride} tab={artBackTab} onTab={setBackTab} onPick={(fileId) => pickCardBack(artCard, fileId)} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={backsOpen} onOpenChange={setBacksOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Card back</DialogTitle>
            <DialogDescription>Printed on every card in this order that doesn't have its own back face or a back picked in its card editor.</DialogDescription>
          </DialogHeader>
          {edition.backs.length === 0 ? (
            <p className="text-sm text-muted-foreground">This deck didn't include any card backs.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {edition.backs.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      commit({ ...draft, cardbackId: item.id });
                      setBacksOpen(false);
                    }}
                    className={`w-full rounded-xl border p-2 text-left ${item.id === draft.cardbackId ? "border-primary ring-2 ring-primary" : "border-border"}`}
                  >
                    <CardThumb id={item.thumbId} alt={item.name} />
                    <span className="mt-2 block text-xs">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export XML</DialogTitle>
            <DialogDescription>
              {draft.deckName} · {edition.printType}
              {treatment ? ` · ${treatment}` : " · no treatment"}. Other tools ignore the printabee block, which BeeLine keeps under that name so Leyline can read it.
            </DialogDescription>
          </DialogHeader>
          {xmlError && <p className="text-sm text-destructive">{xmlError}</p>}
          {xml && (
            <>
              <Label htmlFor="xml-out" className="sr-only">
                Order XML
              </Label>
              <Textarea
                id="xml-out"
                readOnly
                value={xml}
                wrap="off"
                className="h-72 font-mono text-xs [field-sizing:fixed] whitespace-pre"
              />
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!xml}
              onClick={() => {
                if (!xml) return;
                void navigator.clipboard.writeText(xml);
                onToast("XML copied.");
              }}
            >
              <Copy /> Copy
            </Button>
            <Button
              type="button"
              disabled={!xml}
              onClick={() => xml && downloadText(xmlFilename(draft.name, edition.printType, treatment, draft.id), xml)}
            >
              <Download /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {flyout.layer}
      <BackToTop focusTarget={topRef} />
    </div>
  );
}

/**
 * "Back for this card" in the card editor: Card Back, Alt Back and Token
 * Backs, the current pick, and a way back to the default. A double-faced card
 * says that a pick replaces its own back face.
 */
function CardBackSection({
  ownBack,
  deckBack,
  options,
  override,
  tab,
  onTab,
  onPick,
}: {
  ownBack: string | null;
  deckBack: CardBack | null;
  options: Record<BackKind, BackOption[]>;
  override?: BackOption;
  tab: BackKind;
  onTab: (kind: BackKind) => void;
  onPick: (fileId: string | null) => void;
}) {
  const list = options[tab];
  return (
    <section aria-labelledby="card-back-heading" data-back-override="" className="mt-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="card-back-heading" className="font-heading text-lg">
          Back for this card
        </h3>
        {override ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onPick(null)}>
            {ownBack ? "Use its own back face" : "Use the deck back"}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground" data-back-status="">
        {override
          ? `Every copy prints with ${override.label} on the back.`
          : ownBack
            ? `Every copy prints with its own back face, ${ownBack}.`
            : `Every copy prints with the deck back${deckBack ? `, ${deckBack.name}` : ""}.`}
      </p>
      {ownBack ? (
        <p role="note" className="mt-2 rounded-lg border border-amber-300/40 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
          This is a double-faced card. It keeps its own back face unless you pick a back here. A pick replaces {ownBack} on every copy, so that face isn't printed.
        </p>
      ) : null}
      <div role="group" aria-label="Back type" className="mt-3 flex flex-wrap gap-1 rounded-lg border border-border p-0.5 sm:inline-flex">
        {BACK_KINDS.map((kind) => (
          <Button key={kind} type="button" size="sm" variant={tab === kind ? "default" : "ghost"} aria-pressed={tab === kind} disabled={options[kind].length === 0} onClick={() => onTab(kind)}>
            {BACK_LABELS[kind]} <span className="tabular-nums opacity-70">{options[kind].length}</span>
          </Button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{tab === "token" ? "No tokens in this deck." : tab === "alt" ? "No extras other than tokens in this deck." : "This deck didn't include any card backs."}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={BACK_LABELS[tab]}>
          {list.map((option) => {
            const selected = override?.id === option.id;
            return (
              <li key={`${option.kind}:${option.id}`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(option.id)}
                  className={`w-full rounded-xl border p-2 text-left ${selected ? "border-primary ring-2 ring-primary" : "border-border"}`}
                >
                  <CardThumb id={option.thumbId} alt={option.label} />
                  <span data-back-label="" className="mt-2 block text-xs leading-snug">
                    {option.label}
                  </span>
                  {option.kind === "cardback" && option.id === deckBack?.id ? (
                    <Badge variant="secondary" className="mt-1">
                      Deck back
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A small line under the name, only when the card has its own back pick, so tiles without one look as before. */
function CustomBackBadge({ option }: { option?: BackOption }) {
  if (!option) return null;
  return (
    <Badge variant="outline" data-custom-back="" className="mt-1 max-w-full truncate border-primary/60 text-[0.7rem]" title={`Back: ${option.label}`}>
      Back: {option.label}
    </Badge>
  );
}

/** While filtering: a card Scryfall had no clear match for. Name search still finds it; the attribute filters leave it out. */
function FactsMark({ mark }: { mark?: FactsStatus }) {
  if (!mark || mark === "matched") return null;
  return (
    <Badge variant="outline" data-facts-mark={mark} className="mt-1 border-amber-300/50 text-[0.7rem] text-amber-100" title={mark === "unmatched" ? "Scryfall has no card by this name, so the color, type and other filters leave it out." : "Several Scryfall cards share this name, so filters on the facts they don't agree on leave it out."}>
      {mark}
    </Badge>
  );
}

function CardTile({
  card,
  saved,
  customBack,
  mark,
  showLock,
  flyout,
  onQty,
  onLock,
  onArt,
  onAdd,
}: {
  card: DeckCard;
  saved?: SavedCard;
  customBack?: BackOption;
  mark?: FactsStatus;
  showLock: boolean;
  flyout?: (card: FlyoutCard) => FlyoutBinding;
  onQty: (index: number, qty: number) => void;
  onLock: (locked: boolean) => void;
  onArt: (index: number, side: "front" | "back") => void;
  onAdd: () => void;
}) {
  const pairs = saved?.pairs?.length ? saved.pairs : [{ art: "", qty: 0 }];
  const qty = copyCount(saved);
  const locked = saved?.locked ?? false;
  const back = card.faces[1];
  return (
    <li data-flyout-anchor="" className={`rounded-2xl border border-border bg-card p-2 ${qty === 0 ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <p className="line-clamp-2 min-h-10 flex-1 text-sm leading-snug">{card.name}</p>
        {showLock && (
          <Button type="button" size="icon-sm" variant={locked ? "default" : "ghost"} aria-pressed={locked} aria-label={locked ? `Unlock ${card.name}` : `Lock ${card.name}`} onClick={() => onLock(!locked)}>
            {locked ? <Lock /> : <LockOpen />}
          </Button>
        )}
      </div>
      <CustomBackBadge option={customBack} />
      <FactsMark mark={mark} />
      <ul className="mt-2 grid gap-2">
        {pairs.map((pair, index) => {
          const art = chosenArt(card.faces[0]!, pair.art);
          const backArt = back ? chosenArt(back, pair.back) : null;
          const preview: FlyoutCard = { key: `${card.id}:${index}`, front: art?.thumbId, dfcBack: backArt?.thumbId, customBack: customBack?.thumbId, alt: card.name };
          return (
            <li key={`${pair.art}:${index}`} className="flex items-center gap-2 lg:flex-wrap lg:justify-center lg:gap-y-1">
              <button type="button" {...flyout?.(preview)} onClick={() => saved && onArt(index, "front")} className="w-12 shrink-0 text-left lg:w-40" aria-label={`Choose front art ${index + 1} for ${card.name}`}>
                <CardThumb id={art?.thumbId} alt={card.name} tag={art?.noFoilMap ? NO_FOIL_MAP : undefined} />
              </button>
              {back ? (
                <button type="button" {...flyout?.(preview)} onClick={() => saved && onArt(index, "back")} className="w-12 shrink-0 text-left lg:w-[clamp(4rem,calc(100%_-_10.5rem),10rem)]" aria-label={`Choose back art ${index + 1} for ${card.name}`}>
                  <CardThumb id={customBack?.thumbId ?? backArt?.thumbId} alt={customBack?.label ?? back.name} tag={!customBack && backArt?.noFoilMap ? NO_FOIL_MAP : undefined} />
                </button>
              ) : null}
              {/* Desktop: the count controls go on their own line under the art, so every tile lines up. */}
              <span aria-hidden="true" className="hidden lg:block lg:basis-full" />
              <Qty name={`${card.name} art ${index + 1}`} value={pair.qty} onChange={(next) => onQty(index, next)} />
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="ghost" className="mt-1 h-8 px-2 text-xs" onClick={onAdd}>
        Add another art
      </Button>
    </li>
  );
}

function Qty({ name, value, onChange }: { name: string; value: number; onChange: (qty: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-border">
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Fewer copies of ${name}`} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </Button>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`More copies of ${name}`} onClick={() => onChange(Math.min(99, value + 1))}>
        +
      </Button>
    </div>
  );
}

function AddGroup({
  title,
  cards,
  empty,
  byId,
  overrides,
  mark,
  flyout,
  onQty,
  onArt,
  onAdd,
}: {
  title: string;
  cards: DeckCard[];
  empty: string;
  byId: Map<string, SavedCard>;
  overrides?: Map<string, BackOption>;
  mark?: (card: DeckCard) => FactsStatus | undefined;
  flyout?: (card: FlyoutCard) => FlyoutBinding;
  onQty: (card: DeckCard, index: number, qty: number) => void;
  onArt: (card: DeckCard, index: number, side: "front" | "back") => void;
  onAdd: (card: DeckCard) => void;
}) {
  return (
    <section>
      <h2 className="font-heading text-xl">{title}</h2>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {cards.map((card) => (
            <AddItem
              key={card.id}
              card={card}
              saved={byId.get(card.id)}
              customBack={overrides?.get(card.id)}
              mark={mark?.(card)}
              flyout={flyout}
              onQty={(index, qty) => onQty(card, index, qty)}
              onArt={(index, side) => onArt(card, index, side)}
              onAdd={() => onAdd(card)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One token or extra with its count controls. Used by the side list, the phone tab, and the desktop overlay. */
export function AddItem({
  card,
  saved,
  customBack,
  mark,
  flyout,
  onQty,
  onArt,
  onAdd,
}: {
  card: DeckCard;
  saved?: SavedCard;
  customBack?: BackOption;
  mark?: FactsStatus;
  flyout?: (card: FlyoutCard) => FlyoutBinding;
  onQty: (index: number, qty: number) => void;
  onArt: (index: number, side: "front" | "back") => void;
  onAdd: () => void;
}) {
  const face = card.faces[0];
  const pairs = saved?.pairs?.length ? saved.pairs : [{ art: "", qty: 0 }];
  return (
    <li data-flyout-anchor="" className="grid gap-2 rounded-xl border border-border bg-background/40 p-2">
      <p className="line-clamp-2 text-sm leading-snug">{card.name}</p>
      <CustomBackBadge option={customBack} />
      <FactsMark mark={mark} />
      {pairs.map((pair, index) => {
        const art = face ? chosenArt(face, pair.art) : null;
        const backArt = card.faces[1] ? chosenArt(card.faces[1], pair.back) : null;
        return (
          <div key={`${pair.art}:${index}`} className="flex items-center gap-2">
            <button type="button" {...flyout?.({ key: `${card.id}:${index}`, front: art?.thumbId, dfcBack: backArt?.thumbId, customBack: customBack?.thumbId, alt: card.name })} className="w-12 shrink-0 lg:w-20" onClick={() => face && saved && onArt(index, "front")} aria-label={`Choose art ${index + 1} for ${card.name}`}>
              <CardThumb id={art?.thumbId} alt={card.name} tag={art?.noFoilMap ? NO_FOIL_MAP : undefined} />
            </button>
            <Qty name={`${card.name} art ${index + 1}`} value={pair.qty} onChange={(qty) => onQty(index, qty)} />
          </div>
        );
      })}
      <Button type="button" variant="ghost" className="h-8 justify-start px-2 text-xs" onClick={onAdd}>
        Add another art
      </Button>
    </li>
  );
}
