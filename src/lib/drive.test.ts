import { describe, expect, it } from "vitest";
import { assertApiKey, extractFolderIdFromText, listChildren, parseDriveFolderId, readDriveTree, skipOnPartialFoilCrawl } from "@/lib/drive";
import { catalogueFromTree } from "@/lib/group";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("drive links", () => {
  it("reads folder ids from the links a buyer pastes", () => {
    expect(parseDriveFolderId("https://drive.google.com/drive/folders/1AbcdEFGHij")).toBe("1AbcdEFGHij");
    expect(parseDriveFolderId("https://drive.google.com/drive/u/0/folders/1AbcdEFGHij?usp=sharing")).toBe("1AbcdEFGHij");
    expect(parseDriveFolderId("https://drive.google.com/open?id=1AbcdEFGHij")).toBe("1AbcdEFGHij");
    expect(parseDriveFolderId("1AbcdEFGHij")).toBe("1AbcdEFGHij");
    expect(parseDriveFolderId("not a link")).toBeNull();
    expect(extractFolderIdFromText("newer pack:\nhttps://drive.google.com/drive/folders/1NewFolder99\n")).toBe("1NewFolder99");
  });

  it("refuses the placeholder key before calling Drive", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse({});
    };
    expect(() => assertApiKey("YOUR_GOOGLE_API_KEY")).toThrow(/config\.js/);
    expect(called).toBe(false);
    await expect(listChildren("folder123456", "YOUR_GOOGLE_API_KEY", fetchImpl)).resolves.toBeDefined();
    expect(called).toBe(true);
  });
});

