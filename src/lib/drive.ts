import { isStandardEditionFolder, isTemplateOrFontFolder, plainEditionName, productEditionKind } from "@/lib/group";
import { isDecklistFile } from "@/lib/decklist";
import type { RawNode } from "@/lib/types";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const FILE_FIELDS = "nextPageToken,files(id,name,mimeType,shortcutDetails)";
export const PLACEHOLDER_KEY = "YOUR_GOOGLE_API_KEY";

export class DriveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DriveError";
  }
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
};

export function assertApiKey(key: string | undefined | null): string {
  const trimmed = (key ?? "").trim();
  if (!trimmed || trimmed === PLACEHOLDER_KEY || trimmed.includes("YOUR_GOOGLE")) {
    throw new Error("Add a Google API key to public/config.js before unlocking a paid folder. See the README.");
  }
  return trimmed;
}

export function parseDriveFolderId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[A-Za-z0-9_-]{10,}$/.test(text) && !text.includes("/") && !text.includes(" ")) return text;
  const embedded = text.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (embedded?.[1]) return embedded[1];
  const idParam = text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (idParam?.[1]) return idParam[1];
  try {
    const url = new URL(text);
    const parts = url.pathname.split("/").filter(Boolean);
    const folderAt = parts.findIndex((part) => part === "folders");
    if (folderAt >= 0 && parts[folderAt + 1]) return parts[folderAt + 1]!;
    const id = url.searchParams.get("id");
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return id;
  } catch {
    return null;
  }
  return null;
}

