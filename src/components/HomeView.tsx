import { useState } from "react";
import { Download, FolderKey, Trash2 } from "lucide-react";
import { BeeLineBanner } from "@/components/BeeLineBanner";
import { CardThumb } from "@/components/thumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DeckCatalogue, Edition } from "@/lib/types";
import type { SavedDeck } from "@/lib/storage";
import { chosenArt, countCopies } from "@/lib/selection";
import { openingCopies } from "@/lib/draft";

export type DeckChoice = { deck: DeckCatalogue; edition: Edition };

export function HomeView({
  loading,
  error,
  foil,
  partial,
  saved,
  legacyNotes,
  sessionLabel,
  keyReady,
  unlockBusy,
  onBuild,
  onContinue,
  onUnlock,
  onForgetUnlocks,
  onOpenSaved,
  onDeleteSaved,
  onExportSaved,
  onExportJson,
  onImportJson,
  legacyBackup,
  onRestoreBackup,
}: {
  loading: boolean;
  error: string | null;
  foil: DeckChoice[];
  partial: DeckChoice[];
  saved: SavedDeck[];
  legacyNotes?: ReadonlyMap<string, string>;
  sessionLabel: string | null;
  keyReady: boolean;
  unlockBusy: boolean;
  onBuild: (choice: DeckChoice) => void;
  onContinue: () => void;
  onUnlock: (url: string) => void;
  onForgetUnlocks: () => void;
  onOpenSaved: (deck: SavedDeck) => void;
  onDeleteSaved: (id: string) => void;
  onExportSaved: (deck: SavedDeck) => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  legacyBackup: boolean;
  onRestoreBackup: () => void;
}) {
  const [link, setLink] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <BeeLineBanner />

      {sessionLabel && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3">
          <p className="text-sm">You were building <strong>{sessionLabel}</strong>.</p>
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading the decks…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <DeckSection
            title="Foil / Non-Foil"
            kicker="Standard files"
            className="foil-panel border-amber-200/25"
            empty="No standard decks are in this copy yet."
            choices={foil}
            onBuild={onBuild}
          />
          <DeckSection
            title="Partial Foil"
            kicker="Foil maps only"
            className="partial-panel border-cyan-100/25"
            empty="No partial foil decks yet. Paste a Ko-fi Drive link below. A partial foil order never includes standard cards."
            choices={partial}
            onBuild={onBuild}
          />
        </div>
      )}

      <section className="rounded-3xl border border-border bg-card/80 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <FolderKey className="mt-0.5 size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-heading text-2xl">Unlock a paid deck</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Paste the Google Drive folder link from your Ko-fi order. BeeLine lists it in this browser and keeps the deck list on this device. Paid file ids are not shipped with the site.
            </p>
          </div>
        </div>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            onUnlock(link);
          }}
        >
          <div className="flex-1">
            <Label htmlFor="drive-link" className="sr-only">
              Drive folder link
            </Label>
            <Input
              id="drive-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              autoComplete="off"
              spellCheck={false}
              className="h-11"
            />
          </div>
          <Button type="submit" className="h-11" disabled={unlockBusy || !link.trim()}>
            {unlockBusy ? "Opening folder…" : "Unlock folder"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          The deck list stays on this device. The Drive link is not saved; paste it again to refresh a folder.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {keyReady
            ? "A Google API key is set in config.js."
            : "The API key in config.js is still the placeholder, so unlock will not work until the site owner adds one. The key should be restricted to this site's address."}
        </p>
        <Button type="button" variant="ghost" className="mt-1 px-0 text-muted-foreground" onClick={onForgetUnlocks}>
          Forget unlocked folders on this device
        </Button>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl">Saved decks</h2>
            <p className="text-sm text-muted-foreground">
              Each one downloads its own XML. Export your saved decks as JSON before upgrading BeeLine. The file is also how you move them to another browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {legacyBackup && (
              <Button type="button" variant="outline" onClick={onRestoreBackup}>
                Restore backup
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onExportJson} disabled={!saved.length}>
              Export JSON
            </Button>
            <Label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted">
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onImportJson(file);
                }}
              />
            </Label>
          </div>
        </div>
        {saved.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            Nothing saved yet. Build a deck, then save it. You can keep as many as you like.
          </p>
        ) : (
          <ul className="grid gap-3">
            {saved.map((deck) => (
              <li key={deck.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{deck.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {deck.deckName} · {deck.editionName} · {deck.printType === "partial_foil" ? "Partial foil" : "Foil / Non-Foil"} · {countCopies(deck.cards)} cards
                    {deck.treatment ? ` · ${deck.treatment}` : ""}
                  </p>
                  {legacyNotes?.get(deck.id) && <p className="mt-1 text-xs text-amber-200/90">{legacyNotes.get(deck.id)}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => onOpenSaved(deck)}>
                    Open
                  </Button>
                  <Button type="button" variant="outline" onClick={() => onExportSaved(deck)}>
                    <Download /> XML
                  </Button>
                  <Button type="button" variant="ghost" aria-label={`Delete ${deck.name}`} onClick={() => onDeleteSaved(deck.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pb-6 text-xs leading-relaxed text-muted-foreground">
        Card designs and deck lists by Beespair. BeeLine only writes the print order. It is a fan project for personal printing and is not affiliated with Wizards of the Coast.
      </footer>
    </div>
  );
}

function DeckSection({
  title,
  kicker,
  className,
  empty,
  choices,
  onBuild,
}: {
  title: string;
  kicker: string;
  className: string;
  empty: string;
  choices: DeckChoice[];
  onBuild: (choice: DeckChoice) => void;
}) {
  return (
    <section className={`rounded-3xl border p-5 sm:p-6 ${className}`}>
      <p className="text-xs font-semibold tracking-[0.18em] uppercase text-primary">{kicker}</p>
      <h2 className="font-heading mt-1 text-3xl">{title}</h2>
      {choices.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {choices.map((choice) => {
            const cards = Array.isArray(choice.edition.cards) ? choice.edition.cards : [];
            const backs = Array.isArray(choice.edition.backs) ? choice.edition.backs : [];
            const lead = cards.find((card) => card.role === "main");
            const art = lead?.faces?.[0] ? chosenArt(lead.faces[0], lead.faces[0].defaultArt?.id) : null;
            const mains = openingCopies({ ...choice.edition, cards });
            return (
              <li key={`${choice.deck.id}:${choice.edition.printType}:${choice.edition.id}`}>
                <article className="flex gap-3 rounded-2xl bg-black/20 p-3">
                  <div className="w-16 shrink-0">
                    <CardThumb id={art?.thumbId} alt={lead?.name ?? choice.deck.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading text-xl leading-none">{choice.deck.name}</h3>
                      <Badge variant="secondary">{choice.edition.name}</Badge>
                      {choice.edition.origin === "unlocked" && <Badge variant="outline">Unlocked</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mains} main {mains === 1 ? "card" : "cards"} · {backs.length} backs
                    </p>
                    <Button type="button" className="mt-3 h-10" onClick={() => onBuild(choice)}>
                      Build
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
