import { describe, expect, it } from "vitest";
import { xmlFilename } from "@/lib/download";

describe("xmlFilename", () => {
  it("does not repeat standard and keeps two saves distinct", () => {
    const one = xmlFilename("Silksong · Standard", "standard", "Standard Holo Rainbow", "abc12345-0000");
    const two = xmlFilename("Silksong · Standard", "standard", "Standard Holo Rainbow", "def67890-0000");
    expect(one).toBe("silksong-standard-holo-rainbow-abc123.xml");
    expect(one.match(/standard/g)).toHaveLength(1);
    expect(two).not.toBe(one);
    expect(xmlFilename("My build", "partial_foil", null, "abc12345")).toBe("my-build-partial-foil-abc123.xml");
  });
});