export function extractFolderIdFromText(text: string): string | null {
  const url = text.match(/https?:\/\/drive\.google\.com\/[^\s"'<>]+/i);
  if (url?.[0]) return parseDriveFolderId(url[0]);
  const id = text.match(/\b(?:folders\/|id=)([A-Za-z0-9_-]{10,})\b/);
  return id?.[1] ?? null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function keyOf(apiKey: string): string {
  return encodeURIComponent(apiKey);
}

export async function listChildren(folderId: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<DriveFile[]> {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new Error("That folder id doesn't look like a Drive id.");
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
    url.searchParams.set("fields", FILE_FIELDS);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "folder,name");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      const body = await response.text();
      throw new DriveError(response.status, driveFailure(response.status, body));
    }
    const data = (await response.json()) as { nextPageToken?: string; files?: DriveFile[] };
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

/**
 * One file's id, name and type, and a shortcut's target. Only these fields are asked for: never
 * `parents`, so a folder's Restricted deck parent (and the paid editions beside it) is never revealed.
 */
export async function getFileMeta(fileId: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<DriveFile> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,shortcutDetails&supportsAllDrives=true&key=${keyOf(apiKey)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new DriveError(response.status, driveFailure(response.status, await response.text()));
  return (await response.json()) as DriveFile;
}

export async function downloadText(fileId: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${keyOf(apiKey)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new DriveError(response.status, driveFailure(response.status, await response.text()));
  return response.text();
}

function driveFailure(status: number, body: string): string {
  if (status === 429 || ((status === 403 || status === 401) && /rateLimit|rate limit|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|sharingRateLimitExceeded|quota/i.test(body))) {
    return "Google Drive hit a rate limit or quota. Wait a minute and try the folder again.";
  }
  if (status === 403 || status === 401) {
    return "Google Drive refused the API key. Enable the Drive API, and restrict the key to this site's address if you use HTTP referrers.";
  }
  if (status === 404) return "That folder isn't visible to an API key. Share it so anyone with the link can view it.";
  const snippet = body.replace(/\s+/g, " ").slice(0, 180);
  return snippet ? `Drive returned ${status}: ${snippet}` : `Drive returned ${status}.`;
}

const LINK_FILE = /^new drive link\.txt$/i;

function nameIsPdfPartialMap(name: string): boolean {
  const plain = plainEditionName(name);
  return plain.includes("pdf") && plain.includes("partialfoil") && plain.includes("map");
}

/**
 * A Partial Foil paste keeps the Deluxe shortcut and the PDF map.
 * A mask folder is skipped only outside a PDF Partial Foil Map.
 * "Color Partial Foil Map" inside that PDF tree is a real print folder.
 */
export function skipOnPartialFoilCrawl(name: string, insidePdfMap = false): boolean {
  if (isTemplateOrFontFolder(name)) return true;
  if (isStandardEditionFolder(name)) return true;
  const plain = plainEditionName(name);
  return !insidePdfMap && plain.includes("partialfoil") && plain.includes("map") && !plain.includes("pdf");
}

/** A Deluxe paste keeps its own art folders. Standard editions and Templates are not opened. */
export function skipOnDeluxeCrawl(name: string): boolean {
  if (isTemplateOrFontFolder(name)) return true;
  return isStandardEditionFolder(name);
}

function editionCrawlOrder(name: string): number {
  const kind = productEditionKind(name);
  if (kind === "standard") return 0;
  if (kind === "deluxe") return 1;
  if (kind === "partial_foil") return 2;
  return 3;
}

function isPaidEditionName(name: string): boolean {
  const kind = productEditionKind(name);
  return kind === "deluxe" || kind === "partial_foil";
}

/**
 * List a folder recursively. A `New Drive Link.txt` replaces that folder with
 * the newer folder it points at (up to three hops). A pasted shortcut is
 * followed to its target.
 *
 * Only a pasted Deluxe or Partial Foil folder (the link on a Ko-fi order) opens
 * paid editions. Any other paste (the public BeeLine folder, a deck's shortcut,
 * a Standard folder) never lists a Deluxe or Partial Foil folder inside it, so
 * it yields Standard only.
 */
export async function readDriveTree(folderId: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<RawNode> {
  const cache = new Map<string, RawNode>();
  let partialFoilPaste = false;
  let deluxePaste = false;
  let rootDecided = false;

  async function resolve(
    id: string,
    fallbackName: string,
    hops: number,
    depth: number,
    ancestors: string[],
    insidePdfMap: boolean,
    followedLink = false,
  ): Promise<RawNode | null> {
    if (depth > 12) throw new Error("That Drive folder is nested too deeply to import.");
    if (!followedLink && ancestors.includes(id)) throw new Error("The Drive link loops back to a folder already opened.");
    const cached = cache.get(id);
    if (cached) return cached;
    const own: DriveFile = await getFileMeta(id, apiKey, fetchImpl).catch(() => ({ id, name: fallbackName, mimeType: FOLDER }));
    if (own.mimeType === SHORTCUT) {
      const target = own.shortcutDetails?.targetId;
      if (!target || own.shortcutDetails?.targetMimeType !== FOLDER) throw new Error("That link is a shortcut to something other than a folder.");
      if (target === id || ancestors.includes(target)) throw new Error("The Drive link loops back to a folder already opened.");
      return resolve(target, own.name || fallbackName, hops, depth, [...ancestors, id], insidePdfMap, true);
    }
    const folderName = own.name || fallbackName;
    if (hops === 0 && depth === 0 && !rootDecided) {
      rootDecided = true;
      const kind = productEditionKind(folderName);
      if (kind === "partial_foil") partialFoilPaste = true;
      if (kind === "deluxe") deluxePaste = true;
    }
    // A free paste never opens a paid folder, even one reached through an innocently named shortcut.
    if (depth > 0 && !partialFoilPaste && !deluxePaste && isPaidEditionName(folderName)) return null;
    const files = await listChildren(id, apiKey, fetchImpl);
    const link = files.find((file) => LINK_FILE.test(file.name));
    if (link && hops < 3) {
      const text = await downloadText(link.id, apiKey, fetchImpl);
      const next = extractFolderIdFromText(text);
      if (next) {
        const chain = [...ancestors, id];
        const stripped = chain.filter((item) => item !== next);
        if (stripped.length !== chain.length) throw new Error("The Drive link loops back to a folder already opened.");
        return resolve(next, folderName, hops + 1, depth, stripped, insidePdfMap, true);
      }
    }
    const pdfMap = insidePdfMap || nameIsPdfPartialMap(folderName);
    const ordered =
      depth === 0 && hops === 0
        ? [...files].sort((a, b) => editionCrawlOrder(a.name) - editionCrawlOrder(b.name) || a.name.localeCompare(b.name))
        : files;
    const children: RawNode[] = [];
    const nextAncestors = [...ancestors, id];
    for (const file of ordered) {
      if (LINK_FILE.test(file.name)) continue;
      const mime = file.shortcutDetails?.targetMimeType || file.mimeType;
      const childId = file.shortcutDetails?.targetId || file.id;
      if (mime === FOLDER) {
        if (!partialFoilPaste && !deluxePaste && isPaidEditionName(file.name)) continue;
        if (partialFoilPaste && skipOnPartialFoilCrawl(file.name, pdfMap)) continue;
        if (deluxePaste && skipOnDeluxeCrawl(file.name)) continue;
        const child = await resolve(childId, file.name, hops, depth + 1, nextAncestors, pdfMap || nameIsPdfPartialMap(file.name));
        if (child) children.push(child);
      } else {
        children.push({ id: file.id, name: file.name, folder: false });
      }
    }
    const node = { id, name: folderName, folder: true, children };
    cache.set(id, node);
    return node;
  }

  const tree = await resolve(folderId, "Unlocked folder", 0, 0, [], false);
  if (!tree) throw new Error("The Drive link loops back to a folder already opened.");
  return tree;
}

/** Most deck lists one unlock will read. A Floating World edition has six. */
export const MAX_DECKLIST_FILES = 40;

/**
 * Read every `decklist*.txt` in an unlocked tree. A list that fails to read is
 * left out of the map; the catalogue then uses the shipped copy or folder counts.
 * The texts hold card names only and are kept in memory.
 */
export async function readDecklistTexts(tree: RawNode, apiKey: string, fetchImpl: FetchLike = fetch): Promise<Map<string, string>> {
  const files: RawNode[] = [];
  const visit = (node: RawNode) => {
    for (const child of node.children ?? []) {
      if (child.folder) visit(child);
      else if (isDecklistFile(child.name) && !files.some((file) => file.id === child.id)) files.push(child);
    }
  };
  visit(tree);
  const texts = new Map<string, string>();
  for (const file of files.slice(0, MAX_DECKLIST_FILES)) {
    try {
      texts.set(file.id, await downloadText(file.id, apiKey, fetchImpl));
    } catch {
      // Falls back to the shipped list or folder counts.
    }
  }
  return texts;
}

export function readConfigKey(): string {
  if (typeof window === "undefined") return "";
  return window.PRINTABEE_CONFIG?.googleApiKey ?? "";
}
