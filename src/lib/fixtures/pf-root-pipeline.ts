/**
 * A pasted Partial Foil edition root, unlocked end to end the way the app does it (App's unlock): the
 * Drive crawl over a fake Drive, the deck lists, the catalogue, the stored unlock, its restore codes, and
 * every edition's opening-deck XML. Used by the v0.1.37 edition-root golden: recorded with v0.1.37's
 * code (this file copied into the v0.1.37 source tree) and re-run by v0.1.38's test, which must match it
 * byte for byte. Only APIs that both versions have are used here.
 *
 * The fake Drive is laid out like a real Partial Foil edition root: the printable PDFs in "PDF Partial
 * Foil Map/Full Deck + Tokens Folder" (and its Extras), the PNG masks in "Partial Foil Map" (with Extras and
 * Tokens), a Deluxe shortcut and Readme.txt. Every id is made up and short, never Drive-shaped.
 */
import { treatmentsFor } from "../../data/treatments";
import { freshDraft, openingCopies } from "../draft";
import { readDecklistTexts, readDriveTree } from "../drive";
import { artIdsOf, assignPartialFoilThumbs, catalogueFromTree, pdfIdsInEdition } from "../group";
import { preferDeckName } from "../names";
import { makeRestoreCode } from "../restore-code";
import { countCopies, selectAllCards, selectionToSlots } from "../selection";
import { packHash, UNLOCK_KEY, writeUnlocked, type UnlockedPack } from "../storage";
import type { Edition, RawNode } from "../types";
import { assertIdsAllowed, splitExportByPrintType } from "../xml";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
type Item = { name: string; mimeType: string; children?: string[]; target?: string; text?: string };

const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[]): RawNode => ({ id, name, folder: true, children });

/** The edition root as it sits in Drive (no crawl marks). `root` names the pasted folder. */
export function pfRootDrive(rootName = "3_KPDH Partial Foil Edition"): RawNode {
  return folder("pr-root-00", rootName, [
    // A shortcut in Drive; listed below as a shortcut to pr-deluxe-00.
    folder("pr-dlxsc-00", "Deluxe Edition", []),
    folder("pr-maskroot-00", "Partial Foil Map", [
      file("pr-m-akroma-00", "Akroma_s Will (The Honmoon).png"),
      file("pr-m-dream-00", "1_1_Dream Gate (Serene Rooftops).png"),
      file("pr-m-sopor-00", "1_2_Soporific Springs (Serene Rooftops).png"),
      file("pr-m-cafe-00", "Cafe\u0301 Sign.png"),
      file("pr-m-sol-00", "SOL RING  .png"),
      file("pr-m-notes-00", "Notes.txt"),
      folder("pr-maskx-00", "Extras", [file("pr-m-alela-00", "Alela (Hornet).png"), file("pr-m-tokx-00", "Token 1.png")]),
      folder("pr-maskt-00", "Tokens", [file("pr-m-tokt-00", "Token 1.png")]),
    ]),
    folder("pr-pdfmap-00", "PDF Partial Foil Map", [
      folder("pr-pdeck-00", "Full Deck + Tokens Folder", [
        file("pr-p-akroma-00", "Akroma's Will (The Honmoon).pdf"),
        file("pr-p-dream-00", "1_1_Dream Gate (Serene Rooftops).pdf"),
        file("pr-p-sopor-00", "1_2_Soporific Springs (Serene Rooftops).pdf"),
        file("pr-p-cafe-00", "Caf\u00e9 Sign.pdf"),
        file("pr-p-sol-00", "Sol Ring.pdf"),
        file("pr-p-signet-00", "Arcane Signet.pdf"),
        file("pr-p-back-00", "card back.png"),
        folder("pr-pfront-00", "Front", [file("pr-p-tokfront-00", "Token 1.pdf")]),
        folder("pr-pbackf-00", "Back", [file("pr-p-tokback-00", "Token 1.pdf")]),
      ]),
      folder("pr-pextras-00", "Extras", [folder("pr-palt-00", "Alternate Cards", [file("pr-p-alela-00", "Alela (Hornet).pdf")])]),
    ]),
    file("pr-readme-00", "Readme.txt"),
  ]);
}

/** The Deluxe edition the root's shortcut points at, named for the same deck. */
const deluxeOf = (rootName: string): RawNode => folder("pr-deluxe-00", rootName.replace(/^3_/, "2_").replace("Partial Foil Edition", "Deluxe Edition"), [
  folder("pr-dfull-00", "Full Deck", [file("pr-d-akroma-00", "Akroma_s Will (The Honmoon).png"), file("pr-d-sol-00", "Sol Ring.png")]),
]);

