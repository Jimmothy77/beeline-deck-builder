import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView, type DeckChoice } from "@/components/HomeView";
import type { DeckCatalogue } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "../..");
const deck = (id: string) => JSON.parse(readFileSync(path.join(root, "public/decks", `${id}.json`), "utf8")) as DeckCatalogue;
const noop = () => undefined;

function cardLine(id: string): string {
  const shipped = deck(id);
  const choice: DeckChoice = { deck: shipped, edition: shipped.editions[0]! };
  const html = renderToStaticMarkup(
    <HomeView
      loading={false}
      error={null}
      foil={[choice]}
      partial={[]}
      saved={[]}
      sessionLabel={null}
      keyReady={false}
      unlockBusy={false}
      onBuild={noop}
      onContinue={noop}
      onUnlock={noop}
      onForgetUnlocks={noop}
      onOpenSaved={noop}
      onDeleteSaved={noop}
      onExportSaved={noop}
      onExportJson={noop}
      onImportJson={noop}
      legacyBackup={false}
      onRestoreBackup={noop}
    />,
  );
  return /(\d+) main cards? · \d+ backs/.exec(html.replace(/<!-- -->/g, ""))?.[0] ?? "";
}

describe("homepage deck cards", () => {
  it("show the copies the default list opens with, not the number of main-folder cards", () => {
    expect(cardLine("floating-world")).toMatch(/^188 main cards/);
    expect(cardLine("sxf")).toMatch(/^100 main cards/);
    expect(cardLine("tmnt")).toMatch(/^100 main cards/);
    expect(cardLine("horror-movie-poster-secret-lair")).toMatch(/^9 main cards/);
  });
});
