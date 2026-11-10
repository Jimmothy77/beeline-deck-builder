import { describe, expect, it } from "vitest";
import { assertIdsAllowed, bracketFor, buildXml, splitExportByPrintType, validId } from "@/lib/xml";

const BACK = "cardback12345";

describe("buildXml", () => {
  it("expands quantities into slots and groups the same image", () => {
    const front = { id: "frontimage01", name: "Sol Ring.jpg", query: "sol ring" };
    const xml = buildXml({
      deck: "Silksong",
      printType: "standard",
      cardback: BACK,
      treatment: null,
      slots: [
        { front },
        { front },
        { front: { id: "otherimage01", name: "Island.jpg", query: "island" } },
      ],
    });
    expect(xml).toContain("<quantity>3</quantity>");
    expect(xml).toContain("<bracket>18</bracket>");
    expect(xml).toContain("<foil>false</foil>");
    expect(xml).toContain("<slots>0,1</slots>");
    expect(xml).toContain("<slots>2</slots>");
    expect(xml).toContain("<cardback>cardback12345</cardback>");
    expect(xml).toContain("<deck>Silksong</deck>");
    expect(xml).toContain("<printType>standard</printType>");
    expect(xml).not.toContain("<treatment>");
    expect(xml.endsWith("</order>")).toBe(true);
    expect(xml.includes("\r\n")).toBe(true);
  });

  it("writes the treatment and turns foil on", () => {
    const pdfIds = new Set(["pdffile12345"]);
    const xml = buildXml({
      deck: "Silksong",
      printType: "partial_foil",
      cardback: BACK,
      foil: true,
      treatment: "Standard Holo Rainbow",
      pdfIds,
      slots: [{ front: { id: "pdffile12345", name: "Sol Ring.pdf", query: "sol ring" } }],
    });
    expect(xml).toContain("<printType>partial_foil</printType>");
    expect(xml).toContain("<treatment>Standard Holo Rainbow</treatment>");
    expect(xml).toContain("<foil>true</foil>");
  });

  it("escapes names and puts double-faced cards in backs", () => {
    const xml = buildXml({
      deck: "Silk & Song",
      printType: "standard",
      cardback: BACK,
      slots: [
        {
          front: { id: "frontface1234", name: "Fire & Ice.png", query: "fire ice" },
          back: { id: "backface12345", name: "Ice <back>.png", query: "ice back" },
        },
      ],
    });
    expect(xml).toContain("<name>Fire &amp; Ice.png</name>");
    expect(xml).toContain("<name>Ice &lt;back&gt;.png</name>");
    expect(xml).toContain("<deck>Silk &amp; Song</deck>");
    expect(xml).toContain("<backs>");
    expect(xml).toMatch(/<backs>[\s\S]*<slots>0<\/slots>[\s\S]*<\/backs>/);
  });

  it("rejects an empty order, a bad id, and files from the other print type", () => {
    expect(() => buildXml({ deck: "Silksong", printType: "standard", cardback: BACK, slots: [] })).toThrow(/Nothing to export/);
    expect(() =>
      buildXml({
        deck: "Silksong",
        printType: "standard",
        cardback: BACK,
        slots: [{ front: { id: "short", name: "x", query: "x" } }],
      }),
    ).toThrow(/Invalid image id/);
    const slots = [{ front: { id: "standardfile1", name: "Sol Ring.jpg", query: "sol ring" } }];
    expect(() => assertIdsAllowed(slots, BACK, new Set(["partialfoil01", BACK]))).toThrow(/not part of this deck/);
    expect(() => assertIdsAllowed(slots, BACK, new Set(["standardfile1", BACK]))).not.toThrow();
  });
});

describe("partial foil fronts", () => {
  const pdfIds = new Set(["pdffile12345"]);
  const cardback = BACK;

  it("exports a partial foil order of PDF fronts", () => {
    const xml = buildXml({
      deck: "Silksong",
      printType: "partial_foil",
      cardback,
      pdfIds,
      slots: [{ front: { id: "pdffile12345", name: "Sol Ring.pdf", query: "sol ring" } }],
    });
    expect(xml).toContain("<printType>partial_foil</printType>");
    expect(xml).toContain("<name>Sol Ring.pdf</name>");
  });

  it("refuses a JPG or a file that is not in the PDF folder", () => {
    expect(() =>
      buildXml({
        deck: "Silksong",
        printType: "partial_foil",
        cardback,
        pdfIds,
        slots: [{ front: { id: "pdffile12345", name: "Sol Ring.jpg", query: "sol ring" } }],
      }),
    ).toThrow(/PDF fronts/);
    expect(() =>
      buildXml({
        deck: "Silksong",
        printType: "partial_foil",
        cardback,
        pdfIds,
        slots: [{ front: { id: "otherpdf1234", name: "Sol Ring.pdf", query: "sol ring" } }],
      }),
    ).toThrow(/PDF fronts/);
    expect(() =>
      buildXml({
        deck: "Silksong",
        printType: "partial_foil",
        cardback,
        slots: [{ front: { id: "pdffile12345", name: "Sol Ring.pdf", query: "sol ring" } }],
      }),
    ).toThrow(/PDF file list/);
  });

  it("splits mixed standard and partial foil cards into two XML files", () => {
    const xmls = splitExportByPrintType({
      deck: "Silksong",
      cardback,
      pdfIds,
      slots: [
        { printType: "standard", front: { id: "standardfile1", name: "Island.jpg", query: "island" } },
        { printType: "partial_foil", front: { id: "pdffile12345", name: "Sol Ring.pdf", query: "sol ring" } },
      ],
    });
    expect(xmls).toHaveLength(2);
    expect(xmls[0]).toContain("<printType>standard</printType>");
    expect(xmls[0]).toContain("standardfile1");
    expect(xmls[0]).not.toContain("pdffile12345");
    expect(xmls[1]).toContain("<printType>partial_foil</printType>");
    expect(xmls[1]).toContain("pdffile12345");
    expect(xmls[1]).not.toContain("standardfile1");
    expect(() =>
      splitExportByPrintType({
        deck: "Silksong",
        cardback,
        pdfIds,
        slots: [
          { printType: "standard", front: { id: "standardfile1", name: "Island.jpg", query: "island" } },
          { printType: "partial_foil", front: { id: "standardfile1", name: "Island.jpg", query: "island" } },
        ],
      }),
    ).toThrow(/PDF fronts/);
  });
});

describe("bracketFor", () => {
  it("uses the Art Picker brackets", () => {
    expect(bracketFor(1)).toBe(18);
    expect(bracketFor(18)).toBe(18);
    expect(bracketFor(19)).toBe(36);
    expect(bracketFor(100)).toBe(108);
    expect(bracketFor(612)).toBe(612);
    expect(() => bracketFor(613)).toThrow(/max out/);
    expect(validId("1Ab_cd-efghi")).toBe(true);
    expect(validId("short")).toBe(false);
    expect(validId("has space!!")).toBe(false);
  });
});
