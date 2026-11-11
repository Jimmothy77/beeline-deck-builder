/**
 * The site's public Drive root and the lister the catalogue scripts use.
 *
 * The root is the public "BeeLine" folder: one entry per deck, each leading to the deck's Standard
 * folder through a Drive shortcut. The deck parents (which also hold the paid editions) are Restricted
 * and are never requested. Listing uses Google's public embedded folder view: no sign-in, no API key,
 * and no `parents` field anywhere.
 */
import { parseEmbeddedFolder, type ListedFolder } from "../src/lib/crawl";

export const PUBLIC_ROOT = "1LNzSj8t9BzojUvT2hjrrhitdqTxJaqc-";

/** Error text for a failed listing. It never includes the id that was asked for. */
export class ListingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ListingError";
    this.status = status;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * List one public folder. Drive's folder view sometimes answers a public folder with a 401 or 429 for a
 * moment, so a failure is tried again (three tries in all) before it counts.
 */
export async function listEmbedded(id: string, fetchImpl: FetchLike = fetch, pauseMs = 200): Promise<ListedFolder> {
  let last: ListingError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, pauseMs * 5 * attempt));
    const response = await fetchImpl(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, {
      headers: { "User-Agent": "BeeLineCatalogue/0.2 (public folder listing)", Accept: "text/html" },
    });
    if (!response.ok) {
      last = new ListingError(response.status, `Drive folder listing failed (${response.status}). The folder may be Restricted.`);
      continue;
    }
    const html = await response.text();
    const listed = parseEmbeddedFolder(html);
    if (!listed.entries.length && /accounts\.google\.com|Sign in/i.test(html)) {
      last = new ListingError(401, "Drive asked for a sign-in. The folder needs to be public (anyone with the link).");
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    return listed;
  }
  throw last!;
}
