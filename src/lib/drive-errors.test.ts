/**
 * What a failed Drive request says. Only a key reason blames the API key. An item Drive won't show is
 * named by name, never by id: a subfolder or shortcut target "isn't shared as Anyone with the link"; the
 * pasted link itself, whose name can't be read, is most likely a Restricted deck folder pasted instead of an
 * edition folder. Rate limits, quota and anything else read as before. Every id and key here is fake.
 */
import { describe, expect, it } from "vitest";
import { describeItem, DriveError, driveFailure, parseDriveError, PASTED_UNREADABLE, readDriveTree, type DriveItem } from "@/lib/drive";

// Built from pieces so the repo's Drive id scan never sees an id-shaped literal here.
const KEY = ["fake", "ApiKey", "Value", "_0123", "456789", "abcdefghij"].join("");
const FAKE_ID = ["1FakeDrive", "IdForTestsOnly_abcdefghi"].join("");
const KEY_MESSAGE = "Google Drive refused the API key. Enable the Drive API, and restrict the key to this site's address if you use HTTP referrers.";
const QUOTA_MESSAGE = "Google Drive hit a rate limit or quota. Wait a minute and try the folder again.";
const notShared = (subject: string) => `${subject} isn't shared as “Anyone with the link”, so it can't be opened here. Ask for it to be shared that way, or paste the link from your order again.`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** Drive v3's usual error body, with the reason in errors[] (and, as newer replies do, in details[]). */
function v3(status: number, reason: string | null, message: string, statusWord = "") {
  return JSON.stringify({ error: { code: status, message, ...(statusWord ? { status: statusWord } : {}), errors: reason ? [{ domain: "global", reason, message }] : [] } });
}
function details(status: number, reason: string, message: string, statusWord: string) {
  return JSON.stringify({ error: { code: status, message, status: statusWord, details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] } });
}

