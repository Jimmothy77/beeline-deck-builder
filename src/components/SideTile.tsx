import { type ReactNode, type RefObject, useRef, useState } from "react";
import { CardThumb } from "@/components/thumbs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { sideTileSummary, type SideKind } from "@/lib/desktop";
import { chosenArt, copyCount, type SavedCard } from "@/lib/selection";
import type { DeckCard } from "@/lib/types";

/**
 * Desktop side tile for a long Extras or Tokens list: one card's art, a count,
 * and a button that opens every card in an overlay with the usual - / + and
 * Add another art controls. The overlay is a Radix dialog: role=dialog,
 * aria-modal, labelled by its title, focus moves in and is trapped, Escape /
 * the X / a click outside close it, focus returns to the button, and the page
 * behind it does not scroll.
 */
export function SideTile({
  kind,
  title,
  cards,
  byId,
  renderItem,
  flyoutOpen,
  onFlyoutClose,
}: {
  kind: SideKind;
  title: string;
  cards: DeckCard[];
  byId: Map<string, SavedCard>;
  renderItem: (card: DeckCard) => ReactNode;
  /** When the card flyout is showing, the first Escape closes only the flyout. */
  flyoutOpen?: RefObject<boolean>;
  onFlyoutClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const added = cards.filter((card) => copyCount(byId.get(card.id)) > 0);
  const showcase = added[0] ?? cards[0];
  const face = showcase?.faces[0];
  const art = face ? chosenArt(face, byId.get(showcase!.id)?.pairs[0]?.art ?? "") : null;
  const summary = sideTileSummary(kind, cards.length, added.length);
  return (
    <section data-side-tile={kind} className="rounded-2xl border border-border bg-card p-3">
      <h2 className="font-heading text-xl">{title}</h2>
      <div className="mt-2 flex items-center gap-3">
        <div className="w-24 shrink-0">
          <CardThumb id={art?.thumbId} alt={showcase?.name ?? title} />
        </div>
        <div className="min-w-0">
          <p data-side-tile-summary="" className="text-sm">
            {summary}
          </p>
          {showcase ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{showcase.name}</p> : null}
        </div>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onFlyoutClose?.();
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="lg" className="mt-3 h-12 w-full text-base" aria-haspopup="dialog">
            Click for {title}
          </Button>
        </DialogTrigger>
        <DialogContent
          ref={contentRef}
          tabIndex={-1}
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            // Focus the dialog itself, not the first card, so the card flyout doesn't pop up on open.
            event.preventDefault();
            contentRef.current?.focus();
          }}
          data-side-overlay={kind}
          className="beeline-overlay flex max-h-[88vh] flex-col sm:max-w-6xl"
          onEscapeKeyDown={(event) => {
            if (flyoutOpen?.current) {
              event.preventDefault();
              onFlyoutClose?.();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{title}</DialogTitle>
            <DialogDescription>{summary}. Counts change the deck as you go.</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 min-h-0 overflow-y-auto px-1 pb-1">
            <ul className="grid grid-cols-3 gap-3 xl:grid-cols-5">{cards.map(renderItem)}</ul>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
