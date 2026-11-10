import { Component, type ReactNode } from "react";
import { downloadText } from "@/lib/download";
import { exportSavedJson, loadSaved, SAVED_KEY, UNLOCK_KEY } from "@/lib/storage";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Catches a render crash so a bad saved deck doesn't leave a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-heading text-3xl">BeeLine hit a problem</h1>
        <p className="mt-3 text-sm text-muted-foreground">Reload the page to try again. If a saved or unlocked pack is what broke, reset the data stored in this browser.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={() => {
              const decks = loadSaved(localStorage);
              if (!decks.length) {
                window.alert("There are no saved decks to export.");
                return;
              }
              downloadText("beeline-decks.json", exportSavedJson(decks), "application/json");
            }}
          >
            Export saved decks
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={() => {
              if (!window.confirm("Forget unlocked packs on this device? Saved decks stay.")) return;
              localStorage.removeItem(UNLOCK_KEY);
              window.location.reload();
            }}
          >
            Forget unlocked packs
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={() => {
              if (!window.confirm("Export saved decks first if you still need them. Wipe saved decks on this device?")) return;
              localStorage.removeItem(SAVED_KEY);
              window.location.reload();
            }}
          >
            Reset saved decks
          </button>
        </div>
      </div>
    );
  }
}
