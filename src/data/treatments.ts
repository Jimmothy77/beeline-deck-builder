import type { PrintType } from "@/lib/types";

/**
 * Print treatments offered in the builder.
 * Add a row here to offer a new finish. Partial foil only lists entries
 * whose printTypes include "partial_foil" (the Standard Holo finishes).
 * Foil / Non-Foil lists every entry that includes "standard".
 */
export type Treatment = {
  id: string;
  name: string;
  printTypes: PrintType[];
};

export const TREATMENTS: Treatment[] = [
  { id: "white-holo-rainbow", name: "White Holo Rainbow", printTypes: ["standard"] },
  { id: "white-holo-surge", name: "White Holo Surge", printTypes: ["standard"] },
  { id: "white-holo-halo", name: "White Holo Halo", printTypes: ["standard"] },
  { id: "standard-holo-rainbow", name: "Standard Holo Rainbow", printTypes: ["standard", "partial_foil"] },
  { id: "standard-holo-surge", name: "Standard Holo Surge", printTypes: ["standard", "partial_foil"] },
  { id: "standard-holo-halo", name: "Standard Holo Halo", printTypes: ["standard", "partial_foil"] },
  { id: "standard-holo-galaxy", name: "Standard Holo Galaxy", printTypes: ["standard", "partial_foil"] },
];

export function treatmentsFor(printType: PrintType): Treatment[] {
  return TREATMENTS.filter((t) => t.printTypes.includes(printType));
}

export function treatmentByName(name: string | null | undefined): Treatment | null {
  if (!name) return null;
  return TREATMENTS.find((t) => t.name === name || t.id === name) ?? null;
}
