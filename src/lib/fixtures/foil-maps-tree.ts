/**
 * A made-up Partial Foil unlock laid out like the KPDH Partial Foil edition (names only, from a
 * names-only look; no paid folder was opened): a Deluxe Edition shortcut, a "Partial Foil Map" mask
 * folder (black-and-white PNGs named like the cards, with Extras and Tokens subfolders), a "PDF Partial
 * Foil Map" print folder and Readme.txt. Every id here is fake and short, never Drive-shaped.
 */
import type { RawNode } from "@/lib/types";

const file = (id: string, name: string): RawNode => ({ id, name, folder: false });
const folder = (id: string, name: string, children: RawNode[], extra: Partial<RawNode> = {}): RawNode => ({ id, name, folder: true, children, ...extra });

/** The mask folder as the v0.1.36 crawl returns it (marked `masks`). */
export function maskFolder(): RawNode {
  return folder(
    "fm-maskroot-00",
    "Partial Foil Map",
    [
      file("fm-m-akroma-00", "Akroma_s Will (The Honmoon).png"),
      file("fm-m-dreamf-00", "1_1_Dream Gate (Serene Rooftops).png"),
      file("fm-m-sopor-00", "1_2_Soporific Springs (Serene Rooftops).png"),
      file("fm-m-cafe-00", "Cafe\u0301 Sign.png"),
      file("fm-m-sol-00", "SOL RING  .png"),
      file("fm-m-notes-00", "Notes.txt"),
      folder("fm-maskx-00", "Extras", [file("fm-m-alela-00", "Alela (Hornet).png"), file("fm-m-tokx-00", "Token 1.png")]),
      folder("fm-maskt-00", "Tokens", [file("fm-m-tokt-00", "Token 1.png")]),
    ],
    { masks: true },
  );
}

/** The whole unlock. `masks: false` leaves the mask folder out, as v0.1.35's crawl did. */
export function kpdhLikeTree({ masks = true }: { masks?: boolean } = {}): RawNode {
  const children: RawNode[] = [
    folder("fm-deluxe-00", "Deluxe Edition", [
      folder("fm-dfull-00", "Full Deck", [file("fm-d-akroma-00", "Akroma_s Will (The Honmoon).png"), file("fm-d-sol-00", "Sol Ring.png")]),
    ]),
    folder("fm-pdfmap-00", "PDF Partial Foil Map", [
      folder("fm-pdeck-00", "Full Deck + Tokens Folder", [
        file("fm-p-akroma-00", "Akroma's Will (The Honmoon).pdf"),
        file("fm-p-dream-00", "1_1_Dream Gate (Serene Rooftops).pdf"),
        file("fm-p-sopor-00", "1_2_Soporific Springs (Serene Rooftops).pdf"),
        file("fm-p-cafe-00", "Caf\u00e9 Sign.pdf"),
        file("fm-p-sol-00", "Sol Ring.pdf"),
        file("fm-p-signet-00", "Arcane Signet.pdf"),
        file("fm-p-back-00", "card back.png"),
        folder("fm-pfront-00", "Front", [file("fm-p-tokfront-00", "Token 1.pdf")]),
        folder("fm-pbackf-00", "Back", [file("fm-p-tokback-00", "Token 1.pdf")]),
      ]),
      folder("fm-pextras-00", "Extras", [folder("fm-palt-00", "Alternate Cards", [file("fm-p-alela-00", "Alela (Hornet).pdf")])]),
    ]),
    file("fm-readme-00", "Readme.txt"),
  ];
  if (masks) children.splice(1, 0, maskFolder());
  return folder("fm-root-00", "3_KPDH Partial Foil Edition", children, masks ? { maskScan: true } : {});
}
