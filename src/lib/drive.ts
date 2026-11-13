import { isStandardEditionFolder, isTemplateOrFontFolder, looksLikePaidName, plainEditionName, productEditionKind } from "@/lib/group";
import { isDecklistFile } from "@/lib/decklist";
import { isFoilMaskFolderName } from "@/lib/foil-maps";
import { mapFolderInChain, PartialFoilMapLinkError } from "@/lib/pf-map";
import type { RawNode } from "@/lib/types";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const FILE_FIELDS = "nextPageToken,files(id,name,mimeType,shortcutDetails)";
export const PLACEHOLDER_KEY = "YOUR_GOOGLE_API_KEY";

export class DriveError extends Error {
  status: number;
  /** Drive's own reasons for the failure (keyInvalid, insufficientFilePermissions, ...), when it gave any. */
  reasons: string[];
  constructor(status: number, message: string, reasons: string[] = []) {
    super(message);
    this.status = status;
    this.reasons = reasons;
    this.name = "DriveError";
  }
}

/**
 * Which item a request was for, in words for a message: never an id. `name` is the item's Drive name when
 * it is known (from its own metadata or its parent's listing).
 */
export type DriveItem =
  | { kind: "pasted"; name?: string }
  | { kind: "subfolder"; name: string }
  | { kind: "shortcut"; name: string }
  | { kind: "linked"; name?: string; from: string }
  | { kind: "file"; name: string };

const PASTED: DriveItem = { kind: "pasted" };

/** “Name”, quoted, with any id-shaped run in it blanked so a message can't carry one. */
function quoted(name: string): string {
  return `“${scrubIds(name.trim())}”`;
}

/** Blanks anything shaped like a Drive id or an API key. Names never need such runs. */
function scrubIds(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{25,}/g, "…");
}

/** The item as the subject of a sentence. */
export function describeItem(item: DriveItem): string {
  switch (item.kind) {
    case "pasted":
      return item.name ? `The folder you pasted (${quoted(item.name)})` : "The folder you pasted";
    case "subfolder":
      return `The folder ${quoted(item.name)} inside it`;
    case "shortcut":
      return `The shortcut target ${quoted(item.name)}`;
    case "linked":
      return `The folder that New Drive Link.txt in ${quoted(item.from)} points to${item.name ? ` (${quoted(item.name)})` : ""}`;
    case "file":
      return `The file ${quoted(item.name)}`;
  }
}

/** Drive's error body, as far as it can be read: its reasons, status word and message. */
export type DriveErrorBody = { reasons: string[]; status: string; message: string };

export function parseDriveError(body: string): DriveErrorBody {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { reasons: [], status: "", message: "" };
  }
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (!error || typeof error !== "object") return { reasons: [], status: "", message: "" };
  const record = error as { errors?: unknown; details?: unknown; status?: unknown; message?: unknown };
  const reasons: string[] = [];
  for (const list of [record.errors, record.details]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const reason = item && typeof item === "object" ? (item as { reason?: unknown }).reason : undefined;
      if (typeof reason === "string" && reason && !reasons.includes(reason)) reasons.push(reason);
    }
  }
  return {
    reasons,
    status: typeof record.status === "string" ? record.status : "",
    message: typeof record.message === "string" ? record.message : "",
  };
}

/**
 * The pasted link itself can't be read, not even its name. The paid edition folders are shared with
 * "Anyone with the link"; the deck folders above them (which hold Standard, Deluxe and Partial Foil side
 * by side) are Restricted, so this is most often a deck folder's link pasted instead of an edition's.
 */
export const PASTED_UNREADABLE =
  "BeeLine can't open that link. It may be a deck folder rather than an edition folder. Paste the link to the edition folder itself (for example “P5 Partial Foil Edition”) from your order.";

/** Reasons that blame the API key or its project, and only those. */
const KEY_REASON = /^(?:API_KEY_[A-Z_]+|keyInvalid|keyExpired|badKey|ipRefererBlocked|accessNotConfigured|SERVICE_DISABLED)$/;
const QUOTA_REASON = /rateLimit|quota|LimitExceeded|RATE_LIMIT|RESOURCE_EXHAUSTED/i;
const NOT_SHARED_REASON = /^(?:insufficientFilePermissions|notFound)$/;
const NOT_SHARED_TEXT = /does not have sufficient permissions|file not found/i;

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