const KEY_REASONS = ["keyInvalid", "keyExpired", "badKey", "API_KEY_INVALID", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_SERVICE_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "ipRefererBlocked", "accessNotConfigured", "SERVICE_DISABLED"];
const QUOTA_REASONS = ["userRateLimitExceeded", "rateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "sharingRateLimitExceeded", "RATE_LIMIT_EXCEEDED"];
const SHARE_REASONS = ["insufficientFilePermissions", "notFound"];
const OTHER_REASONS = ["forbidden", "domainPolicy", "cannotDownloadAbusiveFile", null];
const STATUSES = [400, 401, 403, 404, 429, 500, 503];

const SUBFOLDER: DriveItem = { kind: "subfolder", name: "Extras" };
const SUB = "The folder “Extras” inside it";

/** The expected words for one status and reason, for a subfolder (named) and for the pasted link (unnamed). */
function expected(status: number, reason: string | null, item: "sub" | "pasted"): RegExp | string {
  const unreadable = item === "pasted";
  if (reason && KEY_REASONS.includes(reason)) return status === 429 ? QUOTA_MESSAGE : KEY_MESSAGE;
  if (status === 429) return QUOTA_MESSAGE;
  if (reason && QUOTA_REASONS.includes(reason) && (status === 401 || status === 403)) return QUOTA_MESSAGE;
  const shareFail = status === 404 || ((status === 401 || status === 403) && reason !== null && SHARE_REASONS.includes(reason));
  if (shareFail) return unreadable ? PASTED_UNREADABLE : notShared(SUB);
  if (status === 401) return KEY_MESSAGE;
  if (status === 403) return `Google Drive refused to open ${unreadable ? "the folder you pasted" : "the folder “Extras” inside it"}${reason ? ` (${reason})` : ""}.`;
  return new RegExp(`^Drive returned ${status}: `);
}

describe("reading Drive's error body", () => {
  it("collects reasons from errors[] and details[], the status word and the message, and survives junk", () => {
    expect(parseDriveError(v3(403, "insufficientFilePermissions", "The user does not have sufficient permissions for file x.", "PERMISSION_DENIED"))).toEqual({ reasons: ["insufficientFilePermissions"], status: "PERMISSION_DENIED", message: "The user does not have sufficient permissions for file x." });
    expect(parseDriveError(details(400, "API_KEY_INVALID", "API key not valid.", "INVALID_ARGUMENT"))).toEqual({ reasons: ["API_KEY_INVALID"], status: "INVALID_ARGUMENT", message: "API key not valid." });
    expect(parseDriveError(JSON.stringify({ error: { errors: [{ reason: "a" }, { reason: "a" }, {}], details: [{ reason: "b" }, null], message: 5 } }))).toEqual({ reasons: ["a", "b"], status: "", message: "" });
    for (const junk of ["", "<html>Not Found</html>", "null", "[]", '{"error":"nope"}', '{"error":{"errors":"x"}}']) expect(parseDriveError(junk)).toEqual({ reasons: [], status: "", message: "" });
  });
});

describe("the words for every reason and status", () => {
  for (const reason of [...KEY_REASONS, ...QUOTA_REASONS, ...SHARE_REASONS, ...OTHER_REASONS]) {
    for (const status of STATUSES) {
      it(`${status} ${reason ?? "(no reason)"}: below the root and for the pasted link`, () => {
        const body = v3(status, reason, `Something about file ${FAKE_ID}.`);
        for (const [item, which] of [[SUBFOLDER, "sub"], [undefined, "pasted"]] as const) {
          const message = driveFailure(status, body, item);
          const want = expected(status, reason, which);
          if (typeof want === "string") expect(message).toBe(want);
          else expect(message).toMatch(want);
          expect(message).not.toContain(FAKE_ID);
        }
      });
    }
  }

  it("reads the reason from details[] too (newer replies), and the key from its message alone", () => {
    for (const reason of ["API_KEY_INVALID", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_SERVICE_BLOCKED"]) {
      expect(driveFailure(403, details(403, reason, "Requests from this referer are blocked.", "PERMISSION_DENIED"), SUBFOLDER)).toBe(KEY_MESSAGE);
    }
    expect(driveFailure(400, JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }))).toBe(KEY_MESSAGE);
    expect(driveFailure(400, JSON.stringify({ error: { code: 400, message: "API key expired. Please renew the API key." } }))).toBe(KEY_MESSAGE);
    expect(driveFailure(403, details(403, "insufficientFilePermissions", "no", "PERMISSION_DENIED"), SUBFOLDER)).toBe(notShared(SUB));
    expect(driveFailure(429, details(429, "RATE_LIMIT_EXCEEDED", "Quota exceeded", "RESOURCE_EXHAUSTED"))).toBe(QUOTA_MESSAGE);
    expect(driveFailure(403, JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric", status: "RESOURCE_EXHAUSTED" } }))).toBe(QUOTA_MESSAGE);
  });

  it("knows 'does not have sufficient permissions' and 'File not found' without a reason", () => {
    for (const status of [401, 403]) {
      expect(driveFailure(status, v3(status, null, `The user does not have sufficient permissions for file ${FAKE_ID}.`), SUBFOLDER)).toBe(notShared(SUB));
      expect(driveFailure(status, v3(status, null, `File not found: ${FAKE_ID}.`), SUBFOLDER)).toBe(notShared(SUB));
      expect(driveFailure(status, v3(status, null, `File not found: ${FAKE_ID}.`))).toBe(PASTED_UNREADABLE);
    }
    expect(driveFailure(404, "<html><title>Not Found</title></html>", SUBFOLDER)).toBe(notShared(SUB));
    expect(driveFailure(404, "")).toBe(PASTED_UNREADABLE);
  });

  it("keeps quota and other errors as before, with any id blanked", () => {
    expect(driveFailure(429, "")).toBe(QUOTA_MESSAGE);
    expect(driveFailure(403, "rate limit exceeded, try later")).toBe(QUOTA_MESSAGE);
    expect(driveFailure(500, "")).toBe("Drive returned 500.");
    expect(driveFailure(503, `Backend error near ${FAKE_ID}   and ${KEY}`)).toBe("Drive returned 503: Backend error near … and …");
  });

  it("names each kind of item by name only", () => {
    expect(describeItem({ kind: "pasted" })).toBe("The folder you pasted");
    expect(describeItem({ kind: "pasted", name: "2_P5 Deluxe Edition" })).toBe("The folder you pasted (“2_P5 Deluxe Edition”)");
    expect(describeItem({ kind: "subfolder", name: "Extras" })).toBe("The folder “Extras” inside it");
    expect(describeItem({ kind: "shortcut", name: "3_P5 Partial Foil Edition" })).toBe("The shortcut target “3_P5 Partial Foil Edition”");
    expect(describeItem({ kind: "linked", from: "Old Pack" })).toBe("The folder that New Drive Link.txt in “Old Pack” points to");
    expect(describeItem({ kind: "linked", from: "Old Pack", name: "New Pack" })).toBe("The folder that New Drive Link.txt in “Old Pack” points to (“New Pack”)");
    expect(describeItem({ kind: "file", name: "decklist.txt" })).toBe("The file “decklist.txt”");
    expect(describeItem({ kind: "subfolder", name: `Copy of ${FAKE_ID}` })).toBe("The folder “Copy of …” inside it");
    expect(driveFailure(404, "", { kind: "pasted", name: "2_P5 Deluxe Edition" })).toBe(notShared("The folder you pasted (“2_P5 Deluxe Edition”)"));
  });
});

/** A fake Drive API: folders and shortcuts by id; `hidden` ones answer 404 or 403 like an item that isn't shared. */
type Node = { name: string; folder?: boolean; children?: string[]; target?: string; hidden?: 403 | 404; listHidden?: 403 | 404 };
function api(world: Record<string, Node>, errorFor = (status: number) => (status === 404 ? v3(404, "notFound", "File not found: x.", "NOT_FOUND") : v3(403, "insufficientFilePermissions", "The user does not have sufficient permissions for file x.", "PERMISSION_DENIED"))) {
  const urls: string[] = [];
  const fetchImpl = async (input: string) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    urls.push(url);
    const parent = url.match(/'([^']+)' in parents/)?.[1];
    if (parent) {
      const node = world[parent];
      if (!node || node.hidden || node.listHidden) return new Response(errorFor(node?.hidden ?? node?.listHidden ?? 404), { status: node?.hidden ?? node?.listHidden ?? 404 });
      return json({ files: (node.children ?? []).map((id) => meta(id)) });
    }
    const id = url.match(/\/files\/([^?/]+)/)?.[1] ?? "";
    const node = world[id];
    if (!node || node.hidden) return new Response(errorFor(node?.hidden ?? 404), { status: node?.hidden ?? 404 });
    if (url.includes("alt=media")) return new Response("");
    return json(meta(id));
  };
  function meta(id: string) {
    const node = world[id]!;
    if (node.target) return { id, name: node.name, mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: node.target, targetMimeType: "application/vnd.google-apps.folder" } };
    return { id, name: node.name, mimeType: node.folder === false ? "image/png" : "application/vnd.google-apps.folder" };
  }
  return { fetchImpl, urls };
}

