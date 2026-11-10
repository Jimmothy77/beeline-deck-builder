import type { PrintType } from "@/lib/types";

/** Same brackets as MPC Art Picker's build_xml. */
export const BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612];

export const DEFAULT_STOCK = "(S30) Standard Smooth";

const ID_RE = /^[A-Za-z0-9_-]{10,80}$/;

export function validId(id: string): boolean {
  return ID_RE.test(id);
}

export function bracketFor(count: number): number {
  for (const bracket of BRACKETS) {
    if (count <= bracket) return bracket;
  }
  throw new Error(
    `MPCFill orders max out at ${BRACKETS[BRACKETS.length - 1]} cards (this order has ${count}).`,
  );
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type XmlCard = {
  id: string;
  name: string;
  query: string;
};

export type XmlSlot = {
  front: XmlCard;
  back?: XmlCard | null;
};

export type XmlRequest = {
  slots: XmlSlot[];
  cardback: string;
  stock?: string;
  /** True when a holo treatment is selected. */
  foil?: boolean;
  deck: string;
  printType: PrintType;
  /** Omitted from the XML when empty. */
  treatment?: string | null;
  /**
   * PDF print-file ids from the partial-foil edition's PDF folder.
   * Required when printType is partial_foil. Every front must be one of these and named .pdf.
   */
  pdfIds?: ReadonlySet<string>;
};

type Grouped = { id: string; name: string; query: string; slots: number[] };

function groupSide(slots: XmlSlot[], side: "front" | "back"): Grouped[] {
  const groups = new Map<string, Grouped>();
  const order: string[] = [];
  slots.forEach((slot, index) => {
    const card = slot[side];
    if (!card?.id) return;
    let group = groups.get(card.id);
    if (!group) {
      group = { id: card.id, name: card.name || card.id, query: card.query || "", slots: [] };
      groups.set(card.id, group);
      order.push(card.id);
    }
    group.slots.push(index);
  });
  return order.map((id) => groups.get(id)!);
}

function section(tag: string, items: Grouped[]): string[] {
  const lines = [`    <${tag}>`];
  for (const item of items) {
    lines.push(
      "        <card>",
      `            <id>${escapeXml(item.id)}</id>`,
      `            <slots>${item.slots.join(",")}</slots>`,
      `            <name>${escapeXml(item.name)}</name>`,
      `            <query>${escapeXml(item.query)}</query>`,
      "        </card>",
    );
  }
  lines.push(`    </${tag}>`);
  return lines;
}

/**
 * MPCFill order XML, matching Art Picker's build_xml, plus a <printabee> block
 * other tools ignore. Line endings are CRLF, the same default as the picker.
 */
export function buildXml(req: XmlRequest): string {
  const slots = req.slots ?? [];
  if (!slots.length) throw new Error("Nothing to export yet.");
  const missing = slots.filter((slot) => !slot.front?.id);
  if (missing.length) throw new Error(`${missing.length} card(s) have no art picked.`);
  for (const slot of slots) {
    for (const side of [slot.front, slot.back]) {
      if (side?.id && !validId(side.id)) throw new Error(`Invalid image id “${side.id}”.`);
    }
  }
  const cardback = (req.cardback || "").trim();
  if (!validId(cardback)) throw new Error("Pick a card back before exporting.");
  if (req.printType === "partial_foil") assertPartialFoilFronts(slots, req.pdfIds);
  const qty = slots.length;
  const foil = req.foil ? "true" : "false";
  const lines = [
    "<order>",
    "    <details>",
    `        <quantity>${qty}</quantity>`,
    `        <bracket>${bracketFor(qty)}</bracket>`,
    `        <stock>${escapeXml(req.stock || DEFAULT_STOCK)}</stock>`,
    `        <foil>${foil}</foil>`,
    "    </details>",
    ...section("fronts", groupSide(slots, "front")),
  ];
  const backs = groupSide(slots, "back");
  if (backs.length) lines.push(...section("backs", backs));
  lines.push(`    <cardback>${escapeXml(cardback)}</cardback>`);
  lines.push("    <printabee>", `        <deck>${escapeXml(req.deck)}</deck>`, `        <printType>${req.printType}</printType>`);
  const treatment = (req.treatment || "").trim();
  if (treatment) lines.push(`        <treatment>${escapeXml(treatment)}</treatment>`);
  lines.push("    </printabee>", "</order>");
  return lines.join("\r\n");
}

/**
 * A partial foil XML may only contain fronts whose file is a PDF from that edition's PDF folder.
 * JPG previews and standard-edition files are refused.
 */
export function assertPartialFoilFronts(slots: XmlSlot[], pdfIds: ReadonlySet<string> | undefined): void {
  if (!pdfIds) throw new Error("A partial foil order needs the PDF file list from that edition.");
  const bad = slots.filter((slot) => !/\.pdf$/i.test(slot.front.name) || !pdfIds.has(slot.front.id));
  if (bad.length) {
    throw new Error("A partial foil order can only use PDF fronts from that edition's PDF folder.");
  }
}

export type TaggedSlot = XmlSlot & { printType: PrintType };

/**
 * One XML per print type. A mix of standard and partial foil becomes two orders,
 * and the partial foil order is checked against `pdfIds`.
 */
export function splitExportByPrintType(input: {
  deck: string;
  cardback: string;
  slots: TaggedSlot[];
  pdfIds: ReadonlySet<string>;
  treatment?: string | null;
  foil?: boolean;
  stock?: string;
}): string[] {
  const groups = new Map<PrintType, XmlSlot[]>();
  for (const { printType, ...slot } of input.slots) {
    const list = groups.get(printType) ?? [];
    list.push(slot);
    groups.set(printType, list);
  }
  const xmls: string[] = [];
  for (const printType of ["standard", "partial_foil"] as const) {
    const group = groups.get(printType);
    if (!group?.length) continue;
    xmls.push(
      buildXml({
        slots: group,
        cardback: input.cardback,
        deck: input.deck,
        printType,
        treatment: input.treatment,
        foil: input.foil,
        stock: input.stock,
        pdfIds: printType === "partial_foil" ? input.pdfIds : undefined,
      }),
    );
  }
  return xmls;
}

/** Every image id in the order must belong to the edition being exported. */
export function assertIdsAllowed(slots: XmlSlot[], cardback: string, allowed: Set<string>): void {
  const bad: string[] = [];
  if (!allowed.has(cardback)) bad.push(cardback);
  for (const slot of slots) {
    if (!allowed.has(slot.front.id)) bad.push(slot.front.id);
    if (slot.back?.id && !allowed.has(slot.back.id)) bad.push(slot.back.id);
  }
  if (bad.length) {
    throw new Error(
      `This export mixes in ${bad.length} file(s) that are not part of this deck and print type.`,
    );
  }
}

export function editionFileIds(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}