export async function listChildren(folderId: string, apiKey: string, fetchImpl: FetchLike = fetch, item: DriveItem = PASTED): Promise<DriveFile[]> {
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
    if (!response.ok) throw await failure(response, item);
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
export async function getFileMeta(fileId: string, apiKey: string, fetchImpl: FetchLike = fetch, item: DriveItem = PASTED): Promise<DriveFile> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,shortcutDetails&supportsAllDrives=true&key=${keyOf(apiKey)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw await failure(response, item);
  return (await response.json()) as DriveFile;
}

export async function downloadText(fileId: string, apiKey: string, fetchImpl: FetchLike = fetch, item: DriveItem = PASTED): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${keyOf(apiKey)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw await failure(response, item);
  return response.text();
}

/**
 * The words for a failed Drive request. Only a key reason blames the key; an item Drive won't show is
 * named (by name, never id) as not shared with "Anyone with the link"; a rate limit or quota, and anything
 * else, read as before. No id or key ever reaches the message.
 */
export function driveFailure(status: number, body: string, item: DriveItem = PASTED): string {
  const error = parseDriveError(body);
  if (status === 429 || error.status === "RESOURCE_EXHAUSTED" || ((status === 403 || status === 401) && (error.reasons.some((reason) => QUOTA_REASON.test(reason)) || /rateLimit|rate limit|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|sharingRateLimitExceeded|quota/i.test(body)))) {
    return "Google Drive hit a rate limit or quota. Wait a minute and try the folder again.";
  }
  if (error.reasons.some((reason) => KEY_REASON.test(reason)) || /API key not valid|API key expired/i.test(error.message)) {
    return "Google Drive refused the API key. Enable the Drive API, and restrict the key to this site's address if you use HTTP referrers.";
  }
  const notShared =
    status === 404 ||
    ((status === 403 || status === 401) && (error.reasons.some((reason) => NOT_SHARED_REASON.test(reason)) || NOT_SHARED_TEXT.test(error.message)));
  if (notShared && item.kind === "pasted" && !item.name) return PASTED_UNREADABLE;
  if (notShared) {
    return `${describeItem(item)} isn't shared as “Anyone with the link”, so it can't be opened here. Ask for it to be shared that way, or paste the link from your order again.`;
  }
  if (status === 401) {
    return "Google Drive refused the API key. Enable the Drive API, and restrict the key to this site's address if you use HTTP referrers.";
  }
  if (status === 403) {
    // Drive's reasons are short words (forbidden, domainPolicy); anything else is left out.
    const why = error.reasons[0] && /^[A-Za-z_]{1,60}$/.test(error.reasons[0]) ? ` (${error.reasons[0]})` : "";
    return `Google Drive refused to open ${describeItem(item).replace(/^The /, "the ")}${why}.`;
  }
  const snippet = scrubIds(body.replace(/\s+/g, " ")).slice(0, 180);
  return snippet ? `Drive returned ${status}: ${snippet}` : `Drive returned ${status}.`;
}

async function failure(response: Response, item: DriveItem): Promise<DriveError> {
  const body = await response.text();
  return new DriveError(response.status, driveFailure(response.status, body, item), parseDriveError(body).reasons);
}

const LINK_FILE = /^new drive link\.txt$/i;

function nameIsPdfPartialMap(name: string): boolean {
  const plain = plainEditionName(name);
  return plain.includes("pdf") && plain.includes("partialfoil") && plain.includes("map");
}

/**
 * A Partial Foil paste keeps the Deluxe shortcut and the PDF map.
 * A mask folder is not crawled as print files outside a PDF Partial Foil Map (since v0.1.36 it is
 * listed for masks only instead; see isFoilMaskFolder).
 * "Color Partial Foil Map" inside that PDF tree is a real print folder.
 */
export function skipOnPartialFoilCrawl(name: string, insidePdfMap = false): boolean {
  if (isTemplateOrFontFolder(name)) return true;
  if (isStandardEditionFolder(name)) return true;
  const plain = plainEditionName(name);
  return !insidePdfMap && plain.includes("partialfoil") && plain.includes("map") && !plain.includes("pdf");
}

/**
 * The Partial Foil Map mask folder of a Partial Foil paste: listed for its masks only, never as print
 * files. Inside the PDF print map a "Partial Foil Map" is a print folder, not masks.
 */
export function isFoilMaskFolder(name: string, insidePdfMap = false): boolean {
  return !insidePdfMap && !isTemplateOrFontFolder(name) && isFoilMaskFolderName(name);
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

/**
 * A folder a free paste must not open: anything named like a paid edition, including the disguised names
 * the public-root guard refuses (DLX, PF, Partial Foil Templates, a Cyrillic Deluxe).
 */
function isPaidEditionName(name: string): boolean {
  return looksLikePaidName(name);
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
  /** The names the paste went through before its folder is listed (see mapFolderInChain). */
  const rootChain: string[] = [];

  async function resolve(
    id: string,
    fallbackName: string,
    hops: number,
    depth: number,
    ancestors: string[],
    insidePdfMap: boolean,
    followedLink = false,
    item: DriveItem = PASTED,
    mask = false,
    /** The parent listed this folder as the mask folder, by the name it has there (a shortcut's own name). */
    maskRoot = false,
  ): Promise<RawNode | null> {
    if (depth > 12) throw new Error("That Drive folder is nested too deeply to import.");
    if (!followedLink && ancestors.includes(id)) throw new Error("The Drive link loops back to a folder already opened.");
    const cached = cache.get(id);
    if (cached) return cached;
    let metaRead = true;
    const own: DriveFile = await getFileMeta(id, apiKey, fetchImpl, item).catch(() => {
      metaRead = false;
      return { id, name: fallbackName, mimeType: FOLDER };
    });
    if (own.mimeType === SHORTCUT) {
      const target = own.shortcutDetails?.targetId;
      if (!target || own.shortcutDetails?.targetMimeType !== FOLDER) throw new Error("That link is a shortcut to something other than a folder.");
      if (target === id || ancestors.includes(target)) throw new Error("The Drive link loops back to a folder already opened.");
      return resolve(target, own.name || fallbackName, hops, depth, [...ancestors, id], insidePdfMap, true, { kind: "shortcut", name: own.name || fallbackName }, mask, maskRoot);
    }
    const folderName = own.name || fallbackName;
    // The words for this folder if listing it fails: its own name once its metadata could be read.
    const here: DriveItem =
      item.kind === "pasted" ? (metaRead && own.name ? { kind: "pasted", name: own.name } : PASTED)
      : item.kind === "shortcut" ? { kind: "shortcut", name: metaRead && own.name ? own.name : item.name }
      : item.kind === "linked" ? { ...item, ...(metaRead && own.name ? { name: own.name } : {}) }
      : item;
    if (depth === 0) {
      // A Partial Foil Map folder (or one inside it) is never opened: refused before it is listed.
      if (item.kind === "shortcut") rootChain.push(item.name);
      rootChain.push(folderName);
      const map = mapFolderInChain(rootChain);
      if (map) throw new PartialFoilMapLinkError(map.deck);
    }
    if (hops === 0 && depth === 0 && !rootDecided) {
      rootDecided = true;
      const kind = productEditionKind(folderName);
      if (kind === "partial_foil") partialFoilPaste = true;
      if (kind === "deluxe") deluxePaste = true;
    }
    // A free paste never opens a paid folder, even one reached through an innocently named shortcut.
    if (depth > 0 && !partialFoilPaste && !deluxePaste && isPaidEditionName(folderName)) return null;
    const files = await listChildren(id, apiKey, fetchImpl, here);
    const link = files.find((file) => LINK_FILE.test(file.name));
    if (link && hops < 3) {
      const text = await downloadText(link.id, apiKey, fetchImpl, { kind: "file", name: link.name });
      const next = extractFolderIdFromText(text);
      if (next) {
        const chain = [...ancestors, id];
        const stripped = chain.filter((item) => item !== next);
        if (stripped.length !== chain.length) throw new Error("The Drive link loops back to a folder already opened.");
        return resolve(next, folderName, hops + 1, depth, stripped, insidePdfMap, true, { kind: "linked", from: folderName }, mask, maskRoot);
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
        // A Partial Foil paste lists its mask folder for masks only (marked, then kept out of the cards).
        const maskFolder = partialFoilPaste && !mask && isFoilMaskFolder(file.name, pdfMap);
        if (partialFoilPaste && !maskFolder && skipOnPartialFoilCrawl(file.name, pdfMap)) continue;
        if (deluxePaste && skipOnDeluxeCrawl(file.name)) continue;
        const child = await resolve(childId, file.name, hops, depth + 1, nextAncestors, pdfMap || nameIsPdfPartialMap(file.name), false, file.shortcutDetails?.targetId ? { kind: "shortcut", name: file.name } : { kind: "subfolder", name: file.name }, mask || maskFolder, maskFolder);
        if (child) children.push(child);
      } else {
        children.push({ id: file.id, name: file.name, folder: false });
      }
    }
    const node: RawNode = { id, name: folderName, folder: true, children };
    // Decided where the folder was listed: a "Partial Foil Map" shortcut marks its target whatever the target is called.
    if (maskRoot && item.kind !== "file") node.masks = true;
    cache.set(id, node);
    return node;
  }

  const tree = await resolve(folderId, "Unlocked folder", 0, 0, [], false);
  if (!tree) throw new Error("The Drive link loops back to a folder already opened.");
  return partialFoilPaste ? { ...tree, maskScan: true } : tree;
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