async function failureOf(world: Record<string, Node>, root: string, errorFor?: (status: number) => string): Promise<DriveError> {
  const { fetchImpl } = api(world, errorFor);
  const error = await readDriveTree(root, KEY, fetchImpl).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DriveError);
  const message = (error as Error).message;
  for (const id of [...Object.keys(world), root, KEY]) expect(message).not.toContain(id);
  return error as DriveError;
}

describe("unlocking: which item failed", () => {
  for (const status of [403, 404] as const) {
    it(`a pasted link that answers ${status} (a Restricted deck folder) asks for the edition folder's link`, async () => {
      const world: Record<string, Node> = { deckParent_fake01: { name: "10_Persona 5", hidden: status, children: [] } };
      const error = await failureOf(world, "deckParent_fake01");
      expect(error.message).toBe(PASTED_UNREADABLE);
      expect(error.message).not.toContain("10_Persona 5");
      expect(error.reasons).toEqual([status === 404 ? "notFound" : "insufficientFilePermissions"]);
    });

    it(`a subfolder that answers ${status} is named, inside a pasted Deluxe folder`, async () => {
      const world: Record<string, Node> = {
        deluxeRoot_fake01: { name: "2_P5 Deluxe Edition", children: ["fullDeck_fake001", "extras_fake0001"] },
        fullDeck_fake001: { name: "Full Deck", children: [] },
        extras_fake0001: { name: "Extras", hidden: status },
      };
      expect((await failureOf(world, "deluxeRoot_fake01")).message).toBe(notShared("The folder “Extras” inside it"));
    });

    it(`a shortcut target that answers ${status} is named by the shortcut, inside a pasted Partial Foil folder`, async () => {
      const world: Record<string, Node> = {
        partialRoot_fake1: { name: "3_P5 Partial Foil Edition", children: ["scut_fake000001"] },
        scut_fake000001: { name: "PDF Partial Foil Map", target: "mapTarget_fake01" },
        mapTarget_fake01: { name: "Map (moved)", hidden: status },
      };
      expect((await failureOf(world, "partialRoot_fake1")).message).toBe(notShared("The shortcut target “PDF Partial Foil Map”"));
    });

    it(`a pasted shortcut whose target answers ${status} names the shortcut, not the pasted link`, async () => {
      const world: Record<string, Node> = {
        pastedScut_fake1: { name: "2_P5 Deluxe Edition", target: "deluxeGone_fake1" },
        deluxeGone_fake1: { name: "2_P5 Deluxe Edition (old)", hidden: status },
      };
      expect((await failureOf(world, "pastedScut_fake1")).message).toBe(notShared("The shortcut target “2_P5 Deluxe Edition”"));
    });
  }

  it("names the folder by its own name when its metadata reads but its listing is refused", async () => {
    const world: Record<string, Node> = {
      deluxeRoot_fake01: { name: "2_P5 Deluxe Edition", listHidden: 403 },
    };
    expect((await failureOf(world, "deluxeRoot_fake01")).message).toBe(notShared("The folder you pasted (“2_P5 Deluxe Edition”)"));
    const shortcut: Record<string, Node> = {
      pastedScut_fake1: { name: "P5 DLX link", target: "deluxeReal_fake1" },
      deluxeReal_fake1: { name: "2_P5 Deluxe Edition", listHidden: 404 },
    };
    expect((await failureOf(shortcut, "pastedScut_fake1")).message).toBe(notShared("The shortcut target “2_P5 Deluxe Edition”"));
  });

  it("names a New Drive Link.txt hop that isn't shared", async () => {
    const world: Record<string, Node> = {
      oldPack_fake0001: { name: "2_P5 Deluxe Edition", children: ["linkFile_fake001"] },
      linkFile_fake001: { name: "New Drive Link.txt", folder: false },
    };
    const { fetchImpl: base } = api(world);
    const fetchImpl = async (input: string) => {
      if (String(input).includes("linkFile_fake001") && String(input).includes("alt=media")) return new Response("https://drive.google.com/drive/folders/newPackGone_fake1");
      if (String(input).includes("newPackGone_fake1")) return new Response(v3(404, "notFound", "File not found: newPackGone_fake1."), { status: 404 });
      return base(input);
    };
    const error = await readDriveTree("oldPack_fake0001", KEY, fetchImpl).catch((caught: Error) => caught);
    expect((error as Error).message).toBe(notShared("The folder that New Drive Link.txt in “2_P5 Deluxe Edition” points to"));
    expect((error as Error).message).not.toMatch(/newPackGone|oldPack|linkFile/);
  });

  it("blames the key only for a key reason, and keeps quota as it was", async () => {
    // Every request answers the same way: the folder's metadata (which is allowed to fail) and its listing.
    const world: Record<string, Node> = { deluxeRoot_fake01: { name: "2_P5 Deluxe Edition", hidden: 403 } };
    const keyBad = await failureOf(world, "deluxeRoot_fake01", () => details(403, "API_KEY_HTTP_REFERRER_BLOCKED", "Requests from referer are blocked.", "PERMISSION_DENIED"));
    expect(keyBad.message).toBe(KEY_MESSAGE);
    expect(keyBad.reasons).toEqual(["API_KEY_HTTP_REFERRER_BLOCKED"]);
    const quota = await failureOf(world, "deluxeRoot_fake01", () => v3(403, "userRateLimitExceeded", "User Rate Limit Exceeded"));
    expect(quota.message).toBe(QUOTA_MESSAGE);
    const bare = await failureOf(world, "deluxeRoot_fake01", () => JSON.stringify({ error: { code: 403, message: "Forbidden" } }));
    expect(bare.message).toBe("Google Drive refused to open the folder you pasted.");
  });
});
