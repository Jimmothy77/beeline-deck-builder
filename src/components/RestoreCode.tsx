import { useId, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The code fields are plain text inputs masked with CSS (.beeline-masked in index.css), never
 * type=password: a password field in a form makes browsers and password managers offer to save the
 * code as a site password. These attributes also ask the common managers to leave the field alone.
 */
const NOT_A_PASSWORD = {
  type: "text",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
} as const;

export const RESTORE_WARNING = "Keep this code private. It works like your paid Drive links: anyone who has it gets your unlocked decks. Don't post it publicly or send it to anyone.";

/**
 * Restore code: copy the unlocked folders on this device to another one. Handled like a password.
 * The code is only built when asked for, shows masked until Reveal, and leaves the page only through
 * Copy. There is no share, email, or upload, and nothing is sent anywhere.
 */
export function RestoreCode({
  unlockedCount,
  unlockedKey,
  onMakeCode,
  onRestore,
}: {
  unlockedCount: number;
  /** Changes whenever the unlocked folders change. A code made for an older list is dropped. */
  unlockedKey: string;
  onMakeCode: () => Promise<string>;
  /** Resolves to the message to show. Rejects with a message for the person. */
  onRestore: (code: string) => Promise<string>;
}) {
  const ids = useId();
  const [made, setMade] = useState<{ code: string; key: string } | null>(null);
  const code = made && made.key === unlockedKey ? made.code : null;
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hide = () => {
    setMade(null);
    setRevealed(false);
    setStatus(null);
  };

  return (
    <div className="mt-5 border-t border-border pt-4" data-restore-code="">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <div>
          <h3 className="font-medium">Move your unlocks to another device</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            A restore code holds the unlocked folders on this device. Paste it into BeeLine on your other device to unlock the same decks there. No account is needed and nothing is sent anywhere.
          </p>
        </div>
      </div>
      <p className="mt-3 flex max-w-2xl items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-100" data-restore-warning="">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <span>{RESTORE_WARNING}</span>
      </p>

      {code === null ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            disabled={unlockedCount === 0}
            onClick={() => {
              setProblem(null);
              setStatus(null);
              setRevealed(false);
              const key = unlockedKey;
              onMakeCode().then(
                (next) => setMade({ code: next, key }),
                (caught: unknown) => setProblem(caught instanceof Error ? caught.message : "Couldn't make a restore code."),
              );
            }}
          >
            Get my restore code
          </Button>
          {unlockedCount === 0 && <p className="mt-2 text-xs text-muted-foreground">Unlock a folder first. Then this device can give you a restore code.</p>}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Label htmlFor={`${ids}-code`} className="text-xs">
            Your restore code ({unlockedCount} unlocked {unlockedCount === 1 ? "folder" : "folders"})
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`${ids}-code`}
              {...NOT_A_PASSWORD}
              readOnly
              value={code}
              data-masked={revealed ? "false" : "true"}
              data-restore-output=""
              className={`h-10 flex-1 font-mono text-xs ${revealed ? "" : "beeline-masked"}`}
              onFocus={(event) => {
                if (revealed) event.currentTarget.select();
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-10" aria-pressed={revealed} aria-controls={`${ids}-code`} onClick={() => setRevealed((value) => !value)}>
                {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />} {revealed ? "Hide" : "Reveal"}
              </Button>
              <Button
                type="button"
                className="h-10"
                onClick={() => {
                  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
                  if (!clip || typeof clip.writeText !== "function") {
                    setStatus("This browser won't let BeeLine copy. Reveal the code, select all of it, and copy it yourself.");
                    return;
                  }
                  clip.writeText(code).then(
                    () => setStatus("Copied. Paste it only into BeeLine on your own device."),
                    () => setStatus("Copy was blocked. Reveal the code, select all of it, and copy it yourself."),
                  );
                }}
              >
                <Copy aria-hidden="true" /> Copy code
              </Button>
              <Button type="button" variant="ghost" className="h-10 text-muted-foreground" onClick={hide}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-2 flex max-w-2xl items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-foreground" data-restore-problem="">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{problem}</span>
        </p>
      )}
      {status && !problem && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {status}
        </p>
      )}

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setRestoreError(null);
          setRestoreDone(null);
          onRestore(pasted)
            .then(
              (message) => {
                setPasted("");
                setRestoreDone(message);
              },
              (caught: unknown) => setRestoreError(caught instanceof Error ? caught.message : "Couldn't read that restore code."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <Label htmlFor={`${ids}-paste`} className="text-xs">
          Have a restore code from another device? Paste it here.
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${ids}-paste`}
            {...NOT_A_PASSWORD}
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              setRestoreError(null);
            }}
            placeholder="BEELINE-RESTORE-1…"
            data-masked="true"
            aria-invalid={restoreError ? true : undefined}
            aria-describedby={restoreError ? `${ids}-error` : undefined}
            data-restore-input=""
            className="beeline-masked h-10 flex-1 font-mono text-xs"
          />
          <Button type="submit" variant="outline" className="h-10" disabled={busy || !pasted.trim()}>
            {busy ? "Restoring…" : "Restore unlocks"}
          </Button>
        </div>
        {restoreError && (
          <p id={`${ids}-error`} role="alert" className="text-xs text-destructive">
            {restoreError}
          </p>
        )}
        {restoreDone && (
          <p role="status" className="text-xs text-muted-foreground">
            {restoreDone}
          </p>
        )}
      </form>
    </div>
  );
}