function itemsOf(root: RawNode): Map<string, Item> {
  const items = new Map<string, Item>();
  const deluxe = deluxeOf(root.name);
  const add = (node: RawNode) => {
    if (node.id === "pr-dlxsc-00") {
      items.set(node.id, { name: node.name, mimeType: SHORTCUT, target: deluxe.id });
      return;
    }
    const mimeType = node.folder ? FOLDER : node.name.endsWith(".pdf") ? "application/pdf" : node.name.endsWith(".png") ? "image/png" : "text/plain";
    items.set(node.id, { name: node.name, mimeType, children: node.folder ? (node.children ?? []).map((child) => child.id) : undefined, text: node.folder ? undefined : "" });
    for (const child of node.children ?? []) add(child);
  };
  add(root);
  add(deluxe);
  return items;
}

/** A fake Drive answering metadata, listings and file text by id, recording every request it was asked. */
export function fakePfDrive(root: RawNode) {
  const items = itemsOf(root);
  const requests: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const meta = (id: string) => {
    const item = items.get(id)!;
    return { id, name: item.name, mimeType: item.mimeType, ...(item.target ? { shortcutDetails: { targetId: item.target, targetMimeType: FOLDER } } : {}) };
  };
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q");
    const parent = q ? /'([^']+)' in parents/.exec(q)?.[1] : undefined;
    if (parent) {
      requests.push(`list ${parent}`);
      return json({ files: (items.get(parent)?.children ?? []).map(meta) });
    }
    const id = decodeURIComponent(/\/files\/([^/]+)$/.exec(url.pathname)?.[1] ?? "");
    if (!items.has(id)) {
      requests.push(`missing ${id}`);
      return json({ error: { message: "File not found" } }, 404);
    }
    if (url.searchParams.get("alt") === "media") {
      requests.push(`text ${id}`);
      return new Response(items.get(id)!.text ?? "");
    }
    requests.push(`meta ${id}`);
    return json(meta(id));
  };
  return { fetchImpl, requests };
}

function exportXml(edition: Edition, deckName: string): string {
  const draft = freshDraft({ id: "pf-root", name: deckName, creator: "", editions: [edition] } as never, edition, "golden-pf-root", new Date("2026-11-10T12:00:00.000Z"));
  const cardback = draft.cardbackId || edition.backs[0]?.id || "";
  const slots = selectionToSlots(edition, draft.cards, { printFlipBacksAsFronts: draft.printFlipBacksAsFronts === true, cardBacks: draft.cardBacks, cardback });
  assertIdsAllowed(slots, cardback, artIdsOf(edition));
  const treatment = treatmentsFor(edition.printType).some((item) => item.name === draft.treatment) ? draft.treatment : null;
  const [xml] = splitExportByPrintType({ slots: slots.map((slot) => ({ ...slot, printType: edition.printType })), cardback, deck: draft.deckName, treatment, foil: Boolean(treatment), stock: "(S30) Standard Smooth", pdfIds: pdfIdsInEdition(edition) });
  return xml ?? "";
}

/** The XML, or why there is none (an edition with no card back can't be exported, in either version). */
function xmlOrError(edition: Edition, deckName: string): string {
  try {
    return exportXml(edition, deckName);
  } catch (caught) {
    return `error: ${caught instanceof Error ? caught.message : String(caught)}`;
  }
}

/** Unlock the fake edition root (named `rootName`) as a pasted link and report everything the app keeps. */
export async function unlockPfRoot(rootName?: string) {
  const root = pfRootDrive(rootName);
  const drive = fakePfDrive(root);
  const key = "made-up-test-key";
  const tree = await readDriveTree(root.id, key, drive.fetchImpl);
  const decklistTexts = await readDecklistTexts(tree, key, drive.fetchImpl);
  const deckName = preferDeckName(tree.name);
  const catalogue = assignPartialFoilThumbs(catalogueFromTree(tree, deckName, [], { decklistTexts, bundledDecklists: [] }), []);
  const pack: UnlockedPack = { packHash: packHash(root.id), savedAt: "2026-11-12T08:00:00.000Z", catalogue };
  const store = new Map<string, string>();
  writeUnlocked({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage, [pack]);
  const editions = catalogue.editions.map((edition) => ({
    id: edition.id,
    printType: edition.printType,
    cards: edition.cards.length,
    backs: edition.backs.length,
    opening: openingCopies(edition),
    allCards: countCopies(selectAllCards(edition, [])),
    pdfs: [...pdfIdsInEdition(edition)].sort(),
    masks: edition.cards.flatMap((card) => card.faces.flatMap((face) => [face.defaultArt, ...face.alternates].filter(Boolean).map((art) => art!.maskId ?? "-"))),
    xml: xmlOrError(edition, catalogue.name),
  }));
  return {
    requests: drive.requests,
    tree: JSON.stringify(tree),
    catalogue: JSON.stringify(catalogue),
    stored: store.get(UNLOCK_KEY)!,
    restoreCode: await makeRestoreCode([pack]),
    restoreCodePlain: await makeRestoreCode([pack], { compress: false }),
    editions,
  };
}
