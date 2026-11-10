export function publicUrl(file: string): string {
  const base = import.meta.env.BASE_URL || "./";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${file.replace(/^\//, "")}`;
}

export function downloadText(filename: string, text: string, type = "application/xml"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function appendSlug(base: string, slug: string): string {
  if (!slug) return base;
  if (base === slug || base.endsWith(`-${slug}`) || base.includes(`-${slug}-`)) return base;
  const baseWords = base.split("-");
  const slugWords = slug.split("-");
  let overlap = 0;
  for (let i = 1; i <= Math.min(baseWords.length, slugWords.length); i += 1) {
    if (baseWords.slice(-i).join("-") === slugWords.slice(0, i).join("-")) overlap = i;
  }
  const extra = slugWords.slice(overlap).join("-");
  return extra ? `${base}-${extra}` : base;
}

/** Saved-deck name, print type, and treatment, plus a short deck id so two saves never share a file. */
export function xmlFilename(savedName: string, printType: string, treatment?: string | null, deckId?: string | null): string {
  let base = appendSlug(fileSlug(savedName) || "deck", fileSlug(printType) || "standard");
  base = appendSlug(base, treatment ? fileSlug(treatment) : "");
  const suffix = (deckId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return suffix ? `${base}-${suffix}.xml` : `${base}.xml`;
}