describe("mocked Drive API", () => {
  it("follows pagination and a New Drive Link, and ignores the old folder", async () => {
    const fetchImpl = async (input: string) => {
      const url = String(input);
      if (url.includes("alt=media")) return new Response("Use this instead https://drive.google.com/drive/folders/folderNewBBBB");
      if (url.includes("/files/folderRootAA")) return jsonResponse({ id: "folderRootAA", name: "Old pack", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/folderNewBBBB")) return jsonResponse({ id: "folderNewBBBB", name: "2_Silksong Deluxe Edition", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/fullDeckBBBB")) return jsonResponse({ id: "fullDeckBBBB", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      const token = new URL(url).searchParams.get("pageToken");
      if (parent === "folderRootAA") {
        return jsonResponse({
          files: [
            { id: "linkFileAAAA", name: "New Drive Link.txt", mimeType: "text/plain" },
            { id: "decoyFileAAA", name: "Should Not Ship.jpg", mimeType: "image/jpeg" },
          ],
        });
      }
      if (parent === "folderNewBBBB") {
        return jsonResponse({
          files: [{ id: "fullDeckBBBB", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "fullDeckBBBB") {
        if (!token) {
          return jsonResponse({
            nextPageToken: "page-2",
            files: [{ id: "solRingPage1", name: "Sol Ring.jpg", mimeType: "image/jpeg" }],
          });
        }
        return jsonResponse({
          files: [{ id: "islandPage02", name: "Island.jpg", mimeType: "image/jpeg" }],
        });
      }
      return jsonResponse({ error: { message: "missing" } }, 404);
    };

    const tree = await readDriveTree("folderRootAA", "test-api-key-value", fetchImpl);
    const flat = JSON.stringify(tree);
    expect(flat).not.toContain("decoyFileAAA");
    expect(flat).not.toContain("Should Not Ship");
    expect(flat).toContain("solRingPage1");
    expect(flat).toContain("islandPage02");
    const catalogue = catalogueFromTree(tree);
    expect(catalogue.name).toBe("Silksong");
    expect(catalogue.editions[0]!.printType).toBe("standard");
    expect(catalogue.editions[0]!.id).toBe("2-silksong-deluxe-edition");
    expect(catalogue.editions[0]!.cards.map((card) => card.name).sort()).toEqual(["Island", "Sol Ring"]);
  });

  it("surfaces a key failure from the API, and a bare 403 without blaming the key", async () => {
    const keyBad = async () => jsonResponse({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400);
    await expect(readDriveTree("folderRootAA", "test-api-key-value", keyBad)).rejects.toThrow(/refused the API key/);
    const bare = async () => jsonResponse({ error: { message: "forbidden" } }, 403);
    await expect(readDriveTree("folderRootAA", "test-api-key-value", bare)).rejects.toThrow(/^Google Drive refused to open the folder you pasted\.$/);
  });

  it("skips a shortcut diamond and still throws on a real cycle", async () => {
    const fetchImpl = async (input: string) => {
      const url = String(input);
      if (url.includes("/files/packFolder01")) return jsonResponse({ id: "packFolder01", name: "3_P5", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/standardFol1")) return jsonResponse({ id: "standardFol1", name: "Standard Edition (600 DPI)", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/fullDeckFol1")) return jsonResponse({ id: "fullDeckFol1", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent === "packFolder01") {
        return jsonResponse({
          files: [
            { id: "standardFol1", name: "Standard Edition (600 DPI)", mimeType: "application/vnd.google-apps.folder" },
            {
              id: "shortcut0001",
              name: "Standard Edition (600 DPI)",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "standardFol1", targetMimeType: "application/vnd.google-apps.folder" },
            },
          ],
        });
      }
      if (parent === "standardFol1") {
        return jsonResponse({
          files: [{ id: "fullDeckFol1", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "fullDeckFol1") {
        return jsonResponse({ files: [{ id: "solRingFile1", name: "Sol Ring.jpg", mimeType: "image/jpeg" }] });
      }
      return jsonResponse({ error: { message: "missing" } }, 404);
    };
    const tree = await readDriveTree("packFolder01", "test-api-key-value", fetchImpl);
    expect(JSON.stringify(tree)).toContain("solRingFile1");
    const listedOnce = JSON.stringify(tree).split("solRingFile1").length - 1;
    expect(listedOnce).toBe(2);
    expect(tree.children?.filter((child) => child.id === "standardFol1")).toHaveLength(2);

    let rootLists = 0;
    const cycleFetch = async (input: string) => {
      const url = String(input);
      if (url.includes("/files/cycleRoot001")) return jsonResponse({ id: "cycleRoot001", name: "Pack", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/innerFolder01")) return jsonResponse({ id: "innerFolder01", name: "Inner", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent === "cycleRoot001") {
        rootLists += 1;
        return jsonResponse({
          files: [{ id: "innerFolder01", name: "Inner", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "innerFolder01") {
        return jsonResponse({
          files: [{ id: "linkCycle001", name: "New Drive Link.txt", mimeType: "text/plain" }],
        });
      }
      if (url.includes("alt=media")) return new Response("back to https://drive.google.com/drive/folders/cycleRoot001");
      return jsonResponse({ error: { message: "missing" } }, 404);
    };
    await expect(readDriveTree("cycleRoot001", "test-api-key-value", cycleFetch)).rejects.toThrow(/loops back/);
    expect(rootLists).toBe(1);
  });

  it("still rejects a parent that contains several decks", () => {
    const tree = {
      id: "alldecks0001",
      name: "Beespair Decks",
      folder: true,
      children: [
        {
          id: "deckOne00001",
          name: "1_Silksong",
          folder: true,
          children: [{ id: "fullOne000001", name: "Full Deck", folder: true, children: [{ id: "solRingFileA", name: "Sol Ring.jpg", folder: false }] }],
        },
        {
          id: "deckTwo00001",
          name: "2_Vader",
          folder: true,
          children: [{ id: "fullTwo000001", name: "Full Deck", folder: true, children: [{ id: "islandFileB", name: "Island.jpg", folder: false }] }],
        },
      ],
    };
    expect(() => catalogueFromTree(tree)).toThrow(/one deck or one edition/);
  });

  it("does not list mask or Standard folders on a Partial Foil paste, and still opens Deluxe and the PDF map", async () => {
    const listed: string[] = [];
    const fetchImpl = async (input: string) => {
      const url = String(input);
      const meta: Record<string, { id: string; name: string }> = {
        partialRoot1: { id: "partialRoot1", name: "3_P5 Partial Foil Edition" },
        pdfMapFolder1: { id: "pdfMapFolder1", name: "PDF Partial Foil Map" },
        pdfFullDeck1: { id: "pdfFullDeck1", name: "Full Deck" },
        deluxeFold01: { id: "deluxeFold01", name: "Deluxe Edition" },
        deluxeFull01: { id: "deluxeFull01", name: "Full Deck" },
      };
      const metaId = Object.keys(meta).find((id) => url.includes(`/files/${id}`));
      if (metaId) return jsonResponse({ ...meta[metaId], mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent) listed.push(parent);
      if (parent === "partialRoot1") {
        return jsonResponse({
          files: [
            { id: "maskFolder01", name: "Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
            { id: "pdfMapFolder1", name: "PDF Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
            {
              id: "deluxeShort1",
              name: "Deluxe Edition",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "deluxeFold01", targetMimeType: "application/vnd.google-apps.folder" },
            },
            {
              id: "stdShortcut1",
              name: "1_P5 Standard Edition",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "stdFolder001", targetMimeType: "application/vnd.google-apps.folder" },
            },
            { id: "templates001", name: "Templates", mimeType: "application/vnd.google-apps.folder" },
          ],
        });
      }
      if (parent === "pdfMapFolder1") {
        return jsonResponse({
          files: [{ id: "pdfFullDeck1", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "pdfFullDeck1") {
        return jsonResponse({ files: [{ id: "pdfSolRing01", name: "Sol Ring.pdf", mimeType: "application/pdf" }] });
      }
      if (parent === "deluxeFold01") {
        return jsonResponse({
          files: [
            { id: "deluxeFull01", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" },
            {
              id: "stdInside001",
              name: "Standard Edition (600 DPI)",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "stdInside001", targetMimeType: "application/vnd.google-apps.folder" },
            },
          ],
        });
      }
      if (parent === "deluxeFull01") {
        return jsonResponse({ files: [{ id: "deluxeSolArt", name: "Sol Ring.png", mimeType: "image/png" }] });
      }
      if (parent === "maskFolder01" || parent === "stdFolder001" || parent === "stdInside001" || parent === "templates001") {
        return jsonResponse({ files: [{ id: "shouldNotList", name: "Secret.jpg", mimeType: "image/jpeg" }] });
      }
      return jsonResponse({ error: { message: "missing" } }, 404);
    };
    const tree = await readDriveTree("partialRoot1", "test-api-key-value", fetchImpl);
    expect(listed).toEqual(expect.arrayContaining(["partialRoot1", "pdfMapFolder1", "pdfFullDeck1", "deluxeFold01", "deluxeFull01"]));
    for (const skipped of ["maskFolder01", "stdFolder001", "stdInside001", "templates001"]) {
      expect(listed).not.toContain(skipped);
    }
    const flat = JSON.stringify(tree);
    expect(flat).toContain("pdfSolRing01");
    expect(flat).toContain("deluxeSolArt");
    expect(flat).not.toContain("shouldNotList");
    expect(flat).not.toContain("maskFolder01");
    const catalogue = catalogueFromTree(tree);
    const partial = catalogue.editions.find((edition) => edition.printType === "partial_foil")!;
    const deluxe = catalogue.editions.find((edition) => edition.id.includes("deluxe"))!;
    const art = partial.cards.find((card) => card.name === "Sol Ring")!.faces[0]!.defaultArt!;
    expect(art.id).toBe("pdfSolRing01");
    expect(art.thumbId).toBe("deluxeSolArt");
    expect(deluxe.cards.some((card) => card.name === "Sol Ring")).toBe(true);
  });

  it("does not list Standard or Templates folders on a Deluxe paste, and still unlocks the Deluxe art", async () => {
    const listed: string[] = [];
    const fetchImpl = async (input: string) => {
      const url = String(input);
      if (url.includes("/files/deluxeRoot01")) return jsonResponse({ id: "deluxeRoot01", name: "2_P5 Deluxe Edition", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/deluxeFull02")) return jsonResponse({ id: "deluxeFull02", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent) listed.push(parent);
      if (parent === "deluxeRoot01") {
        return jsonResponse({
          files: [
            { id: "deluxeFull02", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" },
            { id: "templates002", name: "Templates", mimeType: "application/vnd.google-apps.folder" },
            {
              id: "stdShortcut2",
              name: "Standard Edition (600 DPI)",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "stdFolder002", targetMimeType: "application/vnd.google-apps.folder" },
            },
          ],
        });
      }
      if (parent === "deluxeFull02") {
        return jsonResponse({
          files: [
            { id: "deluxeSolPng1", name: "Sol Ring.png", mimeType: "image/png" },
            { id: "deluxeIslandP", name: "Island.pdf", mimeType: "application/pdf" },
            {
              id: "stdNested002",
              name: "1_P5 Standard Edition",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: { targetId: "stdNested002", targetMimeType: "application/vnd.google-apps.folder" },
            },
          ],
        });
      }
      if (parent === "stdFolder002" || parent === "stdNested002" || parent === "templates002") {
        return jsonResponse({ files: [{ id: "shouldNotList", name: "Secret.jpg", mimeType: "image/jpeg" }] });
      }
      return jsonResponse({ error: { message: "missing" } }, 404);
    };
    const tree = await readDriveTree("deluxeRoot01", "test-api-key-value", fetchImpl);
    expect(listed).toEqual(expect.arrayContaining(["deluxeRoot01", "deluxeFull02"]));
    for (const skipped of ["stdFolder002", "stdNested002", "templates002"]) expect(listed).not.toContain(skipped);
    const flat = JSON.stringify(tree);
    expect(flat).toContain("deluxeSolPng1");
    expect(flat).toContain("deluxeIslandP");
    expect(flat).not.toContain("shouldNotList");
    const edition = catalogueFromTree(tree).editions[0]!;
    expect(edition.id).toContain("deluxe");
    expect(edition.printType).toBe("standard");
    const sol = edition.cards.find((card) => card.name === "Sol Ring")!.faces[0]!.defaultArt!;
    expect(sol.id).toBe("deluxeSolPng1");
    expect(sol.thumbId).toBe("deluxeSolPng1");
    expect(edition.cards.find((card) => card.name === "Island")!.faces[0]!.defaultArt!.id).toBe("deluxeIslandP");
  });

  it("still lists a Standard folder when the paste is a pack", async () => {
    const listed: string[] = [];
    const fetchImpl = async (input: string) => {
      const url = String(input);
      if (url.includes("/files/packRoot0002")) return jsonResponse({ id: "packRoot0002", name: "3_P5", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/stdFolder003")) return jsonResponse({ id: "stdFolder003", name: "Standard Edition (600 DPI)", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/stdFull00003")) return jsonResponse({ id: "stdFull00003", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent) listed.push(parent);
      if (parent === "packRoot0002") {
        return jsonResponse({
          files: [{ id: "stdFolder003", name: "Standard Edition (600 DPI)", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "stdFolder003") {
        return jsonResponse({
          files: [{ id: "stdFull00003", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" }],
        });
      }
      if (parent === "stdFull00003") {
        return jsonResponse({ files: [{ id: "stdSolRing03", name: "Sol Ring.jpg", mimeType: "image/jpeg" }] });
      }
      return jsonResponse({ error: { message: "missing" } }, 404);
    };
    const tree = await readDriveTree("packRoot0002", "test-api-key-value", fetchImpl);
    expect(listed).toContain("stdFolder003");
    expect(JSON.stringify(tree)).toContain("stdSolRing03");
  });

  it("reuses a visited edition in either listing order and still throws when a link points at an ancestor", async () => {
    const pack = (order: "deluxe-first" | "partial-first") => {
      const standard = { id: "stdFolder009", name: "1_P5 Standard Edition", mimeType: "application/vnd.google-apps.folder" };
      const deluxe = { id: "deluxeFold09", name: "2_P5 Deluxe Edition", mimeType: "application/vnd.google-apps.folder" };
      const partial = { id: "partialFold9", name: "3_P5 Partial Foil Edition", mimeType: "application/vnd.google-apps.folder" };
      const listed: string[] = [];
      const fetchImpl = async (input: string) => {
        const url = String(input);
        if (url.includes("orderBy=folder")) {
          // Stable Drive order is requested on every listing.
        }
        if (url.includes("/files/packOrder009")) return jsonResponse({ id: "packOrder009", name: "3_P5", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/stdFolder009")) return jsonResponse({ id: "stdFolder009", name: "1_P5 Standard Edition", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/deluxeFold09")) return jsonResponse({ id: "deluxeFold09", name: "2_P5 Deluxe Edition", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/partialFold9")) return jsonResponse({ id: "partialFold9", name: "3_P5 Partial Foil Edition", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/stdFull00009")) return jsonResponse({ id: "stdFull00009", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/deluxeFull09")) return jsonResponse({ id: "deluxeFull09", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/pdfMap000009")) return jsonResponse({ id: "pdfMap000009", name: "PDF Partial Foil Map", mimeType: "application/vnd.google-apps.folder" });
        if (url.includes("/files/colorMap0009")) return jsonResponse({ id: "colorMap0009", name: "Color Partial Foil Map", mimeType: "application/vnd.google-apps.folder" });
        const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
        if (parent) listed.push(parent);
        if (!url.includes("orderBy=folder")) return jsonResponse({ error: { message: "missing order" } }, 500);
        if (parent === "packOrder009") {
          const deluxeShortcut = {
            id: "stdShort0009",
            name: "Standard Edition (600 DPI)",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "stdFolder009", targetMimeType: "application/vnd.google-apps.folder" },
          };
          const partialShortcut = {
            id: "deluxeShort9",
            name: "Deluxe Edition",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "deluxeFold09", targetMimeType: "application/vnd.google-apps.folder" },
          };
          const files = order === "deluxe-first" ? [deluxe, deluxeShortcut, standard] : [partial, partialShortcut, deluxe, standard];
          return jsonResponse({ files });
        }
        if (parent === "stdFolder009") return jsonResponse({ files: [{ id: "stdFull00009", name: "Full Deck", mimeType: "application/vnd.google-apps.folder" }] });
        if (parent === "stdFull00009") return jsonResponse({ files: [{ id: "stdSol000009", name: "Sol Ring.jpg", mimeType: "image/jpeg" }] });
        if (parent === "deluxeFold09") {
          return jsonResponse({
            files: [
              { id: "deluxeSol009", name: "Sol Ring.png", mimeType: "image/png" },
              { id: "bearer000009", name: "Standard Bearer", mimeType: "application/vnd.google-apps.folder" },
              { id: "substd000009", name: "Substandard", mimeType: "application/vnd.google-apps.folder" },
              {
                id: "stdInside009",
                name: "Standard Edition (600 DPI)",
                mimeType: "application/vnd.google-apps.shortcut",
                shortcutDetails: { targetId: "stdFolder009", targetMimeType: "application/vnd.google-apps.folder" },
              },
            ],
          });
        }
        if (parent === "bearer000009" || parent === "substd000009") return jsonResponse({ files: [{ id: parent === "bearer000009" ? "bearerFile09" : "substdFile09", name: "Art.png", mimeType: "image/png" }] });
        if (parent === "partialFold9") {
          return jsonResponse({
            files: [
              { id: "maskMap000009", name: "Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
              { id: "pdfMap000009", name: "PDF Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
              { id: "foilTemplates", name: "Partial Foil Templates", mimeType: "application/vnd.google-apps.folder" },
              { id: "foilFonts0009", name: "Partial Foil Fonts", mimeType: "application/vnd.google-apps.folder" },
            ],
          });
        }
        if (parent === "pdfMap000009") {
          return jsonResponse({
            files: [
              { id: "colorMap0009", name: "Color Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
              { id: "bwMap0000009", name: "Black and White Partial Foil Map", mimeType: "application/vnd.google-apps.folder" },
            ],
          });
        }
        if (parent === "colorMap0009") return jsonResponse({ files: [{ id: "colorPdf00009", name: "Sol Ring.pdf", mimeType: "application/pdf" }] });
        if (parent === "bwMap0000009") return jsonResponse({ files: [{ id: "bwPdf00000009", name: "Sol Ring.pdf", mimeType: "application/pdf" }] });
        return jsonResponse({ files: [] });
      };
      return { fetchImpl, listed };
    };

    for (const order of ["deluxe-first", "partial-first"] as const) {
      // A free paste of the whole deck folder yields Standard only: the paid folders beside it,
      // and shortcuts to them, are never listed (since v0.1.33).
      const { fetchImpl, listed } = pack(order);
      const tree = await readDriveTree("packOrder009", "test-api-key-value", fetchImpl);
      const flat = JSON.stringify(tree);
      expect(flat).toContain("stdSol000009");
      expect(flat).not.toContain("deluxeSol009");
      expect(flat).not.toContain("colorPdf00009");
      expect(listed).not.toContain("deluxeFold09");
      expect(listed).not.toContain("partialFold9");
      expect(listed.filter((id) => id === "stdFolder009")).toHaveLength(1);
      const catalogue = catalogueFromTree(tree);
      expect(catalogue.editions.every((edition) => edition.printType === "standard")).toBe(true);
      expect(catalogue.editions.some((edition) => edition.cards.some((card) => card.faces[0]?.defaultArt?.id === "stdSol000009"))).toBe(true);

      // Pasting the Deluxe folder itself (the Ko-fi link) unlocks it, and its shortcut back to Standard
      // is listed once.
      const direct = pack(order);
      const deluxeFlat = JSON.stringify(await readDriveTree("deluxeFold09", "test-api-key-value", direct.fetchImpl));
      expect(deluxeFlat).toContain("deluxeSol009");
      expect(deluxeFlat).toContain("bearerFile09");
      expect(deluxeFlat).toContain("substdFile09");
      expect(direct.listed.filter((id) => id === "stdFolder009").length).toBeLessThanOrEqual(1);
      expect(direct.listed).not.toContain("partialFold9");
      if (order === "partial-first") {
        const foil = pack(order);
        const foilFlat = JSON.stringify(await readDriveTree("partialFold9", "test-api-key-value", foil.fetchImpl));
        expect(foilFlat).toContain("colorPdf00009");
        expect(foilFlat).toContain("bwPdf00000009");
        expect(foil.listed).not.toContain("deluxeFold09");
      }
    }
    const partial = pack("partial-first");
    const partialTree = JSON.stringify(await readDriveTree("partialFold9", "test-api-key-value", partial.fetchImpl));
    expect(partialTree).toContain("colorPdf00009");
    expect(partialTree).toContain("bwPdf00000009");
    expect(partial.listed).not.toContain("maskMap000009");
    expect(partial.listed).not.toContain("foilTemplates");
    expect(partial.listed).not.toContain("foilFonts0009");
    const deluxe = pack("deluxe-first");
    const deluxeTree = JSON.stringify(await readDriveTree("deluxeFold09", "test-api-key-value", deluxe.fetchImpl));
    expect(deluxeTree).toContain("bearerFile09");
    expect(deluxeTree).toContain("substdFile09");
    expect(deluxeTree).toContain("deluxeSol009");
    expect(deluxe.listed).not.toContain("stdFolder009");
    expect(skipOnPartialFoilCrawl("Color Partial Foil Map", true)).toBe(false);
    expect(skipOnPartialFoilCrawl("Partial Foil Map", false)).toBe(true);
    expect(skipOnPartialFoilCrawl("Partial Foil Templates")).toBe(true);
    expect(skipOnPartialFoilCrawl("Standard Bearer")).toBe(false);
  });

  it("throws when a shortcut points at an ancestor, before the folder is cached", async () => {
    const fetchImpl = async (input: string) => {
      const url = String(input);
      if (url.includes("/files/ancestorRoot")) return jsonResponse({ id: "ancestorRoot", name: "Pack", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes("/files/ancestorChild")) return jsonResponse({ id: "ancestorChild", name: "Inner", mimeType: "application/vnd.google-apps.folder" });
      const parent = decodeURIComponent(url).replace(/\+/g, " ").match(/'([^']+)' in parents/)?.[1];
      if (parent === "ancestorRoot") {
        return jsonResponse({ files: [{ id: "ancestorChild", name: "Inner", mimeType: "application/vnd.google-apps.folder" }] });
      }
      if (parent === "ancestorChild") {
        return jsonResponse({
          files: [{
            id: "backToRoot01",
            name: "Back",
            mimeType: "application/vnd.google-apps.shortcut",
            shortcutDetails: { targetId: "ancestorRoot", targetMimeType: "application/vnd.google-apps.folder" },
          }],
        });
      }
      return jsonResponse({ files: [] });
    };
    await expect(readDriveTree("ancestorRoot", "test-api-key-value", fetchImpl)).rejects.toThrow(/loops back/);
  });

  it("surfaces a 403 quota or rate limit on its own", async () => {
    const fetchImpl = async () => jsonResponse({ error: { errors: [{ reason: "userRateLimitExceeded" }], message: "Rate Limit Exceeded" } }, 403);
    await expect(readDriveTree("folderRootAA", "test-api-key-value", fetchImpl)).rejects.toThrow(/rate limit or quota/);
  });
});
