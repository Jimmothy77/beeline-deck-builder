/**
 * Apply each review mutation, run the test that should kill it, and restore the file.
 * A mutation counts as killed only when vitest's JSON report shows at least one test that ran and
 * failed. A non-zero exit alone is not a kill: a patch that breaks parsing, a suite that fails to load,
 * or a filter that matches no test is reported as INVALID. A mutation that still passes, an invalid
 * one, or a patch that no longer applies is a failure of this script.
 *
 *   npx tsx scripts/mutate.ts
 *   MUTATE_ONLY='^v36-' npx tsx scripts/mutate.ts   # only the mutations whose name matches
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verdictOf, type Report, type Verdict } from "./mutate-verdict";

const root = new URL("..", import.meta.url).pathname;

type Edit = { from: string; to: string };

type Mutation = {
  name: string;
  file: string;
  test: string;
  edits: Edit[];
};

const mutations: Mutation[] = [
  {
    name: "p-copyCount negatives",
    file: "src/lib/selection.ts",
    test: "all cards adds extras",
    edits: [{ from: "sum + (pair.qty > 0 ? pair.qty : 0)", to: "sum + pair.qty" }],
  },
  {
    name: "p-picksFit blank-ok off",
    file: "src/lib/storage.ts",
    test: "keeps a free deck at 100",
    edits: [{ from: "!pair.art || ids.has(pair.art)", to: "ids.has(pair.art)" }],
  },
  {
    name: "a-alt match off",
    file: "src/lib/group.ts",
    test: "uses the face match for an exact back name",
    edits: [
      {
        from: `      const hit = matchFile(parsed, mains);
      if (hit && "card" in hit) {
        addAlternate(hit.face, file, parsed);
        continue;
      }`,
        to: `      const hit = matchFile(parsed, mains);
      if (false && hit && "card" in hit) {
        addAlternate(hit.face, file, parsed);
        continue;
      }`,
      },
    ],
  },
  {
    name: "a-alt replaces default",
    file: "src/lib/group.ts",
    test: "puts Esper Terra",
    edits: [
      {
        from: "  face.alternates = sortArts([...face.alternates, artFrom(file, parsed, thumbs)]);",
        to: "  face.defaultArt = artFrom(file, parsed, thumbs);",
      },
    ],
  },
  {
    name: "x-keys ambiguous ok",
    file: "src/lib/storage.ts",
    test: "does not retarget a file from an unrelated catalogue",
    edits: [{ from: "  if (keys.length !== 1) return null;", to: "  if (keys.length < 1) return null;" }],
  },
  {
    name: "x-related any",
    file: "src/lib/storage.ts",
    test: "does not retarget a file from an unrelated catalogue",
    edits: [{ from: "  const related = relatedCatalogues(catalogues, deck);", to: "  const related = catalogues;" }],
  },
  {
    name: "x-related name fallback any",
    file: "src/lib/storage.ts",
    test: "does not retarget a file from an unrelated catalogue",
    edits: [{ from: "  if (byName.length !== 1) return null;", to: "  if (byName.length === 0) return null;" }],
  },
  {
    name: "x-named keeps stale art",
    file: "src/lib/storage.ts",
    test: "exports all 306",
    edits: [
      {
        from: "          add(card.id, defaultArtOf(card), piece.qty, row.locked, card.faces[1]?.defaultArt?.id);",
        to: "          add(card.id, piece.art, piece.qty, row.locked, piece.back);",
      },
    ],
  },
  {
    name: "x-legacy last art",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [{ from: "      else if (!front) front = artId.trim();", to: "      else if (true) front = artId.trim();" }],
  },
  {
    name: "x-pairs no clamp",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [
      {
        from: "      return [{ art, qty: clampQty(pair.qty), ...(back ? { back } : {}) }];",
        to: "      return [{ art, qty: typeof pair.qty === \"number\" ? pair.qty : 0, ...(back ? { back } : {}) }];",
      },
    ],
  },
  {
    name: "old 6: first owner loses",
    file: "src/lib/storage.ts",
    test: "keeps the first owner",
    edits: [{ from: "        if (art && !owners.has(art.id)) owners.set(art.id, card.id);", to: "        if (art) owners.set(art.id, card.id);" }],
  },
  {
    name: "old 6: file id branch off",
    file: "src/lib/storage.ts",
    test: "keeps the first owner",
    edits: [
      {
        from: "      if (!piece.art && !known.has(row.cardId) && owners.has(row.cardId)) {",
        to: "      if (false && !piece.art && !known.has(row.cardId) && owners.has(row.cardId)) {",
      },
    ],
  },
  {
    name: "old 6: art from another card kept",
    file: "src/lib/storage.ts",
    test: "keeps the first owner",
    edits: [
      {
        from: "        add(owner, piece.art, piece.qty, row.locked, back);",
        to: "        add(known.has(row.cardId) ? row.cardId : owner, piece.art, piece.qty, row.locked, back);",
      },
    ],
  },
  {
    name: "old 6: raw legacy art key kept",
    file: "src/lib/storage.ts",
    test: "keeps the first owner",
    edits: [{ from: "      else if (!front) front = artId.trim();", to: "      else if (!front) front = faceId;" }],
  },
  {
    name: "old 6: scanner ignored pass off",
    file: "src/lib/public-ids.ts",
    test: "scans an ignored file",
    edits: [
      {
        from: "  const files = new Set<string>([...listSourceFiles(root), ...listIgnoredFiles(root)]);",
        to: "  const files = new Set<string>([...listSourceFiles(root)]);",
      },
    ],
  },
  {
    name: "old 6: scanner isFile follows",
    file: "src/lib/public-ids.ts",
    test: "scans an ignored file",
    edits: [
      {
        from: 'import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";',
        to: 'import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";',
      },
      { from: "      info = lstatSync(full);", to: "      info = statSync(full);" },
    ],
  },
  {
    name: "backup: never stored",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [{ from: "      store.setItem(LEGACY_BACKUP_KEY, legacy);", to: "      void legacy;" }],
  },
  {
    name: "backup: stores the converted save",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [{ from: "      store.setItem(LEGACY_BACKUP_KEY, legacy);", to: "      store.setItem(LEGACY_BACKUP_KEY, JSON.stringify(decks));" }],
  },
  {
    name: "backup: second save overwrites it",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [
      {
        from: `  if (legacy && !store.getItem(LEGACY_BACKUP_KEY)) {
    try {
      store.setItem(LEGACY_BACKUP_KEY, legacy);`,
        to: `  if (legacy || true) {
    try {
      store.setItem(LEGACY_BACKUP_KEY, JSON.stringify(decks));`,
      },
    ],
  },
  {
    name: "backup: load does not remember the raw save",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [
      {
        from: "  if (isLegacySave(raw) && !store.getItem(LEGACY_BACKUP_KEY)) pendingLegacyBackup.set(store, raw);",
        to: "  if (false && isLegacySave(raw) && !store.getItem(LEGACY_BACKUP_KEY)) pendingLegacyBackup.set(store, raw);",
      },
    ],
  },
  {
    name: "back: parse drops :back",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [{ from: "      if (/:back$/i.test(faceId)) back = artId.trim();", to: "      if (/:back$/i.test(faceId)) continue;" }],
  },
  {
    name: "back: keeps another card's back",
    file: "src/lib/storage.ts",
    test: "does not keep another card's back",
    edits: [
      {
        from: "        const back = piece.back && owners.get(piece.back) === owner ? piece.back : undefined;",
        to: "        const back = piece.back || undefined;",
      },
    ],
  },
  {
    name: "back: match on art only",
    file: "src/lib/storage.ts",
    test: "does not keep another card's back",
    edits: [
      {
        from: '    const same = current.pairs.find((pair) => pair.art === art && (pair.back ?? "") === (back ?? ""));',
        to: "    const same = current.pairs.find((pair) => pair.art === art);",
      },
    ],
  },
  {
    name: "back: xml ignores the saved back",
    file: "src/lib/selection.ts",
    test: "does not keep another card's back",
    edits: [
      {
        from: "    const backArt = backFace ? chosenArt(backFace, pair.back) : null;",
        to: "    const backArt = backFace ? chosenArt(backFace, undefined) : null;",
      },
    ],
  },
  {
    name: "back: onePair omits the back",
    file: "src/lib/selection.ts",
    test: "stores the default back",
    edits: [{ from: "  return [{ art, qty, ...(back ? { back } : {}) }];", to: "  return [{ art, qty }];" }],
  },
  {
    name: "back: a later art overwrites the back",
    file: "src/lib/storage.ts",
    test: "reads both faces",
    edits: [{ from: "      else if (!back) back = artId.trim();", to: "      else back = artId.trim();" }],
  },
  {
    name: "f-face match fallback last",
    file: "src/lib/group.ts",
    test: "keeps a one-letter front typo",
    edits: [{ from: "          ) ?? belongs.faces[0]!;", to: "          ) ?? belongs.faces[belongs.faces.length - 1]!;" }],
  },
  {
    name: "x-forbidden ignored",
    file: "src/lib/storage.ts",
    test: "drops a partial-foil art",
    edits: [{ from: '      if (named && "forbidden" in named) continue;', to: '      if (false && named && "forbidden" in named) continue;' }],
  },
  {
    name: "x-forbidden paid off",
    file: "src/lib/storage.ts",
    test: "drops a partial-foil art",
    edits: [
      {
        from: "  if (found.some((item) => item.printType !== edition.printType || (item.paid && !isPaidEdition(edition)))) return { forbidden: true };",
        to: "  if (found.some((item) => item.printType !== edition.printType)) return { forbidden: true };",
      },
    ],
  },
  // v0.1.25: deck lists, print set, and the banner flight.
  {
    name: "d-list file in a subfolder",
    file: "src/lib/group.ts",
    test: "reads lists sitting directly in the edition folder",
    edits: [{ from: "  const files = (node.children ?? []).filter((child) => !child.folder && isDecklistFile(child.name));", to: "  const files: RawNode[] = [];\n  const walk = (n: RawNode) => { for (const c of n.children ?? []) { if (c.folder) walk(c); else if (isDecklistFile(c.name)) files.push(c); } };\n  walk(node);" }],
  },
  {
    name: "d-any txt is a list",
    file: "src/lib/decklist.ts",
    test: "accepts decklist.txt and decklist - <label>.txt",
    edits: [{ from: "export const DECKLIST_FILE = /^decklist(?:\\s*-\\s*(.+?))?\\s*\\.txt$/i;", to: "export const DECKLIST_FILE = /^(?:decklist)?(?:\\s*-\\s*(.+?))?.*\\.txt$/i;" }],
  },
  {
    name: "d-sideboard folded into main",
    file: "src/lib/decklist.ts",
    test: "keeps Vader's five sideboard cards apart",
    edits: [{ from: "    else if (section === \"sideboard\") pushMerged(sideboard, entry);", to: "    else if (section === \"sideboard\") { pushMerged(sideboard, entry); pushMerged(main, entry); }" }],
  },
  {
    name: "d-commander not counted",
    file: "src/lib/decklist.ts",
    test: "counts both SxF commanders",
    edits: [{ from: "  for (const entry of [...list.commander, ...list.main]) pushMerged(out, entry);", to: "  for (const entry of list.main) pushMerged(out, entry);" }],
  },
  {
    name: "d-duplicate lines not merged",
    file: "src/lib/decklist.ts",
    test: "merges repeated lines of the same card",
    edits: [{ from: "  if (existing) existing.qty = Math.min(99, existing.qty + entry.qty);", to: "  if (existing) existing.qty = Math.min(99, entry.qty);" }],
  },
  {
    name: "d-listed basic forced to 1",
    file: "src/lib/decklist.ts",
    test: "keeps only the basics a list asks for",
    edits: [{ from: "      quantities.set(card.id, share);", to: "      quantities.set(card.id, keys.some((key) => BASIC.test(key)) ? Math.max(1, share) : share);" }],
  },
  {
    name: "d-listed basic forced to 1 (61 arts)",
    file: "src/lib/decklist.ts",
    test: "keeps a listed basic's copy count",
    edits: [{ from: "      quantities.set(card.id, share);", to: "      quantities.set(card.id, keys.some((key) => BASIC.test(key)) ? Math.max(1, share) : share);" }],
  },
  {
    name: "d-unlisted basic kept at 1",
    file: "src/lib/decklist.ts",
    test: "keeps only the basics a list asks for",
    edits: [{ from: "    if (claimed.has(card.id) || isBasicCard(card)) continue;", to: "    if (claimed.has(card.id)) continue;\n    if (isBasicCard(card)) { quantities.set(card.id, Math.max(1, card.defaultQty)); continue; }" }],
  },
  {
    name: "d-shipped lists keep unlisted basics",
    file: "src/lib/decklist.ts",
    test: "open exactly the basic lands each list asks for",
    edits: [{ from: "    if (claimed.has(card.id) || isBasicCard(card)) continue;", to: "    if (claimed.has(card.id)) continue;\n    if (isBasicCard(card)) { quantities.set(card.id, Math.max(1, card.defaultQty)); continue; }" }],
  },
  {
    name: "d-basics zeroed with no list",
    file: "src/lib/decklist.ts",
    test: "still never opens a basic land at 0 when there is no list",
    edits: [{ from: "  if (!list) return edition;", to: "  if (!list) return { ...edition, cards: edition.cards.map((card) => (isBasicCard(card) ? { ...card, defaultQty: 0 } : card)) };" }],
  },
  {
    name: "d-main tokens zeroed",
    file: "src/lib/decklist.ts",
    test: "keeps a token that sits in the main deck folder in the main deck",
    edits: [{ from: "    if (isMainToken(card)) {\n      quantities.set(card.id, folderQty);", to: "    if (isMainToken(card)) {\n      quantities.set(card.id, 0);" }],
  },
  {
    name: "d-same-name arts share one count",
    file: "src/lib/decklist.ts",
    test: "spreads a quantity over cards with the same name",
    edits: [{ from: "      const share = Math.floor(entry.qty / n) + (position < entry.qty % n ? 1 : 0);", to: "      const share = position === 0 ? entry.qty : 0;" }],
  },
  {
    name: "d-near miss not one to one",
    file: "src/lib/decklist.ts",
    test: "does not pair a near miss when two leftover files",
    edits: [{ from: "      if (pair.cards.length !== 1) continue;", to: "      if (pair.cards.length < 1) continue;" }],
  },
  {
    name: "d-default ignores Complete Collection",
    file: "src/lib/decklist.ts",
    test: "opens Complete Collection when it is there",
    edits: [{ from: "  return lists.find((list) => /complete collection/i.test(list.label)) ?? lists[0]!;", to: "  return lists[0]!;" }],
  },
  {
    name: "d-empty id opens default",
    file: "src/lib/decklist.ts",
    test: "opens none for an empty id",
    edits: [{ from: "  if (id === \"\") return null;\n", to: "" }],
  },
  {
    name: "d-unreadable list skips shipped copy",
    file: "src/lib/group.ts",
    test: "uses the shipped copy with the same file name",
    edits: [{ from: "    const bundled = options.bundledDecklists?.find((list) => list.fileName.toLowerCase() === file.name.trim().toLowerCase());", to: "    const bundled = undefined as Decklist | undefined;" }],
  },
  {
    name: "d-unlock reads every txt",
    file: "src/lib/drive.ts",
    test: "downloads only deck list files",
    edits: [{ from: "      else if (isDecklistFile(child.name) && !files.some((file) => file.id === child.id)) files.push(child);", to: "      else if (/\\.txt$/i.test(child.name)) files.push(child);" }],
  },
  {
    name: "d-Random revives listed zeros",
    file: "src/lib/selection.ts",
    test: "Random keeps the list's zeros at zero",
    edits: [{ from: "    const qty = existing && copyCount(existing) > 0 ? copyCount(existing) : Math.max(0, card.defaultQty);", to: "    const qty = existing && copyCount(existing) > 0 ? copyCount(existing) : 1;" }],
  },
  {
    name: "d-list switch merges arts",
    file: "src/lib/selection.ts",
    test: "keeps two arts of one card as separate rows",
    edits: [{ from: "    if (target >= have) pairs[0]!.qty += target - have;", to: "    if (target >= have) { pairs.splice(1); pairs[0]!.qty = target; have = target; }" }],
  },
  {
    name: "d-list switch ignores lock",
    file: "src/lib/selection.ts",
    test: "leaves a locked card exactly as it was",
    edits: [{ from: "    if (existing?.locked) return existing;\n    const target", to: "    const target" }],
  },
  {
    name: "t-no tones tagged",
    file: "src/lib/group.ts",
    test: "groups one card per option with a Color and a Black and White file",
    edits: [{ from: "        if (art && which) art.tone = which;", to: "        void which;" }],
  },
  {
    name: "t-Deluxe ampersand folder missed",
    file: "src/lib/group.ts",
    test: "deluxe: groups one card per option",
    edits: [{ from: "  const mono = variants.filter((folder) => isBlackAndWhiteName(folder.name));", to: "  const mono = variants.filter((folder) => /black and white/i.test(folder.name));" }],
  },
  {
    name: "t-tone switch on partial foil",
    file: "src/lib/selection.ts",
    test: "never offers the switch on a partial foil edition",
    edits: [{ from: "  if (edition.printType !== \"standard\") return false;\n  let color", to: "  let color" }],
  },
  {
    name: "t-Random ignores print set",
    file: "src/lib/selection.ts",
    test: "All cards and Random stay in the chosen print set",
    edits: [{ from: "  if (!tone) return options;\n  const kept", to: "  if (tone || !tone) return options;\n  const kept" }],
  },
  {
    name: "t-All cards ignores print set",
    file: "src/lib/selection.ts",
    test: "All cards and Random stay in the chosen print set",
    edits: [{ from: "onePair(card, card.bwOnly ? 0 : 1, toneArtId(card.faces[0], tone) ?? defaultArtId(card), toneBackId(card, tone))", to: "onePair(card, card.bwOnly ? 0 : 1, defaultArtId(card), toneBackId(card, tone))" }],
  },
  {
    name: "t-tone switch moves always-color cards",
    file: "src/lib/selection.ts",
    test: "always-color card",
    edits: [{ from: "        const nextFront = frontArt && frontArt.tone && frontArt.tone !== tone ? toneArtId(front, tone) : null;", to: "        const nextFront = frontArt && frontArt.tone !== tone ? (toneArtId(front, tone) ?? artsOf(front!).at(-1)?.id ?? null) : null;" }],
  },
  {
    name: "s-saved list id unchecked",
    file: "src/lib/storage.ts",
    test: "drops a bad list id or print set",
    edits: [{ from: "typeof deck.decklistId === \"string\" && /^[a-z0-9-]{1,80}$/.test(deck.decklistId)", to: "typeof deck.decklistId === \"string\"" }],
  },
  {
    name: "h-home counts unique main cards",
    file: "src/components/HomeView.tsx",
    test: "show the copies the default list opens with",
    edits: [{ from: "            const mains = openingCopies({ ...choice.edition, cards });", to: "            const mains = cards.filter((card) => card.role === \"main\").length + 0 * openingCopies(choice.edition);" }],
  },
  {
    name: "h-home ignores the default list",
    file: "src/lib/draft.ts",
    test: "show the default list's opening total on the homepage",
    edits: [{ from: "  return countCopies(designedSelection(withDecklist(edition, defaultDecklist(edition))));", to: "  return countCopies(designedSelection(withDecklist(edition, edition.decklists?.[0] ?? null)));" }],
  },
  {
    name: "n-space after face number not read",
    file: "src/lib/names.ts",
    test: "accepts an underscore or a space after the face number",
    edits: [{ from: "const FACE_PREFIX = /^(\\d+)_([12])[_ ]\\s*(\\S.*)$/;", to: "const FACE_PREFIX = /^(\\d+)_([12])_(.+)$/;" }],
  },
  {
    name: "n-TMNT Lost Vale not paired",
    file: "src/lib/names.ts",
    test: "pairs Dowsing Dagger with Lost Vale",
    edits: [{ from: "const FACE_PREFIX = /^(\\d+)_([12])[_ ]\\s*(\\S.*)$/;", to: "const FACE_PREFIX = /^(\\d+)_([12])_(.+)$/;" }],
  },
  {
    name: "n-any face number",
    file: "src/lib/names.ts",
    test: "does not read a numbered basic or a folder number as a face",
    edits: [{ from: "const FACE_PREFIX = /^(\\d+)_([12])[_ ]\\s*(\\S.*)$/;", to: "const FACE_PREFIX = /^(\\d+)_?(\\d?)[_ ]\\s*(\\S.*)$/;" }],
  },
  {
    name: "g-orphan back stays a main card",
    file: "src/lib/faces.ts",
    test: "never counts a 1_2 back with no 1_1 front",
    edits: [{ from: "    if (role !== \"main\") continue;\n", to: "    continue;\n" }],
  },
  {
    name: "g-loose faces not paired after grouping",
    file: "src/lib/group.ts",
    test: "pairing double-faced files while grouping",
    edits: [{ from: "  const paired = pairLooseFaces(sorted.map(toDeckCard));", to: "  const paired = { cards: sorted.map(toDeckCard), notes: [] as CatalogueNote[] };" }],
  },
  {
    name: "g-pairing crosses roles",
    file: "src/lib/faces.ts",
    test: "pairs within a role only",
    edits: [{ from: "    const key = `${card.role}\\u0000${lone.pair}`;", to: "    const key = `main\\u0000${lone.pair}`;" }],
  },
  {
    name: "g-paired card gets a new id",
    file: "src/lib/faces.ts",
    test: "keeps the front's id",
    edits: [{ from: "      const merged: DeckCard = {\n        ...front.card,\n", to: "      const merged: DeckCard = {\n        ...front.card,\n        id: `${role}-${pair}-${slug(front.base)}`,\n" }],
  },
  {
    name: "a-shipped script does not pair",
    file: "scripts/attach-decklists.ts",
    test: "pairs the faces an older TMNT catalogue left apart",
    edits: [{ from: "      const paired = pairLooseFaces(rest.cards);", to: "      const paired = { cards: rest.cards, notes: [] as typeof rest.notes };" }],
  },
  {
    name: "s-old Lost Vale counted twice",
    file: "src/lib/storage.ts",
    test: "loads a deck saved with the old Lost Vale card",
    edits: [{ from: "    if (frontCounted.has(card.id)) {", to: "    if (frontCounted.has(card.id) && false) {" }],
  },
  {
    name: "s-old Lost Vale row kept as a front",
    file: "src/lib/storage.ts",
    test: "loads a deck saved with the old Lost Vale card",
    edits: [{ from: "      if (piece.art && backs.has(piece.art)) {", to: "      if (piece.art && backs.has(piece.art) && false) {" }],
  },
  {
    name: "s-file name ignores face names",
    file: "src/lib/storage.ts",
    test: "opens at 305 with built-ins loaded and no drop note",
    edits: [{ from: "  return cardByFaceName(fileBase(found[0]!.name), edition);", to: "  return null;" }],
  },
  {
    name: "s-Tempts You only dropped",
    file: "src/lib/storage.ts",
    test: "moves the copies of a save holding only The Ring Tempts You onto The Ring",
    edits: [{ from: "  return cardByFaceName(fileBase(found[0]!.name), edition);", to: "  return null;" }],
  },
  {
    name: "s-back face by file name counted twice",
    file: "src/lib/storage.ts",
    test: "opens at 305 with built-ins loaded and no drop note",
    edits: [{ from: "        if (card && named.backArt) {", to: "        if (card && named.backArt && false) {" }],
  },
  {
    name: "s-back face by file name read as a front",
    file: "src/lib/storage.ts",
    test: "opens at 305 with built-ins loaded and no drop note",
    edits: [{ from: "  return backArt ? { cardId: card.id, backArt } : null;", to: "  return { cardId: card.id };" }],
  },
  {
    name: "s-1_2 file taken as a front",
    file: "src/lib/storage.ts",
    test: "does not take a 1_2 file as the front of a card, or a 1_1 file as a back",
    edits: [{ from: "  if (parsed.face === 2 && index === 0) return null;\n", to: "" }],
  },
  {
    name: "s-1_1 file taken as a back",
    file: "src/lib/storage.ts",
    test: "does not take a 1_2 file as the front of a card, or a 1_1 file as a back",
    edits: [{ from: "  if (parsed.face === 1 && index !== 0) return null;\n", to: "" }],
  },
  {
    name: "f-two loops",
    file: "src/lib/flight.ts",
    test: "makes exactly one loop around the card window",
    edits: [{ from: "export const LOOPS = 1;", to: "export const LOOPS = 2;" }],
  },
  {
    name: "f-bee behind on the way home",
    file: "src/lib/flight.ts",
    test: "only goes behind the card on the far half",
    edits: [{ from: "  if (pt.kind === \"home\" || pt.kind === \"spiral\") return false;\n", to: "" }],
  },
  {
    name: "f-spiral misses the slot",
    file: "src/lib/flight.ts",
    test: "lands centred on the slot",
    edits: [{ from: "    const r = r0 * (1 - s);", to: "    const r = r0 * (1 - s * 0.8);" }],
  },
  {
    name: "f-exits up and right",
    file: "src/lib/flight.ts",
    test: "leaves the loop heading down and to the left",
    edits: [{ from: "  const exit = (7 * Math.PI) / 6;", to: "  const exit = Math.PI / 6;" }],
  },
  // v0.1.26: desktop card flyout, Back to top, and the Extras / Tokens side tiles.
  { name: "v26-dfc back ignored (tile)", file: "src/components/BuilderView.tsx", test: "shows a double-faced card's own back face beside the front", edits: [{ from: "dfcBack: backArt?.thumbId, customBack: customBack?.thumbId, alt: card.name };", to: "dfcBack: null, customBack: customBack?.thumbId, alt: card.name };" }] },
  { name: "v26-flyout over its own row", file: "src/lib/desktop.ts", test: "goes right of the card row", edits: [{ from: "    left = anchor.right + gap;\n    side = \"right\";", to: "    left = anchor.left + gap;\n    side = \"right\";" }] },
  { name: "v26-no left flip", file: "src/lib/desktop.ts", test: "flips to the left near the right edge", edits: [{ from: "} else if (anchor.left - gap - width >= margin) {", to: "} else if (false) {" }] },
  { name: "v26-no horizontal clamp", file: "src/lib/desktop.ts", test: "clamps inside the viewport when neither side fits", edits: [{ from: "    left = clamp(left, margin, viewport.width - margin - width);\n", to: "" }] },
  { name: "v26-no vertical clamp", file: "src/lib/desktop.ts", test: "centres on the row and clamps", edits: [{ from: "const top = clamp(middle - height / 2, margin, viewport.height - margin - height);", to: "const top = middle - height / 2;" }] },
  { name: "v26-size ignores window height", file: "src/lib/desktop.ts", test: "shrinks the card to fit a short window", edits: [{ from: "Math.min(maxWidth, byHeight, byWidth)", to: "Math.min(maxWidth, byWidth)" }] },
  { name: "v26-flyout takes the pointer", file: "src/components/CardFlyout.tsx", test: "never takes the pointer", edits: [{ from: 'className="beeline-flyout pointer-events-none fixed z-[70] flex items-start"', to: 'className="beeline-flyout fixed z-[70] flex items-start"' }] },
  { name: "v26-touch opens the flyout", file: "src/components/use-card-flyout.tsx", test: "does not open for touch", edits: [{ from: 'if (event.pointerType === "mouse") show(card, event.currentTarget);', to: "show(card, event.currentTarget);" }] },
  { name: "v26-flyout at phone width", file: "src/components/use-card-flyout.tsx", test: "does not open for touch", edits: [{ from: "if (!card.front || !matches(FLYOUT_MEDIA)) return;", to: "if (!card.front) return;" }] },
  { name: "v26-Escape ignored", file: "src/components/use-card-flyout.tsx", test: "closes on Escape and on blur", edits: [{ from: 'if (event.key === "Escape") setShown(null);', to: 'if (event.key === "Esc") setShown(null);' }] },
  { name: "v26-blur keeps the flyout", file: "src/components/use-card-flyout.tsx", test: "closes on Escape and on blur", edits: [{ from: "    onBlur: close,", to: "    onBlur: () => undefined," }] },
  { name: "v26-focus ignored", file: "src/components/use-card-flyout.tsx", test: "closes on Escape and on blur", edits: [{ from: "if (keyboardFocus(event.currentTarget)) show(card, event.currentTarget);", to: "void event;" }] },
  { name: "v26-leave keeps the flyout", file: "src/components/use-card-flyout.tsx", test: "closes when the pointer leaves", edits: [{ from: "    onPointerLeave: close,", to: "    onPointerLeave: () => undefined," }] },
  { name: "v26-flyout outlives its card", file: "src/components/use-card-flyout.tsx", test: "leaves the list while hovered", edits: [{ from: "    gone.observe(document.body, { childList: true, subtree: true });\n", to: "" }] },
  { name: "v26-scroll keeps the flyout", file: "src/components/use-card-flyout.tsx", test: "closes the flyout when the page scrolls", edits: [{ from: 'window.addEventListener("scroll", onMove, true);', to: "" }] },
  { name: "v26-small desktop art", file: "src/components/BuilderView.tsx", test: "makes main-deck art bigger at desktop width", edits: [{ from: 'className="w-12 shrink-0 text-left lg:w-40" aria-label={`Choose front art', to: 'className="w-12 shrink-0 text-left" aria-label={`Choose front art' }] },
  { name: "v26-back to top at the top", file: "src/lib/desktop.ts", test: "is hidden only at the very top", edits: [{ from: "return scrollY > 0;", to: "return scrollY >= 0;" }] },
  { name: "v26-back to top on phones", file: "src/components/BackToTop.tsx", test: "is hidden at the very top and shows after scrolling", edits: [{ from: "z-40 hidden h-11", to: "z-40 h-11" }] },
  { name: "v26-back to top ignores reduced motion", file: "src/components/BackToTop.tsx", test: "scrolls smoothly to the top", edits: [{ from: 'behavior: reduced ? "auto" : "smooth"', to: 'behavior: "smooth"' }] },
  { name: "v26-token tile threshold", file: "src/lib/desktop.ts", test: "always gives extras the tile", edits: [{ from: "count > TOKEN_TILE_THRESHOLD", to: "count >= TOKEN_TILE_THRESHOLD" }] },
  { name: "v26-extras keep the long column", file: "src/lib/desktop.ts", test: "always gives extras the tile", edits: [{ from: 'kind === "extras" ? true :', to: 'kind === "extras" ? count > TOKEN_TILE_THRESHOLD :' }] },
  { name: "v26-tile counts every card as added", file: "src/components/SideTile.tsx", test: "keeps counts edited in the overlay", edits: [{ from: "cards.filter((card) => copyCount(byId.get(card.id)) > 0)", to: "cards.filter(() => true)" }] },
  { name: "v26-overlay not modal", file: "src/components/SideTile.tsx", test: "opens an accessible overlay", edits: [{ from: '          aria-modal="true"\n', to: "" }] },
  { name: "v26-overlay focuses the first card", file: "src/components/SideTile.tsx", test: "opens an accessible overlay", edits: [{ from: "            event.preventDefault();\n            contentRef.current?.focus();", to: "" }] },
  { name: "v26-Escape closes overlay and flyout together", file: "src/components/SideTile.tsx", test: "the first Escape closes only the flyout", edits: [{ from: "if (flyoutOpen?.current) {", to: "if (false) {" }] },
  { name: "v26-overlay edits dropped", file: "src/components/BuilderView.tsx", test: "keeps counts edited in the overlay", edits: [{ from: "            flyout={flyout.bind}\n            onQty={(index, qty) => changePair(card, index, qty)}", to: "            flyout={flyout.bind}\n            onQty={() => undefined}" }] },
  { name: "v26-phone tab gets the tile", file: "src/components/BuilderView.tsx", test: "leaves the phone and tablet Add cards tab", edits: [{ from: "          {addPane}\n        </TabsContent>", to: "          {desktopAddPane}\n        </TabsContent>" }] },
  { name: "v27-flyout not keyed per card", file: "src/components/use-card-flyout.tsx", test: "the next card gets its own pop-up", edits: [{ from: "<FlyoutLayer key={shown.card.key} shown={shown} />", to: "<FlyoutLayer shown={shown} />" }] },
  { name: "v27-flyout back to 320px", file: "src/lib/desktop.ts", test: "stays clearly larger than the 160px desktop thumbnail", edits: [{ from: "export const FLYOUT_MAX_WIDTH = 400;", to: "export const FLYOUT_MAX_WIDTH = 320;" }] },
  { name: "v27-thumb back to 80px", file: "src/components/BuilderView.tsx", test: "makes main-deck art bigger at desktop width", edits: [{ from: 'className="w-12 shrink-0 text-left lg:w-40" aria-label={`Choose front art', to: 'className="w-12 shrink-0 text-left lg:w-20" aria-label={`Choose front art' }] },
  { name: "v27-dfc back fixed at 160px", file: "src/components/BuilderView.tsx", test: "makes main-deck art bigger at desktop width", edits: [{ from: 'lg:w-[clamp(4rem,calc(100%_-_10.5rem),10rem)]" aria-label={`Choose back art', to: 'lg:w-40" aria-label={`Choose back art' }] },
  { name: "v27-count beside the art", file: "src/components/BuilderView.tsx", test: "makes main-deck art bigger at desktop width", edits: [{ from: '              <span aria-hidden="true" className="hidden lg:block lg:basis-full" />\n', to: "" }] },
  { name: "v27-line break shows on phones", file: "src/components/BuilderView.tsx", test: "makes main-deck art bigger at desktop width", edits: [{ from: 'className="hidden lg:block lg:basis-full"', to: 'className="block lg:basis-full"' }] },
  { name: "v27-fixed four columns", file: "src/components/BuilderView.tsx", test: "wraps the main grid into as many 17rem columns", edits: [{ from: "sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]", to: "sm:grid-cols-3 xl:grid-cols-4" }] },
  { name: "v27-page stays 80rem", file: "src/components/BuilderView.tsx", test: "wraps the main grid into as many 17rem columns", edits: [{ from: "lg:max-w-[96rem]", to: "lg:max-w-7xl" }] },
  {
    name: "v0.1.28 hydro: no known unprefixed pair",
    file: "src/lib/faces.ts",
    test: "Hydroelectric files without the 1_1_/1_2_ prefix",
    edits: [
      { from: "= [[\"hydroelectric specimen\", \"hydroelectric laboratory\"]];", to: "= [];" },
    ],
  },
  {
    name: "v0.1.28 hydro: known back alone demoted",
    file: "src/lib/faces.ts",
    test: "leaves a Laboratory with no Specimen",
    edits: [
      { from: "    if (known && (fronts.length !== 1 || backs.length !== 1)) continue;\n", to: "" },
    ],
  },
  {
    name: "v0.1.28 hydro: stored packs not re-paired",
    file: "src/lib/storage.ts",
    test: "re-pairs a pack that was unlocked and stored",
    edits: [
      { from: "  const paired = pairLooseFaces(edition.cards).cards;", to: "  const paired = edition.cards;" },
    ],
  },
  {
    name: "v0.1.28 backs: override ignored in export",
    file: "src/lib/selection.ts",
    test: "per-card back in the export",
    edits: [
      { from: "    const override = overrides.get(card.id);", to: "    const override = undefined as BackOption | undefined;" },
    ],
  },
  {
    name: "v0.1.28 backs: deck-back shortcut on a DFC",
    file: "src/lib/selection.ts",
    test: "keeps a double-faced card's own back unless it has a pick",
    edits: [
      { from: "const same = !backFace && override.kind === \"cardback\"", to: "const same = override.kind === \"cardback\"" },
    ],
  },
  {
    name: "v0.1.28 backs: picked back promoted in partial foil",
    file: "src/lib/selection.ts",
    test: "never prints a picked back as an extra front",
    edits: [
      { from: "    if (override) {", to: "    if (override && !promoteBacks) {" },
    ],
  },
  {
    name: "v0.1.28 backs: tokens by folder only",
    file: "src/lib/selection.ts",
    test: "back options in the card editor",
    edits: [
      { from: "const kind: BackKind = tokenTest(card) ? \"token\" : \"alt\";", to: "const kind: BackKind = card.role === \"token\" ? \"token\" : \"alt\";" },
    ],
  },
  {
    name: "v0.1.28 backs: card offered as its own back",
    file: "src/lib/selection.ts",
    test: "does not offer a token as its own back",
    edits: [
      { from: "if (card.role === \"main\" || card.id === cardId) continue;", to: "if (card.role === \"main\") continue;" },
    ],
  },
  {
    name: "v0.1.28 backs: empty map saved",
    file: "src/lib/storage.ts",
    test: "loads and saves a deck from before v0.1.28 unchanged",
    edits: [
      { from: "return Object.keys(out).length ? { cardBacks: out } : {};", to: "return { cardBacks: out };" },
    ],
  },

  {
    name: "v0.1.28 backs: editor keeps an empty map",
    file: "src/components/BuilderView.tsx",
    test: "saves a pick, shows it on the tile",
    edits: [
      { from: "return Object.keys(next).length ? { ...rest, cardBacks: next } : rest;", to: "return { ...rest, cardBacks: next };" },
    ],
  },
  {
    name: "v0.1.28 backs: tile ignores the pick",
    file: "src/components/BuilderView.tsx",
    test: "saves a pick, shows it on the tile",
    edits: [
      { from: "      <CustomBackBadge option={customBack} />\n      <FactsMark mark={mark} />\n      <ul className=\"mt-2 grid gap-2\">", to: "      <FactsMark mark={mark} />\n      <ul className=\"mt-2 grid gap-2\">" },
    ],
  },
  {
    name: "v0.1.28 backs: DFC tile thumb ignores the pick",
    file: "src/components/BuilderView.tsx",
    test: "a pick replaces that face",
    edits: [
      { from: "<CardThumb id={customBack?.thumbId ?? backArt?.thumbId} alt={customBack?.label ?? back.name} tag=", to: "<CardThumb id={backArt?.thumbId} alt={back.name} tag=" },
    ],
  },
  {
    name: "v0.1.28 backs: no DFC warning",
    file: "src/components/BuilderView.tsx",
    test: "a pick replaces that face",
    edits: [
      { from: "      {ownBack ? (\n        <p role=\"note\"", to: "      {false ? (\n        <p role=\"note\"" },
    ],
  },
  {
    name: "v0.1.28 tokens: ambiguous trusted",
    file: "src/lib/tokens.ts",
    test: "token lookup",
    edits: [
      { from: "if (entry && !entry.ambiguous) return", to: "if (entry) return" },
    ],
  },
  {
    name: "v0.1.28 tokens: lookup ignored",
    file: "src/lib/tokens.ts",
    test: "token lookup",
    edits: [
      { from: "    const entry = own(lookup, normalizeKey(query));", to: "    const entry = undefined as TokenLookupEntry | undefined;" },
    ],
  },
  {
    name: "v0.1.28 tokens: face prefix kept",
    file: "src/lib/tokens.ts",
    test: "looks names up without labels",
    edits: [
      { from: "  s = s.replace(/^\\d+_/, \"\");\n", to: "" },
    ],
  },  {
    name: "v0.1.28 tone: saved Laboratory back dropped when Specimen has copies",
    file: "src/lib/storage.ts",
    test: "swaps a back of the other tone",
    edits: [{ from: "      current.pairs = current.pairs.map((pair) => (!pair.back || wrongTone(card, pair.back, deck.tone) ? { ...pair, ...(back ? { back } : {}) } : pair));\n", to: "" }],
  },
  {
    name: "v0.1.28 tone: other-tone back on Specimen kept",
    file: "src/lib/storage.ts",
    test: "swaps a back of the other tone",
    edits: [{ from: "(!pair.back || wrongTone(card, pair.back, deck.tone) ?", to: "(!pair.back ?" }],
  },
  {
    name: "v0.1.28 tone: saved back of the other tone kept",
    file: "src/lib/storage.ts",
    test: "moves a Laboratory row saved on the Color file",
    edits: [{ from: "  if (saved && !wrongTone(card, saved, tone)) return saved;", to: "  if (saved) return saved;" }],
  },
  {
    name: "v0.1.28 tone: pairs without a back left on the Color file",
    file: "src/lib/storage.ts",
    test: "saved without a Laboratory row",
    edits: [{ from: "  if (deck.tone) {\n    // The renamed pair saved", to: "  if (false) {\n    // The renamed pair saved" }],
  },
  {
    name: "v0.1.28 tone: Color deck gets a back written",
    file: "src/lib/storage.ts",
    test: "leaves a Color deck's Specimen as it was saved",
    edits: [{ from: "if (!card || !toned || toned === defaultBackId(card)) continue;", to: "if (!card || !toned) continue;" }],
  },
  {
    name: "v0.1.28 tone: new rows ignore the tone",
    file: "src/lib/selection.ts",
    test: "picks the back face file in the tone",
    edits: [{ from: "  return toneArtId(card.faces[1], tone) ?? defaultBackId(card);", to: "  return defaultBackId(card);" }],
  },
  {
    name: "v0.1.28 tone: All cards on the default back",
    file: "src/lib/selection.ts",
    test: "uses it in All cards",
    edits: [{ from: "toneArtId(card.faces[0], tone) ?? defaultArtId(card), toneBackId(card, tone)),", to: "toneArtId(card.faces[0], tone) ?? defaultArtId(card))," }],
  },
  {
    name: "v0.1.28 tone: new list rows on the default back",
    file: "src/lib/selection.ts",
    test: "uses it in All cards",
    edits: [{ from: "onePair(card, target, defaultArtId(card), toneBackId(card, tone))", to: "onePair(card, target)" }],
  },
  {
    name: "v0.1.28 tone: Add another art on the default back",
    file: "src/components/BuilderView.tsx",
    test: "starts a new art row",
    edits: [{ from: "[...(saved?.pairs ?? []), newPair(card, 1, tone)]", to: "[...(saved?.pairs ?? []), newPair(card, 1, null)]" }],
  },
  {
    name: "v0.1.28 tone: added card on the default back",
    file: "src/components/BuilderView.tsx",
    test: "starts a new art row",
    edits: [{ from: "writeCard(card, [newPair(card, qty, tone)])", to: "writeCard(card, [newPair(card, qty, null)])" }],
  },
  {
    name: "v0.1.28 known pair made beside the renamed files",
    file: "src/lib/faces.ts",
    test: "fold in too when the renamed faces were still two loose",
    edits: [{ from: "if (known && prefixedFronts.has(", to: "if (false && prefixedFronts.has(" }],
  },
  {
    name: "v0.1.28 tone: back pick stays in the old tone",
    file: "src/lib/selection.ts",
    test: "moves a Color token pick",
    edits: [{ from: "    next[cardId] = other ?? fileId;", to: "    next[cardId] = fileId;" }],
  },
  {
    name: "v0.1.28 tone: back picks not moved on a switch",
    file: "src/components/BuilderView.tsx",
    test: "moves a picked back to the same card's file",
    edits: [{ from: "    const cardBacks = toneCardBacks(edition, draft.cardBacks, next);", to: "    const cardBacks = draft.cardBacks;" }],
  },
  {
    name: "v0.1.28 tone: switch adds a cardBacks key",
    file: "src/components/BuilderView.tsx",
    test: "switches tone without adding a cardBacks key",
    edits: [{ from: "...(cardBacks ? { cardBacks: { ...cardBacks } } : {})", to: "cardBacks: { ...cardBacks }" }],
  },
  {
    name: "v0.1.28 tone: unchanged picks copied",
    file: "src/lib/selection.ts",
    test: "keeps card backs, files with no version",
    edits: [{ from: "  return moved ? next : cardBacks;", to: "  return next;" }],
  },
  {
    name: "v0.1.28 token overrides ignored",
    file: "src/lib/tokens.ts",
    test: "wins over Scryfall and the heuristic",
    edits: [{ from: "  const override = tokenOverride(card, deckId, overrides);", to: "  const override = undefined as TokenOverride | undefined;" }],
  },
  {
    name: "v0.1.28 token override in any deck",
    file: "src/lib/tokens.ts",
    test: "wins over Scryfall and the heuristic",
    edits: [{ from: "overrides.find((item) => item.deck === deckId && item.card === card.name)", to: "overrides.find((item) => item.card === card.name)" }],
  },
  {
    name: "v0.1.28 editor ignores the deck's overrides",
    file: "src/components/BuilderView.tsx",
    test: "uses the deck's hand decisions",
    edits: [{ from: "isTokenCard(card, deckId), [deckId]", to: "isTokenCard(card), [deckId]" }],
  },
  {
    name: "v0.1.28 picked back resolved without the deck's overrides",
    file: "src/lib/selection.ts",
    test: "uses the deck's hand decisions",
    edits: [{ from: "resolveBackOverride(edition, card.id, own(cardBacks, card.id), tokenTest)", to: "resolveBackOverride(edition, card.id, own(cardBacks, card.id))" }],
  },
  {
    name: "v0.1.28 Lands override flipped",
    file: "src/data/token-overrides.ts",
    test: "puts Raphael, Thor, Titania",
    edits: [{ from: "{ deck: \"persona-5\", card: \"Lands\", token: false }", to: "{ deck: \"persona-5\", card: \"Lands\", token: true }" }],
  },
  {
    name: "v0.1.28 override matches no card",
    file: "src/data/token-overrides.ts",
    test: "matches exactly one token or extra",
    edits: [{ from: "{ deck: \"persona-5\", card: \"Thor\", token: true }", to: "{ deck: \"persona-5\", card: \"Thor 1\", token: true }" }],
  },
  {
    name: "v0.1.28 rename fold widened to every back row",
    file: "src/lib/storage.ts",
    test: "matches v0.1.27",
    edits: [{ from: "    const renamed = isKnownUnprefixedPair(card);", to: "    const renamed = true;" }],
  },
  {
    name: "v0.1.28 known pair test true for every card",
    file: "src/lib/faces.ts",
    test: "matches v0.1.27",
    edits: [{ from: "  return KNOWN_UNPREFIXED_PAIRS.some(([knownFront, knownBack]) => knownFront === front && knownBack === back);", to: "  return front !== \"\" || back !== \"\";" }],
  },
  {
    name: "v0.1.28 known pair test false for Hydroelectric",
    file: "src/lib/faces.ts",
    test: "puts the saved Black and White Laboratory",
    edits: [{ from: "  return KNOWN_UNPREFIXED_PAIRS.some(([knownFront, knownBack]) => knownFront === front && knownBack === back);", to: "  return false;" }],
  },
  {
    name: "v0.1.28 old Hydroelectric files not folded",
    file: "src/lib/faces.ts",
    test: "fold into the renamed card as more arts",
    edits: [{ from: "      ? input.filter((card) => card.role === role && card.faces.length >= 2 && faceKey(card, 0) === knownFront && !list.some((item) => item.card.id === card.id))", to: "      ? []" }],
  },
  {
    name: "v0.1.28 old Hydroelectric files not folded after loose pairing",
    file: "src/lib/faces.ts",
    test: "fold in too when the renamed faces were still two loose",
    edits: [{ from: "  if (deferKnown && depth === 0) {", to: "  if (false) {" }],
  },
  // ---- v0.1.29: Clear all / Clear shown, the card filter, the query box, the card lookup ----
  {
    name: "q-clearCounts all keeps locked rows",
    file: "src/lib/clear.ts",
    test: "Clear all leaves no row at all",
    edits: [{ from: "if (!cardIds) return [];", to: "if (!cardIds) return selected.filter((card) => card.locked);" }],
  },
  {
    name: "q-clearCounts shown keeps the shown rows",
    file: "src/lib/clear.ts",
    test: "Clear all leaves no row at all",
    edits: [{ from: "return selected.filter((card) => !cardIds.has(card.cardId));", to: "return selected.filter((card) => !cardIds.has(card.cardId) || card.locked || copyCount(card) === 0);" }],
  },
  {
    name: "q-clearSummary counts cards at 0",
    file: "src/lib/clear.ts",
    test: "counts the cards and copies a clear would set to 0",
    edits: [{ from: "(!cardIds || cardIds.has(card.cardId)) && copyCount(card) > 0", to: "(!cardIds || cardIds.has(card.cardId))" }],
  },
  {
    name: "q-clearMessage shown reads like all",
    file: "src/lib/clear.ts",
    test: "says which clear it was",
    edits: [{ from: "status: `Cleared shown: ${plural(done.copies, \"copy\", \"copies\")} of the ${plural(done.cards, \"card\")} the filter shows set to 0. Cards the filter hides kept their counts.`", to: "status: `Cleared all: ${plural(done.copies, \"copy\", \"copies\")} of ${plural(done.cards, \"card\")} set to 0.`" }],
  },
  {
    name: "q-Clear all while filtering clears only the shown cards",
    file: "src/components/BuilderView.tsx",
    test: "only appears while filtering, zeroes only the shown cards",
    edits: [{ from: "const ids = scope === \"shown\" ? shownIds : undefined;", to: "const ids = filtering ? shownIds : undefined;" }],
  },
  {
    name: "q-Clear shown clears everything",
    file: "src/components/BuilderView.tsx",
    test: "only appears while filtering, zeroes only the shown cards",
    edits: [{ from: "const ids = scope === \"shown\" ? shownIds : undefined;", to: "const ids = undefined;" }],
  },
  {
    name: "q-Clear shown always offered",
    file: "src/components/BuilderView.tsx",
    test: "only appears while filtering, zeroes only the shown cards",
    edits: [{ from: "        {filtering ? (\n          <Button type=\"button\" variant=\"outline\" disabled={shownSummary.copies === 0}", to: "        {true ? (\n          <Button type=\"button\" variant=\"outline\" disabled={shownSummary.copies === 0}" }],
  },
  {
    name: "q-Clear all skips tokens and extras",
    file: "src/components/BuilderView.tsx",
    test: "sits with the count controls, sets every count to 0 at once",
    edits: [{ from: "const ids = scope === \"shown\" ? shownIds : undefined;", to: "const ids = scope === \"shown\" ? shownIds : new Set(mains.map((card) => card.id));" }],
  },
  {
    name: "q-Undo outlives a later edit",
    file: "src/components/BuilderView.tsx",
    test: "drops the Undo once anything else changes",
    edits: [
      { from: "cleared.deckId === draft.id && cleared.after === JSON.stringify(draft.cards) ? cleared : null", to: "cleared.deckId === draft.id ? cleared : null" },
      { from: "  function commit(next: SavedDeck) {\n    setCleared(null);", to: "  function commit(next: SavedDeck) {" },
    ],
  },
  {
    name: "q-Undo restores the wrong counts",
    file: "src/components/BuilderView.tsx",
    test: "sits with the count controls, sets every count to 0 at once",
    edits: [{ from: "commit({ ...draft, cards: undoable.before });", to: "commit({ ...draft, cards: undoable.before.slice(1) });" }],
  },
  {
    name: "q-Undo bar stays after Undo",
    file: "src/components/BuilderView.tsx",
    test: "sits with the count controls, sets every count to 0 at once",
    edits: [
      { from: "    commit({ ...draft, cards: undoable.before });\n    setCleared(null);", to: "    commit({ ...draft, cards: undoable.before });\n    setCleared({ ...undoable, after: JSON.stringify(undoable.before) });" },
    ],
  },
  {
    name: "q-filter shows unknown cards",
    file: "src/components/BuilderView.tsx",
    test: "still finds an unmatched card by name and marks it",
    edits: [{ from: "const shown = (card: DeckCard) => results.get(card.id)?.result === \"shown\";", to: "const shown = (card: DeckCard) => results.get(card.id)?.result !== \"hidden\";" }],
  },
  {
    name: "q-facts mark without a filter",
    file: "src/components/BuilderView.tsx",
    test: "still finds an unmatched card by name and marks it",
    edits: [{ from: "return filtering && lookup && status !== \"matched\" ? status : undefined;", to: "return lookup && status !== \"matched\" ? status : undefined;" }],
  },
  {
    name: "q-left-out count counts hidden cards",
    file: "src/components/BuilderView.tsx",
    test: "reads a Scryfall-style query, shows only the matching cards",
    edits: [{ from: "edition.cards.filter((card) => results.get(card.id)?.result === \"unknown\").length", to: "edition.cards.filter((card) => results.get(card.id)?.result !== \"shown\").length" }],
  },
  {
    name: "q-filter changes counts",
    file: "src/components/BuilderView.tsx",
    test: "reads a Scryfall-style query, shows only the matching cards",
    edits: [{ from: "onChange={(event) => setQuery(event.target.value)}", to: "onChange={(event) => { setQuery(event.target.value); commit({ ...draft, cards: draft.cards.slice(1) }); }}" }],
  },
  {
    name: "q-color any reads as all",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: "? picked.some((color) => colors.includes(color))", to: "? picked.every((color) => colors.includes(color))" }],
  },
  {
    name: "q-color all reads as any",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: "? picked.every((color) => colors.includes(color))\n          :", to: "? picked.some((color) => colors.includes(color))\n          :" }],
  },
  {
    name: "q-color exact allows more colors",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: ": picked.length === colors.length && picked.every((color) => colors.includes(color));", to: ": picked.every((color) => colors.includes(color));" }],
  },
  {
    name: "q-colorless beside colors ignored",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: "ok = byMode || (filter.colorless && colors.length === 0);", to: "ok = byMode;" }],
  },
  {
    name: "q-colorless alone matches all",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: "if (!picked.length) ok = filter.colorless ? colors.length === 0 : true;", to: "if (!picked.length) ok = true;" }],
  },
  {
    name: "q-multicolor counts one color",
    file: "src/lib/card-filter.ts",
    test: "matches colors by any, all and exact",
    edits: [{ from: "(!filter.multicolor || colors.length >= 2)", to: "(!filter.multicolor || colors.length >= 1)" }],
  },
  {
    name: "q-type all reads as any",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "filter.typeMode === \"all\" ? filter.types.every((type) => has(line, type))", to: "filter.typeMode === \"all\" ? filter.types.some((type) => has(line, type))" }],
  },
  {
    name: "q-type any reads as all",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: ": filter.types.some((type) => has(line, type)));", to: ": filter.types.every((type) => has(line, type)));" }],
  },
  {
    name: "q-type line text ignored",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "return typeOk && filter.typeText.every((part) => has(line, part));", to: "return typeOk;" }],
  },
  {
    name: "q-mv range open at the bottom",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "return value >= test.min && value <= test.max;", to: "return value > test.min && value <= test.max;" }],
  },
  {
    name: "q-mv <= reads as <",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "return value <= test.value;", to: "return value < test.value;" }],
  },
  {
    name: "q-mv > reads as >=",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "return value > test.value;", to: "return value >= test.value;" }],
  },
  {
    name: "q-mv != reads as =",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "return value !== test.value;", to: "return value === test.value;" }],
  },
  {
    name: "q-rarity ignored",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "(rarity) => (filter.rarities as string[]).includes(rarity)", to: "() => true" }],
  },
  {
    name: "q-rules text ignored",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "(text) => filter.oracle.every((part) => has(text, part))", to: "() => true" }],
  },
  {
    name: "q-power ignored",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "(power) => numberOf(power) !== null && testNumber(filter.power!, numberOf(power)!)", to: "() => true" }],
  },
  {
    name: "q-toughness ignored",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "(tough) => numberOf(tough) !== null && testNumber(filter.toughness!, numberOf(tough)!)", to: "() => true" }],
  },
  {
    name: "q-star power counts as 0",
    file: "src/lib/card-filter.ts",
    test: "matches types, type line text",
    edits: [{ from: "if (value === undefined || !/^[-+]?\\d+(\\.\\d+)?$/.test(value.trim())) return null;", to: "if (value === undefined) return null;\n  if (!/^[-+]?\\d+(\\.\\d+)?$/.test(value.trim())) return 0;" }],
  },
  {
    name: "q-toggle in-deck ignored",
    file: "src/lib/card-filter.ts",
    test: "checks the quick toggles",
    edits: [{ from: "if (filter.inDeck && subject.copies <= 0) return \"hidden\";", to: "" }],
  },
  {
    name: "q-toggle dfc ignored",
    file: "src/lib/card-filter.ts",
    test: "checks the quick toggles",
    edits: [{ from: "if (filter.dfc && !subject.dfc) return \"hidden\";", to: "" }],
  },
  {
    name: "q-toggle token/extra ignored",
    file: "src/lib/card-filter.ts",
    test: "checks the quick toggles",
    edits: [{ from: "if (filter.tokenExtra && subject.role === \"main\") return \"hidden\";", to: "" }],
  },
  {
    name: "q-toggle basics ignored",
    file: "src/lib/card-filter.ts",
    test: "checks the quick toggles",
    edits: [{ from: "if (filter.basics && !subject.basic) return \"hidden\";", to: "" }],
  },
  {
    name: "q-name search ignored",
    file: "src/lib/card-filter.ts",
    test: "finds unmatched cards by name",
    edits: [{ from: "if (filter.name.length && !filter.name.every((word) => subject.names.some((name) => has(name, word)))) return \"hidden\";", to: "" }],
  },
  {
    name: "q-missing fact reads as a mismatch",
    file: "src/lib/card-filter.ts",
    test: "finds unmatched cards by name",
    edits: [{ from: "      unknown = true;\n      return true;", to: "      return false;" }],
  },
  {
    name: "q-missing fact shown",
    file: "src/lib/card-filter.ts",
    test: "finds unmatched cards by name",
    edits: [{ from: "return unknown ? \"unknown\" : \"shown\";", to: "return \"shown\";" }],
  },
  {
    name: "q-attributeFilters misses rules text",
    file: "src/lib/card-filter.ts",
    test: "names the filters that need facts",
    edits: [{ from: "if (filter.oracle.length) out.push(\"rules text\");", to: "" }],
  },
  {
    name: "q-parser or groups split",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "if (pendingOr && items.length) items[items.length - 1]!.push(token);", to: "if (false) items[items.length - 1]!.push(token);" }],
  },
  {
    name: "q-parser no range join",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "return { op: \"range\", min, max };", to: "return next;" }],
  },
  {
    name: "q-parser > bound not made whole",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "test.op === \">\" ? (test as { value: number }).value + 1 : null", to: "test.op === \">\" ? (test as { value: number }).value : null" }],
  },
  {
    name: "q-parser c= not exact",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "if (op === \"=\") filter.colorMode = \"exact\";", to: "if (op === \"=\") filter.colorMode = \"all\";" }],
  },
  {
    name: "q-parser two types read as any",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "if (filter.types.length > 1) filter.typeMode = \"all\";", to: "" }],
  },
  {
    name: "q-parser guild names unknown",
    file: "src/lib/card-filter.ts",
    test: "reads the Scryfall-style terms into the filter model",
    edits: [{ from: "  if (words) return words;\n", to: "" }],
  },
  {
    name: "q-parser quotes dropped",
    file: "src/lib/card-filter.ts",
    test: "reads plain words, quoted names",
    edits: [{ from: "value: quoted ?? value!", to: "value: value!" }],
  },
  {
    name: "q-parser plain or-words become unknown",
    file: "src/lib/card-filter.ts",
    test: "reads plain words, quoted names",
    edits: [{ from: "if (terms.length > 1 && terms.every((term) => !term.key)) {", to: "if (false) {" }],
  },
  {
    name: "q-parser unknown terms dropped silently",
    file: "src/lib/card-filter.ts",
    test: "lists what it doesn't understand",
    edits: [{ from: "if (!applyTerm(filter, term)) unknown.push(term.raw);", to: "applyTerm(filter, term);" }],
  },
  {
    name: "q-parser mixed or group accepted",
    file: "src/lib/card-filter.ts",
    test: "lists what it doesn't understand",
    edits: [{ from: "if (kinds.size !== 1 || terms.some((term) => term.op !== \":\" && term.op !== \"=\")) return false;", to: "if (!kinds.size) return false;" }],
  },
  {
    name: "q-formatQuery range off by one",
    file: "src/lib/card-filter.ts",
    test: "writes every filter back as a query that reads the same",
    edits: [{ from: "if (test.op === \"range\") return `${key}>=${test.min} ${key}<=${test.max}`;", to: "if (test.op === \"range\") return `${key}>=${test.min} ${key}<${test.max}`;" }],
  },
  {
    name: "q-formatQuery any colors as one term",
    file: "src/lib/card-filter.ts",
    test: "writes every filter back as a query that reads the same",
    edits: [{ from: "if (filter.colorMode === \"any\" && filter.colors.length > 1)", to: "if (false)" }],
  },
  {
    name: "q-formatQuery drops colorless beside a color",
    file: "src/lib/card-filter.ts",
    test: "writes every filter back as a query that reads the same",
    edits: [{ from: "parts.push(filter.colorless ? `(${one} or c:c)` : one);", to: "parts.push(one);" }],
  },
  {
    name: "q-formatQuery no quotes",
    file: "src/lib/card-filter.ts",
    test: "writes every filter back as a query that reads the same",
    edits: [{ from: "const quote = (value: string) => (/[\\s()\":<>=!]/.test(value) || /^or$/i.test(value) ? `\"${value.replace(/\"/g, \"\")}\"` : value);", to: "const quote = (value: string) => value;" }],
  },
  {
    name: "q-mergeFacts keeps a fact some cards disagree on",
    file: "src/lib/card-facts.ts",
    test: "keeps only the facts that every card sharing a name agrees on",
    edits: [{ from: "if (rest.every((item) => JSON.stringify(item[field]) === value)) {", to: "if (rest.some((item) => JSON.stringify(item[field]) === value)) {" }],
  },
  {
    name: "q-mergeFacts not flagged ambiguous",
    file: "src/lib/card-facts.ts",
    test: "keeps only the facts that every card sharing a name agrees on",
    edits: [{ from: "if (!differ.length) return out;", to: "return out;" }],
  },
  {
    name: "q-factsFor takes an ambiguous entry first",
    file: "src/lib/card-facts.ts",
    test: "looks a card up by its front face first",
    edits: [{ from: "if (entry && !entry.ambiguous) return { status: \"matched\", facts: entry };", to: "if (entry) return { status: entry.ambiguous ? \"ambiguous\" : \"matched\", facts: entry };" }],
  },
  {
    name: "q-factsFromScryfall back face colors dropped",
    file: "src/lib/card-facts.ts",
    test: "keeps colors, type line, mana value",
    edits: [{ from: "faces.some((face) => face.colors) ? faces.flatMap((face) => face.colors ?? []) : undefined", to: "faces.some((face) => face.colors) ? (faces[0]!.colors ?? []) : undefined" }],
  },
  {
    name: "q-card-lookup check ignores unmatched list",
    file: "scripts/card-lookup.ts",
    test: "passes on the committed lookup, and fails when a name has no entry",
    edits: [{ from: "!own(lookup, key) && !listed.has(key)", to: "!own(lookup, key) && !listed.has(key) && false" }],
  },
  {
    name: "q-card-lookup check allows both",
    file: "scripts/card-lookup.ts",
    test: "passes on the committed lookup, and fails when a name has no entry",
    edits: [{ from: "const both = [...listed].filter((key) => own(lookup, key));", to: "const both: string[] = [];" }],
  },
  {
    name: "a-faces defer after the count check",
    file: "src/lib/faces.ts",
    test: "fold in from a Color and a Black and White folder too",
    edits: [
      {
        from: "    if (known && prefixedFronts.has(`${role}\\u0000${knownFront}`)) {\n      deferKnown = true;\n      continue;\n    }\n    if (known && (fronts.length !== 1 || backs.length !== 1)) continue;",
        to: "    if (known && (fronts.length !== 1 || backs.length !== 1)) continue;\n    if (known && prefixedFronts.has(`${role}\\u0000${knownFront}`)) {\n      deferKnown = true;\n      continue;\n    }",
      },
    ],
  },
  {
    name: "g-v0128 golden: Black and White SxF prints Color backs",
    file: "src/lib/selection.ts",
    test: "saves store, load and print exactly as v0.1.28 did",
    edits: [{ from: "export function applyTone(edition: Edition, selected: SavedCard[], tone: ArtTone): SavedCard[] {", to: "export function applyTone(_edition: Edition, selected: SavedCard[], _tone: ArtTone): SavedCard[] {\n  return selected;\n}\nexport function applyToneOld(edition: Edition, selected: SavedCard[], tone: ArtTone): SavedCard[] {" }],
  },
  // ---- v0.1.30: the tour, the deploy-time key, the card data failure, empty query values ----
  {
    name: "t-tour offered again after an answer",
    file: "src/lib/tour.ts",
    test: "shows on first load only, and No thanks is remembered",
    edits: [{ from: "return store.getItem(TOUR_KEY) === null;", to: "return store.getItem(TOUR_KEY) !== \"x\";" }],
  },
  {
    name: "t-tour answer not stored",
    file: "src/lib/tour.ts",
    test: "shows on first load only, and No thanks is remembered",
    edits: [{ from: "    store.setItem(TOUR_KEY, answer);", to: "    void store;" }],
  },
  {
    name: "t-tour offered when storage can't be read",
    file: "src/lib/tour.ts",
    test: "stays away when storage can't be read",
    edits: [{ from: "  } catch {\n    return false;\n  }", to: "  } catch {\n    return true;\n  }" }],
  },
  {
    name: "t-Take the tour not remembered",
    file: "src/App.tsx",
    test: "is answered No thanks by Esc, and Take the tour is remembered too",
    edits: [{ from: "rememberTourAnswer(localStorage, \"taken\");", to: "" }],
  },
  {
    name: "t-prompt Esc ignored",
    file: "src/components/Tour.tsx",
    test: "is answered No thanks by Esc, and Take the tour is remembered too",
    edits: [{ from: "      declineRef.current();", to: "" }],
  },
  {
    name: "t-tour Esc ignored",
    file: "src/components/Tour.tsx",
    test: "closes on Esc at any step",
    edits: [{ from: "        event.stopPropagation();\n        closeRef.current();\n        return;", to: "        event.stopPropagation();\n        return;" }],
  },
  {
    name: "t-tour Esc reaches the page",
    file: "src/components/Tour.tsx",
    test: "closes on Esc at any step",
    edits: [{ from: "        event.stopPropagation();\n        closeRef.current();\n        return;", to: "        closeRef.current();\n        return;" }],
  },
  {
    name: "t-tour focus not given back",
    file: "src/components/Tour.tsx",
    test: "closes on Esc at any step",
    edits: [{ from: "      if (back instanceof HTMLElement && back.isConnected) back.focus();\n      else document.querySelector<HTMLElement>(\"[data-tour-button]\")?.focus();", to: "" }],
  },
  {
    name: "t-tour focus back to the page body after the prompt",
    file: "src/components/Tour.tsx",
    test: "walks every step with Next and Back",
    edits: [{ from: "opener.current = document.activeElement === document.body ? null : document.activeElement;", to: "opener.current = document.activeElement;" }],
  },
  {
    name: "t-tour Next not focused",
    file: "src/components/Tour.tsx",
    test: "walks every step with Next and Back",
    edits: [{ from: "    nextRef.current?.focus();\n", to: "" }],
  },
  {
    name: "t-tour Tab escapes the caption",
    file: "src/components/Tour.tsx",
    test: "keeps Tab inside the caption",
    edits: [{ from: "    } else if (!event.shiftKey && document.activeElement === end) {\n      event.preventDefault();\n      first.focus();", to: "    } else if (!event.shiftKey && document.activeElement === end) {\n      void first;" }],
  },
  {
    name: "t-tour missing control never shown",
    file: "src/components/Tour.tsx",
    test: "shows a step whose control isn't on screen",
    edits: [{ from: "      } else setMissing(true);", to: "      }" }],
  },
  {
    name: "t-tour Back skips a step",
    file: "src/components/Tour.tsx",
    test: "walks every step with Next and Back",
    edits: [{ from: "onClick={() => setIndex(index - 1)}", to: "onClick={() => setIndex(Math.max(0, index - 2))}" }],
  },
  {
    name: "t-tour leaves the preview deck open",
    file: "src/App.tsx",
    test: "walks every step with Next and Back",
    edits: [{ from: "    if (start.opened) setSession(start.session);", to: "" }],
  },
  {
    name: "t-tour ends in the deck view",
    file: "src/App.tsx",
    test: "goes back to the deck list where the tour started",
    edits: [{ from: "    setTouring(false);\n    if (start.opened) setSession(start.session);\n    setView(start.view);", to: "    setTouring(false);\n    if (start.opened) setSession(start.session);" }],
  },
  {
    name: "t-tour replaces the deck being built",
    file: "src/App.tsx",
    test: "shows the deck you were building for the deck-view steps",
    edits: [{ from: "    if (current && \"edition\" in current) {", to: "    if (current && \"edition\" in current && !current) {" }],
  },
  {
    name: "t-tour saves the preview",
    file: "src/App.tsx",
    test: "walks every step with Next and Back",
    edits: [{ from: "    setSession(freshDraft(first.deck, first.edition));\n    setView(\"builder\");", to: "    const preview = freshDraft(first.deck, first.edition);\n    setSession(preview);\n    remember(mergeSaved(saved, [preview]));\n    setView(\"builder\");" }],
  },
  {
    name: "t-tour button hidden",
    file: "src/App.tsx",
    test: "shows on first load only, and No thanks is remembered",
    edits: [{ from: "      {!loading ? <TourButton onClick={startTour} /> : null}", to: "" }],
  },
  {
    name: "t-tour steps out of order",
    file: "src/lib/tour.ts",
    test: "has six steps",
    edits: [{ from: "    id: \"filters\",\n    view: \"builder\",", to: "    id: \"filters\",\n    view: \"home\"," }],
  },
  {
    name: "k-write-config uses a replacement string",
    file: "scripts/write-config.ts",
    test: "writes the key as a safe string literal",
    edits: [{ from: "template.replace(PLACEHOLDER_LINE, () => `  googleApiKey: ${JSON.stringify(key)},`)", to: "template.replace(PLACEHOLDER_LINE, `  googleApiKey: ${JSON.stringify(key)},`)" }],
  },
  {
    name: "k-write-config unquoted key",
    file: "scripts/write-config.ts",
    test: "writes the key as a safe string literal",
    edits: [{ from: "`  googleApiKey: ${JSON.stringify(key)},`", to: "`  googleApiKey: \"${key}\",`" }],
  },
  {
    name: "k-write-config no trim",
    file: "scripts/write-config.ts",
    test: "keeps the placeholder byte for byte",
    edits: [{ from: "const key = (rawKey ?? \"\").trim();", to: "const key = rawKey ?? \"\";" }],
  },
  {
    name: "k-write-config accepts spaces",
    file: "scripts/write-config.ts",
    test: "refuses a key with spaces or line breaks",
    edits: [{ from: "if (control || /\\s/.test(key) || key.includes(\"YOUR_GOOGLE\")) {", to: "if (control || key.includes(\"YOUR_GOOGLE\")) {" }],
  },
  {
    name: "k-write-config error shows the key",
    file: "scripts/write-config.ts",
    test: "refuses a key with spaces or line breaks",
    edits: [{ from: "throw new Error(\"The GOOGLE_API_KEY secret has spaces, line breaks or control characters in it, or is still the placeholder. Fix the secret. config.js was not changed.\");", to: "throw new Error(`The GOOGLE_API_KEY secret has spaces (${key}).`);" }],
  },
  {
    name: "k-write-config no placeholder count check",
    file: "scripts/write-config.ts",
    test: "refuses a key with spaces or line breaks",
    edits: [{ from: "  if (found !== 1) {", to: "  if (found > 5) {" }],
  },
  {
    name: "k-write-config prints the key",
    file: "scripts/write-config.ts",
    test: "runs as the workflow runs it",
    edits: [{ from: "    console.log(outputLine(path.basename(target), result, process.env.GITHUB_ACTIONS === \"true\"));", to: "    console.log(`${outputLine(path.basename(target), result, process.env.GITHUB_ACTIONS === \"true\")}${result.wrote ? ` (${process.env.GOOGLE_API_KEY})` : \"\"}`);" }],
  },
  {
    name: "k-write-config writes without a key",
    file: "scripts/write-config.ts",
    test: "keeps the placeholder byte for byte",
    edits: [{ from: "    return { text: template, wrote: false,", to: "    return { text: template.replace(PLACEHOLDER_LINE, '  googleApiKey: \"\",'), wrote: false," }],
  },
  {
    name: "k-workflow echoes the key",
    file: ".github/workflows/pages.yml",
    test: "never echoes, prints or traces the key",
    edits: [{ from: "        run: npx tsx scripts/write-config.ts dist/config.js", to: "        run: echo \"$GOOGLE_API_KEY\" > /dev/null && npx tsx scripts/write-config.ts dist/config.js" }],
  },
  {
    name: "k-workflow secret on the command line",
    file: ".github/workflows/pages.yml",
    test: "has the step after the build and before the upload",
    edits: [{ from: "        env:\n          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}\n        run: npx tsx scripts/write-config.ts dist/config.js", to: "        run: GOOGLE_API_KEY=${{ secrets.GOOGLE_API_KEY }} npx tsx scripts/write-config.ts dist/config.js" }],
  },
  {
    name: "k-workflow step after the upload",
    file: ".github/workflows/pages.yml",
    test: "has the step after the build and before the upload",
    edits: [
      { from: "      - name: Write the Google API key into dist/config.js\n        env:\n          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}\n        run: npx tsx scripts/write-config.ts dist/config.js\n", to: "" },
      { from: "        with:\n          path: dist\n", to: "        with:\n          path: dist\n      - name: Write the Google API key into dist/config.js\n        env:\n          GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}\n        run: npx tsx scripts/write-config.ts dist/config.js\n" },
    ],
  },
  {
    name: "k-config.js placeholder changed",
    file: "public/config.js",
    test: "finds exactly one placeholder line in public/config.js",
    edits: [{ from: "  googleApiKey: \"YOUR_GOOGLE_API_KEY\",", to: "  googleApiKey: \"YOUR_GOOGLE_API_KEY\" ," }],
  },
  {
    name: "a-card lookup failure cached",
    file: "src/lib/use-card-lookup.ts",
    test: "forgets a failed load",
    edits: [{ from: "    .catch((error: unknown) => {\n      loading = undefined;\n      throw error;\n    });", to: "    .catch((error: unknown) => {\n      throw error;\n    });" }],
  },
  {
    name: "a-card lookup failure never reported",
    file: "src/lib/use-card-lookup.ts",
    test: "says so instead of 'Loading card data…'",
    edits: [{ from: "        if (live) setFailed(true);", to: "        void live;" }],
  },
  {
    name: "a-card lookup retry does nothing",
    file: "src/lib/use-card-lookup.ts",
    test: "says so instead of 'Loading card data…'",
    edits: [{ from: "    setAttempt((value) => value + 1);", to: "" }],
  },
  {
    name: "a-failed card data hides every card",
    file: "src/components/BuilderView.tsx",
    test: "says so instead of 'Loading card data…'",
    edits: [{ from: "(lookupFailed ? withoutAttributeFilters(parsed.filter) : parsed.filter)", to: "parsed.filter" }],
  },
  {
    name: "a-withoutAttributeFilters keeps types",
    file: "src/lib/card-filter.ts",
    test: "says so instead of 'Loading card data…'",
    edits: [{ from: "colorless: false, multicolor: false, types: [], typeMode: \"any\",", to: "colorless: false, multicolor: false, typeMode: \"any\"," }],
  },
  {
    name: "a-failed note says Loading",
    file: "src/components/BuilderView.tsx",
    test: "says so instead of 'Loading card data…'",
    edits: [{ from: "        ) : needsFacts && !lookup ? (", to: "        ) : null}\n        {needsFacts && !lookup ? (" }],
  },
  {
    name: "b-empty value kept",
    file: "src/lib/card-filter.ts",
    test: "drops an unfinished t:",
    edits: [{ from: "  const tokens = tokenize(text).filter((token) => typeof token === \"string\" || token.value.trim() !== \"\");", to: "  const tokens = tokenize(text);" }],
  },
  {
    name: "b-formatQuery writes empty text",
    file: "src/lib/card-filter.ts",
    test: "drops an unfinished t:",
    edits: [{ from: "  const filled = (list: string[]) => list.filter((value) => value.trim() !== \"\");", to: "  const filled = (list: string[]) => list;" }],
  },
  {
    name: "g-v0129 golden: Clear shown keeps the first shown card",
    file: "src/lib/clear.ts",
    test: "clears the same cards as v0.1.29 did",
    edits: [{ from: "return selected.filter((card) => !cardIds.has(card.cardId));", to: "return selected.filter((card) => !cardIds.has(card.cardId) || card.cardId === [...cardIds][0]);" }],
  },
  // ---- v0.1.31: the pop-up (no flip), backs beside the front, the deck splash, the tour fixes, the lookup message, the Actions warning ----
  {
    name: "p-flyout pops in slowly",
    file: "src/lib/desktop.ts",
    test: "is quick",
    edits: [{ from: "export const FLYOUT_POP_MS = 180;", to: "export const FLYOUT_POP_MS = 600;" }],
  },
  {
    name: "p-flyout pop overshoots",
    file: "src/lib/desktop.ts",
    test: "is quick",
    edits: [{ from: "export const FLYOUT_POP_EASING = \"cubic-bezier(0.22, 1, 0.36, 1)\";", to: "export const FLYOUT_POP_EASING = \"cubic-bezier(0.22, 1, 0.36, 1.4)\";" }],
  },
  {
    name: "p-reduced fade too slow",
    file: "src/lib/desktop.ts",
    test: "is quick",
    edits: [{ from: "export const FLYOUT_REDUCED_FADE_MS = 60;", to: "export const FLYOUT_REDUCED_FADE_MS = 300;" }],
  },
  {
    name: "p-pop timing not applied",
    file: "src/components/CardFlyout.tsx",
    test: "takes its pop-up timing",
    edits: [{ from: "    \"--flyout-pop-ms\": `${FLYOUT_POP_MS}ms`,\n", to: "" }],
  },
  {
    name: "p-pop easing not applied",
    file: "src/components/CardFlyout.tsx",
    test: "takes its pop-up timing",
    edits: [{ from: "    \"--flyout-pop-ease\": FLYOUT_POP_EASING,\n", to: "" }],
  },
  {
    name: "p-pop from the side, not the thumbnail",
    file: "src/components/CardFlyout.tsx",
    test: "scales in from the thumbnail",
    edits: [{ from: "    transformOrigin: `${origin.x}px ${origin.y}px`,", to: "    transformOrigin: placement.side === \"left\" ? \"right center\" : \"left center\"," }],
  },
  {
    name: "p-pop origin off by the placement",
    file: "src/lib/desktop.ts",
    test: "scales in from the centre of the hovered thumbnail",
    edits: [{ from: "y: Math.round((thumb.top + thumb.bottom) / 2 - placement.top)", to: "y: Math.round((thumb.top + thumb.bottom) / 2)" }],
  },
  {
    name: "p-css pop fallback drifts",
    file: "src/index.css",
    test: "keeps the stylesheet fallbacks in step",
    edits: [{ from: "var(--flyout-pop-ms, 180ms)", to: "var(--flyout-pop-ms, 400ms)" }],
  },
  {
    name: "p-css pop has no scale",
    file: "src/index.css",
    test: "keeps the stylesheet fallbacks in step",
    edits: [{ from: "  from { opacity: 0; transform: scale(var(--flyout-pop-from, 0.6)); }", to: "  from { opacity: 0; }" }],
  },
  {
    name: "p-css reduced motion scales",
    file: "src/index.css",
    test: "only fades with reduced motion",
    edits: [{ from: "@keyframes beeline-flyout-fade-in {\n  from { opacity: 0; }", to: "@keyframes beeline-flyout-fade-in {\n  from { opacity: 0; transform: scale(0.9); }" }],
  },
  {
    name: "p-css reduced motion pops",
    file: "src/index.css",
    test: "only fades with reduced motion",
    edits: [{ from: "  .beeline-flyout,\n  .beeline-flyout[data-flyout-motion] { animation: beeline-flyout-fade-in var(--flyout-fade-ms, 60ms) linear both; }", to: "  .beeline-flyout { animation-duration: 60ms; }" }],
  },
  {
    name: "p-css flip comes back",
    file: "src/index.css",
    test: "has no flip left",
    edits: [{ from: ".beeline-flyout-face {\n  overflow: hidden;", to: ".beeline-flyout-face {\n  backface-visibility: hidden;\n  overflow: hidden;" }],
  },
  {
    name: "p-reduced motion still pops",
    file: "src/components/CardFlyout.tsx",
    test: "only fades with reduced motion",
    edits: [{ from: "data-flyout-motion={reducedMotion ? \"fade\" : \"pop\"}", to: "data-flyout-motion=\"pop\"" }],
  },
  {
    name: "p-reduced motion not read",
    file: "src/components/use-card-flyout.tsx",
    test: "only fades with reduced motion",
    edits: [{ from: "reducedMotion: matches(REDUCED_MOTION_MEDIA) });", to: "reducedMotion: false });" }],
  },
  {
    name: "b2-custom back loses to the back face",
    file: "src/lib/desktop.ts",
    test: "shows a back picked in the card editor over",
    edits: [{ from: "  if (customBack) return { kind: \"custom\", image: customBack };\n  if (dfcBack) return { kind: \"dfc\", image: dfcBack };", to: "  if (dfcBack) return { kind: \"dfc\", image: dfcBack };\n  if (customBack) return { kind: \"custom\", image: customBack };" }],
  },
  {
    name: "b2-pick not passed to the pop-up",
    file: "src/components/use-card-flyout.tsx",
    test: "saves a pick, shows it on the tile",
    edits: [{ from: "flyoutBack({ customBack: card.customBack, dfcBack: card.dfcBack })", to: "flyoutBack({ dfcBack: card.dfcBack })" }],
  },
  {
    name: "b2-deck back drawn for every card",
    file: "src/lib/desktop.ts",
    test: "shows no back for a one-faced card",
    edits: [{ from: "  return null;\n}\n\nexport type FlyoutLayout", to: "  return { kind: \"dfc\", image: \"deck-back\" };\n}\n\nexport type FlyoutLayout" }],
  },
  {
    name: "b2-back not drawn",
    file: "src/components/CardFlyout.tsx",
    test: "shows a double-faced card's own back face beside the front",
    edits: [{ from: "      {back && layout.back ? (", to: "      {false && back && layout.back ? (" }],
  },
  {
    name: "b2-back at full size",
    file: "src/lib/desktop.ts",
    test: "puts the back beside the front at half its width",
    edits: [{ from: "export const FLYOUT_BACK_SCALE = 0.5;", to: "export const FLYOUT_BACK_SCALE = 1;" }],
  },
  {
    name: "b2-labels swapped",
    file: "src/components/CardFlyout.tsx",
    test: "saves a pick, shows it on the tile|own back face beside the front",
    edits: [{ from: "const BACK_LABEL = { custom: \"Chosen back\", dfc: \"Back face\" } as const;", to: "const BACK_LABEL = { custom: \"Back face\", dfc: \"Chosen back\" } as const;" }],
  },
  {
    name: "b2-pair never shrinks",
    file: "src/lib/desktop.ts",
    test: "shrinks the pair to fit beside a row",
    edits: [{ from: "  if (pair(width) > room) width =", to: "  if (false) width =" }],
  },
  {
    name: "b2-pair shrinks below the minimum",
    file: "src/lib/desktop.ts",
    test: "never shrinks the front below the minimum",
    edits: [{ from: "Math.max(FLYOUT_MIN_PAIR_WIDTH, Math.floor((room - gap) / (1 + FLYOUT_BACK_SCALE)))", to: "Math.floor((room - gap) / (1 + FLYOUT_BACK_SCALE))" }],
  },
  {
    name: "b2-placement ignores the back",
    file: "src/components/use-card-flyout.tsx",
    test: "shrinks the pair|puts the back on the far side",
    edits: [{ from: "const placement = flyoutPlacement(rect, viewport, layout.size);", to: "const placement = flyoutPlacement(rect, viewport, layout.front);" }],
  },
  {
    name: "b2-back on the near side",
    file: "src/components/CardFlyout.tsx",
    test: "puts the back on the far side",
    edits: [{ from: "flexDirection: placement.side === \"left\" ? \"row-reverse\" : \"row\",", to: "flexDirection: \"row\"," }],
  },
  {
    name: "b2-single card shrinks too",
    file: "src/lib/desktop.ts",
    test: "keeps the front alone at full size",
    edits: [{ from: "  if (!hasBack) return { front: full, back: null, size: full };\n", to: "" }],
  },
  {
    name: "s-splash every time",
    file: "src/lib/splash.ts",
    test: "keys each deck on its own",
    edits: [{ from: "    return store.getItem(splashKey(deckId)) === null;", to: "    return true;" }],
  },
  {
    name: "s-splash plays when storage is broken",
    file: "src/lib/splash.ts",
    test: "keys each deck on its own",
    edits: [{ from: "  } catch {\n    return false;\n  }\n}\n\n/** Remember", to: "  } catch {\n    return true;\n  }\n}\n\n/** Remember" }],
  },
  {
    name: "s-one key for every deck",
    file: "src/lib/splash.ts",
    test: "keys each deck on its own",
    edits: [{ from: "export const splashKey = (deckId: string) => `${SPLASH_KEY_PREFIX}${deckId}`;", to: "export const splashKey = (deckId: string) => `${SPLASH_KEY_PREFIX}${deckId.length ? \"deck\" : \"\"}`;" }],
  },
  {
    name: "s-splash in localStorage",
    file: "src/App.tsx",
    test: "plays once per deck per session",
    edits: [{ from: "    return window.sessionStorage;", to: "    return window.localStorage;" }],
  },
  {
    name: "s-splash not remembered",
    file: "src/App.tsx",
    test: "plays once per deck per session",
    edits: [{ from: "    if (!rememberSplash(store, splashDeck)) return;\n", to: "" }],
  },
  {
    name: "s-no splash on Build",
    file: "src/App.tsx",
    test: "plays once per deck per session",
    edits: [{ from: "            openDeckSplash(choice.deck.id, choice.deck.name);\n", to: "" }],
  },
  {
    name: "s-no splash for a saved deck",
    file: "src/App.tsx",
    test: "plays for a saved deck and for Continue",
    edits: [{ from: "            openDeckSplash(found.deck.id, found.deck.name);\n", to: "" }],
  },
  {
    name: "s-no splash on Continue",
    file: "src/App.tsx",
    test: "plays for a saved deck and for Continue",
    edits: [{ from: "            setView(\"builder\");\n            openDeckSplash(found.deck.id, found.deck.name);\n            if (found.note) setToast(found.note);\n          }}\n          onUnlock", to: "            setView(\"builder\");\n            if (found.note) setToast(found.note);\n          }}\n          onUnlock" }],
  },
  {
    name: "s-prompt over the splash",
    file: "src/App.tsx",
    test: "waits for the tour",
    edits: [{ from: "{!loading && offerTour && !touring && !splash ? (", to: "{!loading && offerTour && !touring ? (" }],
  },
  {
    name: "s-Esc ignored",
    file: "src/components/Splash.tsx",
    test: "plays once per deck per session",
    edits: [{ from: "      if (event.key === \"Escape\") {\n        event.preventDefault();\n        event.stopPropagation();\n        finishRef.current(\"skip\");", to: "      if (event.key === \"Esc\") {\n        event.preventDefault();\n        event.stopPropagation();\n        finishRef.current(\"skip\");" }],
  },
  {
    name: "s-click doesn't skip",
    file: "src/components/Splash.tsx",
    test: "is skipped by a click|plays once per deck per session",
    edits: [{ from: "      onClick={() => finish(\"skip\")}\n", to: "" }],
  },
  {
    name: "s-Skip button does nothing",
    file: "src/components/Splash.tsx",
    test: "is skipped by a click",
    edits: [{ from: "          event.stopPropagation();\n          finish(\"skip\");", to: "          event.stopPropagation();" }],
  },
  {
    name: "s-never ends on its own",
    file: "src/components/Splash.tsx",
    test: "closes on its own after it plays",
    edits: [{ from: "    const timer = window.setTimeout(() => finishRef.current(\"complete\"), splashLimitMs(choice, reducedMotion));", to: "    const timer = 0;" }],
  },
  {
    name: "s-reduced motion still plays",
    file: "src/lib/splash.ts",
    test: "shows a still frame with reduced motion|uses the registry",
    edits: [{ from: "  if (reducedMotion) return SPLASH_STATIC_MS;\n", to: "" }],
  },
  {
    name: "s-reduced motion not passed",
    file: "src/App.tsx",
    test: "shows a still frame with reduced motion",
    edits: [{ from: "reducedMotion: reducedMotion() });", to: "reducedMotion: false });" }],
  },
  {
    name: "s-registry ignored",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry",
    edits: [{ from: "  if (isSplashAsset(asset)) return asset;\n", to: "" }],
  },
  {
    name: "s-malformed entry used",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry",
    edits: [{ from: "&& typeof asset.src === \"string\" && asset.src !== \"\";", to: "&& typeof asset.src === \"string\";" }],
  },
  {
    name: "s-no poster frame",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry|poster frame",
    edits: [{ from: "const params = reducedMotion ? \"noskip=1&poster=1\" : \"noskip=1\";", to: "const params = \"noskip=1\";" }],
  },
  {
    name: "s-missing frame never skipped",
    file: "src/components/Splash.tsx",
    test: "never says it is ready",
    edits: [{ from: "    const timer = window.setTimeout(() => finishRef.current(\"failed\"), SPLASH_READY_TIMEOUT_MS);", to: "    const timer = 0;" }],
  },
  {
    name: "s-messages from anywhere",
    file: "src/components/Splash.tsx",
    test: "ignores messages from anywhere else",
    edits: [{ from: "if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;", to: "if (!frameRef.current) return;" }],
  },
  {
    name: "s-ready ignored",
    file: "src/components/Splash.tsx",
    test: "ends on its end message",
    edits: [{ from: "if (type === \"beeline-splash:ready\") setReady(true);", to: "if (type === \"beeline-splash:ready\") void 0;" }],
  },
  {
    name: "s-end ignored",
    file: "src/components/Splash.tsx",
    test: "ends on its end message",
    edits: [{ from: "else if (type === \"beeline-splash:end\") finishRef.current(\"complete\");", to: "else if (type === \"beeline-splash:end\") void 0;" }],
  },
  {
    name: "s-broken image kept",
    file: "src/components/Splash.tsx",
    test: "skips an image splash that fails",
    edits: [{ from: "          onError={() => finish(\"failed\")}\n        />\n      ) : (", to: "          onError={() => undefined}\n        />\n      ) : (" }],
  },
  {
    name: "s-frame not sandboxed",
    file: "src/components/Splash.tsx",
    test: "never says it is ready",
    edits: [{ from: "          sandbox=\"allow-scripts\"\n", to: "" }],
  },
  {
    name: "s-page reachable behind the splash",
    file: "src/components/Splash.tsx",
    test: "keeps Tab, Enter and clicks away",
    edits: [{ from: "    const release = overlayRef.current ? guardOverlay(overlayRef.current, () => skipRef.current?.focus()) : () => undefined;", to: "    const release = () => undefined;" }],
  },
  {
    name: "s-Enter reaches the page",
    file: "src/components/Splash.tsx",
    test: "keeps Tab, Enter and clicks away",
    edits: [{ from: "if (event.key === \"Tab\" || ((event.key === \"Enter\" || event.key === \" \") && document.activeElement !== skipRef.current)) {", to: "if (event.key === \"Tab\") {" }],
  },
  {
    name: "s-Tab leaves Skip",
    file: "src/components/Splash.tsx",
    test: "keeps Tab, Enter and clicks away",
    edits: [{ from: "if (event.key === \"Tab\" || ((event.key", to: "if ((event.key === \"Tab\" && document.activeElement !== skipRef.current) || ((event.key" }],
  },
  {
    name: "t2-tour from a deck goes home",
    file: "src/App.tsx",
    test: "replays from the Tour button in the middle of a deck",
    edits: [{ from: "    const inDeck = building !== null;", to: "    const inDeck = false;" }],
  },
  {
    name: "t2-in-deck intro missing",
    file: "src/App.tsx",
    test: "replays from the Tour button in the middle of a deck",
    edits: [{ from: "    setTourIntro(inDeck ? TOUR_IN_DECK_INTRO : null);", to: "    setTourIntro(null);" }],
  },
  {
    name: "t2-intro on every step",
    file: "src/components/Tour.tsx",
    test: "replays from the Tour button in the middle of a deck",
    edits: [{ from: "{intro && index === 0 ? ", to: "{intro ? " }],
  },
  {
    name: "t2-intro from the deck list",
    file: "src/App.tsx",
    test: "starts at step 1 with all six steps",
    edits: [{ from: "    setTourIntro(inDeck ? TOUR_IN_DECK_INTRO : null);", to: "    setTourIntro(TOUR_IN_DECK_INTRO);" }],
  },
  {
    name: "t2-page not inert under the tour",
    file: "src/lib/modal-guard.ts",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "    child.setAttribute(\"inert\", \"\");\n", to: "" }],
  },
  {
    name: "t2-inert left on after the tour",
    file: "src/lib/modal-guard.ts",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "    for (const element of made) element.removeAttribute(\"inert\");\n", to: "" }],
  },
  {
    name: "t2-overlay itself inert",
    file: "src/lib/modal-guard.ts",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "    if (child === overlay || child.contains(overlay) || child.hasAttribute(\"inert\")) continue;", to: "    if (child.hasAttribute(\"inert\")) continue;" }],
  },
  {
    name: "t2-no focus guard",
    file: "src/lib/modal-guard.ts",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "  doc.addEventListener(\"focusin\", onFocusIn, true);\n", to: "" }],
  },
  {
    name: "t2-backdrop takes focus",
    file: "src/lib/modal-guard.ts",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "  event.preventDefault();\n}", to: "  void event;\n}" }],
  },
  {
    name: "t2-Tab from body reaches the page",
    file: "src/components/Tour.tsx",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "      if (event.key !== \"Tab\" && event.key !== \"Enter\" && event.key !== \" \") return;", to: "      if (event.key !== \"Enter\" && event.key !== \" \") return;" }],
  },
  {
    name: "t2-Enter from body reaches the page",
    file: "src/components/Tour.tsx",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "      if (event.key !== \"Tab\" && event.key !== \"Enter\" && event.key !== \" \") return;", to: "      if (event.key !== \"Tab\" && event.key !== \" \") return;" }],
  },
  {
    name: "t2-guard released after focus is given back",
    file: "src/components/Tour.tsx",
    test: "keeps Tab and Enter away from Clear all and Save",
    edits: [{ from: "    return () => {\n      release();\n      const back = opener.current;", to: "    return () => {\n      const back = opener.current;" }],
  },
  {
    name: "t2-Tour button covers a phone tile",
    file: "src/components/Tour.tsx",
    test: "stays out of the way on a phone",
    edits: [{ from: "className=\"relative mx-4 mt-2 mb-4 h-10 rounded-full bg-card/90 px-3 shadow-lg shadow-black/40 sm:fixed sm:bottom-4 sm:left-4 sm:z-40 sm:m-0\"", to: "className=\"fixed bottom-4 left-4 z-40 h-10 rounded-full bg-card/90 px-3 shadow-lg shadow-black/40\"" }],
  },
  {
    name: "l-no reload advice",
    file: "src/components/BuilderView.tsx",
    test: "says so instead of 'Loading card data",
    edits: [{ from: "            , or reload the page if that doesn't work.\n", to: "            .\n" }],
  },
  {
    name: "w-no warning in Actions",
    file: "scripts/write-config.ts",
    test: "runs as the workflow runs it",
    edits: [{ from: "  if (!result.wrote && inActions) return `::warning title=Paid unlock is off::${result.message}`;\n", to: "" }],
  },
  {
    name: "w-warning when the key was written",
    file: "scripts/write-config.ts",
    test: "runs as the workflow runs it",
    edits: [{ from: "  if (!result.wrote && inActions) return", to: "  if (inActions) return" }],
  },
  {
    name: "w-golden v0.1.30 clear shown",
    file: "src/lib/clear.ts",
    test: "clears the same cards as v0.1.30 did",
    edits: [{ from: "return selected.filter((card) => !cardIds.has(card.cardId));", to: "return selected.filter((card) => !cardIds.has(card.cardId) || card.cardId === [...cardIds].at(-1));" }],
  },
  {
    name: "sf-fallback not passed",
    file: "src/App.tsx",
    test: "plays Frame Lab's BeeLine splash",
    edits: [{ from: "splashFor(splashDeck, SPLASH_ASSETS, SPLASH_FALLBACK)", to: "splashFor(splashDeck, SPLASH_ASSETS)" }],
  },
  {
    name: "sf-fallback ignored",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry, else the BeeLine fallback",
    edits: [{ from: "  if (isSplashAsset(fallback)) return fallback;\n", to: "" }],
  },
  {
    name: "sf-malformed fallback used",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry, else the BeeLine fallback",
    edits: [{ from: "if (isSplashAsset(fallback)) return fallback;", to: "if (fallback) return fallback;" }],
  },
  {
    name: "sf-page keeps its own Skip",
    file: "src/lib/splash.ts",
    test: "uses the deck's registry entry, else the BeeLine fallback",
    edits: [{ from: "const params = reducedMotion ? \"noskip=1&poster=1\" : \"noskip=1\";", to: "const params = reducedMotion ? \"poster=1\" : \"\";" }],
  },
  {
    name: "sf-no page backdrop",
    file: "src/components/Splash.tsx",
    test: "plays once per deck per session",
    edits: [{ from: "style={choice.kind === \"frame\" && choice.background ? { backgroundColor: choice.background } : undefined}", to: "style={undefined}" }],
  },
  {
    name: "sf-focus left on body",
    file: "src/components/Splash.tsx",
    test: "gives focus to the deck heading",
    edits: [{ from: "      else document.querySelector<HTMLElement>(SPLASH_FOCUS_AFTER)?.focus({ preventScroll: true });\n", to: "" }],
  },
  {
    name: "sf-heading not focusable",
    file: "src/components/BuilderView.tsx",
    test: "gives focus to the deck heading",
    edits: [{ from: " tabIndex={-1} data-deck-heading=\"\"", to: " data-deck-heading=\"\"" }],
  },
  {
    name: "sf-focus to the search box first",
    file: "src/components/Splash.tsx",
    test: "gives focus to the deck heading",
    edits: [{ from: "const SPLASH_FOCUS_AFTER = '[data-deck-heading], input[aria-label=\"Search this deck\"]';", to: "const SPLASH_FOCUS_AFTER = 'input[aria-label=\"Search this deck\"]';" }],
  },
  {
    name: "sf-registry misses a deck",
    file: "src/data/splash-assets.ts",
    test: "has a Frame Lab page for every shipped deck id",
    edits: [{ from: "  kpdh: { kind: \"frame\", src: \"splash/splashes/kpdh.html\", durationMs: 2200, label: \"KPDH\", background: \"#0b0315\" },\n", to: "" }],
  },
  {
    name: "sf-horror plays the old page",
    file: "src/data/splash-assets.ts",
    test: "has a Frame Lab page for every shipped deck id",
    edits: [{ from: "src: \"splash/splashes/horror-c.html\"", to: "src: \"splash/splashes/horror.html\"" }],
  },
  {
    name: "sf-fallback is not BeeLine",
    file: "src/data/splash-assets.ts",
    test: "has a Frame Lab page for every shipped deck id",
    edits: [{ from: "src: \"splash/splashes/beeline.html\"", to: "src: \"splash/splashes/xmen.html\"" }],
  },
  {
    name: "sf-allow-list ships horror-a",
    file: "scripts/splash-files.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "  \"splashes/horror-c.html\",\n", to: "  \"splashes/horror-c.html\",\n  \"splashes/horror-a.html\",\n" }],
  },
  {
    name: "sf-allow-list drops a font",
    file: "scripts/splash-files.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "  \"fonts/anton.woff2\",\n", to: "" }],
  },
  {
    name: "sf-excluded not listed",
    file: "scripts/splash-files.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "  \"splashes/horror-b.html\",\n  \"fonts/vt323.woff2\",", to: " \"fonts/vt323.woff2\"," }],
  },
  {
    name: "cs-excluded allowed on the list",
    file: "scripts/copy-splash.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "if (SPLASH_EXCLUDED.includes(file) || SPLASH_EXCLUDED_DIRS.some((dir) => file.startsWith(dir))) problems.push", to: "if (SPLASH_EXCLUDED_DIRS.some((dir) => file.startsWith(dir))) problems.push" }],
  },
  {
    name: "cs-manifest extras ignored",
    file: "scripts/copy-splash.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "    else if (!allow.includes(file)) problems.push(`${file}: in the manifest, not on the allow-list`);\n", to: "" }],
  },
  {
    name: "cs-strays kept",
    file: "scripts/copy-splash.ts",
    test: "copies only the allow-list",
    edits: [{ from: "  for (const file of strayFiles(to, allow)) {\n    rmSync(path.join(to, file));", to: "  for (const file of strayFiles(to, allow).slice(0, 0)) {\n    rmSync(path.join(to, file));" }],
  },
  {
    name: "cs-rewrites every time",
    file: "scripts/copy-splash.ts",
    test: "copies only the allow-list",
    edits: [{ from: "if (existsSync(target) && readFileSync(target).equals(data)) {", to: "if (false && existsSync(target) && readFileSync(target).equals(data)) {" }],
  },
  {
    name: "cs-unverified source copied",
    file: "scripts/copy-splash.ts",
    test: "refuses to copy a source",
    edits: [{ from: "const before = [...allowListProblems(manifest, allow), ...hashProblems(from, manifest)];", to: "const before = [...allowListProblems(manifest, allow)];" }],
  },
  {
    name: "cs-check ignores extra files",
    file: "scripts/copy-splash.ts",
    test: "check finds a changed, missing or extra file",
    edits: [{ from: "    ...strayFiles(dir).map((file) => `${file}: not on the allow-list`),\n", to: "" }],
  },
  {
    name: "cs-check ignores hashes",
    file: "scripts/copy-splash.ts",
    test: "check finds a changed, missing or extra file",
    edits: [{ from: "else if (sha256(readFileSync(full)) !== hash) problems.push(`${file}: sha256 differs from the manifest`);", to: "" }],
  },
  {
    name: "cs-check ignores missing files",
    file: "scripts/copy-splash.ts",
    test: "check finds a changed, missing or extra file",
    edits: [{ from: "if (!existsSync(full)) problems.push(`${file}: missing`);\n    else if", to: "if (!existsSync(full)) continue;\n    else if" }],
  },
  {
    name: "cs-network URLs allowed",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "      problems.push(`${file}: network URL ${url}`);\n", to: "" }],
  },
  {
    name: "cs-key prefix allowed",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "    if (data.includes(KEY_PREFIX)) problems.push(`${file}: holds a Google API key prefix`);\n", to: "" }],
  },
  {
    name: "cs-user name allowed",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "    if (data.toString(\"latin1\").toLowerCase().includes(USER_NAME)) problems.push(`${file}: holds a user name`);\n", to: "" }],
  },
  {
    name: "cs-drive ids allowed",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "    if (ids.length) problems.push(`${file}: ${ids.length} Drive-id-like string(s)`);\n", to: "" }],
  },
  {
    name: "cs-fonts unchecked",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "else for (const font of files) if (!allow.includes(font)) problems.push", to: "else for (const font of files.slice(0, 0)) if (!allow.includes(font)) problems.push" }],
  },
  {
    name: "cs-references unchecked",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "    for (const ref of pageReferences(page, html)) if (!allow.includes(ref)) problems.push(`${page}: refers to ${ref}, not on the allow-list`);\n", to: "" }],
  },
  {
    name: "cs-duration unchecked",
    file: "scripts/copy-splash.ts",
    test: "flags a network URL",
    edits: [{ from: "    if (entry.asset.durationMs !== duration) problems.push", to: "    if (entry.asset.durationMs !== duration && false) problems.push" }],
  },
  {
    name: "cs-check skips the content checks",
    file: "scripts/copy-splash.ts",
    test: "check finds a changed, missing or extra file",
    edits: [{ from: "    ...contentProblems(dir),\n", to: "" }],
  },
  {
    name: "lz-no cross-origin header",
    file: "local/serve_beeline.py",
    test: "local build",
    edits: [{ from: '            self.send_header("Access-Control-Allow-Origin", "*")\n', to: "            pass\n" }],
  },
  {
    name: "lz-serves the whole network",
    file: "local/serve_beeline.py",
    test: "local build",
    edits: [{ from: 'HOST = "127.0.0.1"', to: 'HOST = "0.0.0.0"' }],
  },
  {
    name: "lz-woff2 type left to the system",
    file: "local/serve_beeline.py",
    test: "local build",
    edits: [{ from: '    ".woff2": "font/woff2",\n', to: "" }],
  },
  {
    name: "lz-bat runs plain http.server",
    file: "local/Start BeeLine.bat",
    test: "local build",
    edits: [{ from: "(py serve_beeline.py) || (python serve_beeline.py)", to: "(py -m http.server 4178 --bind 127.0.0.1) || (python -m http.server 4178 --bind 127.0.0.1)" }],
  },
  {
    name: "g-paid entry not reported",
    file: "src/lib/crawl.ts",
    test: "fails on a paid folder straight under the root",
    edits: [{ from: "    if (names.some((name) => paidEditionName(name))) return \"paid\";\n", to: "" }],
  },
  {
    name: "g-paid shortcut target not checked",
    file: "src/lib/crawl.ts",
    test: "checks a shortcut's own title before listing its target",
    edits: [{ from: "    const refusedTitle = title === entry.name ? null : refusal([...trail, title]);", to: "    const refusedTitle = null as ReturnType<typeof refusal>;" }],
  },
  {
    name: "g-shortcuts not followed",
    file: "src/lib/crawl.ts",
    test: "passes BeeLine, follows every shortcut",
    edits: [{ from: "    const id = listId(entry);\n    if (entry.shortcut) report.shortcuts += 1;", to: "    const id = entry.id;\n    if (entry.shortcut) report.shortcuts += 1;" }],
  },
  {
    name: "g-unreadable dropped",
    file: "src/lib/crawl.ts",
    test: "reports unreadable folders",
    edits: [{ from: "      report.unreadable.push(shown(here));\n", to: "" }],
  },
  {
    name: "g-assert is a no-op",
    file: "src/lib/crawl.ts",
    test: "fails on a paid folder inside a deck folder",
    edits: [{ from: "  if (report.paid.length) throw new PaidFolderError(report.paid);", to: "  void report;" }],
  },
  {
    name: "g-build ignores paid sibling",
    file: "src/lib/crawl.ts",
    test: "stops before building when a paid edition",
    edits: [{ from: "  if (paid.length) throw new PaidFolderError(paid);", to: "  void paid;" }],
  },
  {
    name: "g-build without aliases",
    file: "src/lib/crawl.ts",
    test: "takes the shipped name from a shortcut",
    edits: [{ from: "  const deckName = canonicalDeckName(cleanFrom(deck.name));", to: "  const deckName = cleanFrom(deck.name);" }],
  },
  {
    name: "g-shortcut target not parsed",
    file: "src/lib/crawl.ts",
    test: "keeps a shortcut's own id",
    edits: [{ from: "      if (target && target !== id) entry.targetId = target;\n", to: "" }],
  },
  {
    name: "g-crawl lists the shortcut itself",
    file: "src/lib/crawl.ts",
    test: "builds each deck from the shortcut",
    edits: [{ from: "      children.push(await crawl(listId(entry), entry.name, list, seen));", to: "      children.push(await crawl(entry.id, entry.name, list, seen));" }],
  },
  {
    name: "p-list asks for parents",
    file: "src/lib/drive.ts",
    test: "has no parents field",
    edits: [{ from: "files(id,name,mimeType,shortcutDetails)", to: "files(id,name,mimeType,shortcutDetails,parents)" }],
  },
  {
    name: "p-meta asks for parents",
    file: "src/lib/drive.ts",
    test: "unlocking from a pasted link",
    edits: [{ from: "fields=id,name,mimeType,shortcutDetails&", to: "fields=id,name,mimeType,shortcutDetails,parents&" }],
  },
  {
    name: "u-free paste lists paid child",
    file: "src/lib/drive.ts",
    test: "yields Standard only",
    edits: [{ from: "        if (!partialFoilPaste && !deluxePaste && isPaidEditionName(file.name)) continue;\n", to: "" }],
  },
  {
    name: "u-free paste opens paid shortcut target",
    file: "src/lib/drive.ts",
    test: "yields Standard only from a deck folder",
    edits: [{ from: "    if (depth > 0 && !partialFoilPaste && !deluxePaste && isPaidEditionName(folderName)) return null;\n", to: "" }],
  },
  {
    name: "u-pasted shortcut not followed",
    file: "src/lib/drive.ts",
    test: "follows a pasted shortcut to a paid folder",
    edits: [{ from: "    if (own.mimeType === SHORTCUT) {", to: "    if (false && own.mimeType === SHORTCUT) {" }],
  },
  {
    name: "u-every paste is a paid paste",
    file: "src/lib/drive.ts",
    test: "yields Standard only",
    edits: [{ from: "      if (kind === \"deluxe\") deluxePaste = true;", to: "      deluxePaste = true;" }],
  },
  {
    name: "a-alias lookup reads the prototype",
    file: "src/data/deck-aliases.ts",
    test: "maps every alias",
    edits: [{ from: "  return Object.hasOwn(DECK_ALIASES, key) ? DECK_ALIASES[key]!.name : name;", to: "  return (DECK_ALIASES as Record<string, { name: string }>)[key]?.name ?? name;" }],
  },
  {
    name: "a-p5 alias gone",
    file: "src/data/deck-aliases.ts",
    test: "gives every shipped deck's editions",
    edits: [{ from: "  p5: { id: \"persona-5\", name: \"Persona 5\" },\n", to: "" }],
  },
  {
    name: "a-app splash keyed by raw id",
    file: "src/App.tsx",
    test: "pasted P5 or Spy x Family",
    edits: [{ from: "const splashDeck = canonicalDeckId(deckId)", to: "const splashDeck = deckId" }],
  },
  {
    name: "r-missing decks not reported",
    file: "scripts/check-public-root.ts",
    test: "names every shipped deck missing",
    edits: [{ from: "  for (const item of shipped) if (!found.has(item.id)) problems.push(`${item.name}: no entry in the public root`);\n", to: "" }],
  },
  {
    name: "r-unreadable not a problem",
    file: "scripts/check-public-root.ts",
    test: "reports unreadable folders",
    edits: [{ from: "  for (const item of report.unreadable) problems.push(`can't list: ${item}`);\n", to: "" }],
  },
  {
    name: "r-entry match without aliases",
    file: "scripts/check-public-root.ts",
    test: "matches a root entry",
    edits: [{ from: "normalizeKey(canonicalDeckName(cleanDeckName(name)))", to: "normalizeKey(cleanDeckName(name))" }],
  },
  {
    name: "r-no retries",
    file: "scripts/public-root.ts",
    test: "lists with retries",
    edits: [{ from: "attempt < 3", to: "attempt < 1" }],
  },
  {
    name: "r-error names the id",
    file: "scripts/public-root.ts",
    test: "lists with retries",
    edits: [{ from: "`Drive folder listing failed (${response.status}). The folder may be Restricted.`", to: "`Drive folder listing failed (${response.status}) for ${id}. The folder may be Restricted.`" }],
  },
  {
    name: "i-private env ignored",
    file: "src/lib/public-ids.ts",
    test: "reads the private list",
    edits: [{ from: "env.BEELINE_PRIVATE_IDS || path.join(root, PRIVATE_IDS_FILE)", to: "path.join(root, PRIVATE_IDS_FILE)" }],
  },
  {
    name: "i-private raw id kept unhashed",
    file: "src/lib/public-ids.ts",
    test: "reads the private list",
    edits: [{ from: "hashes.add(/^[0-9a-f]{64}$/i.test(line) ? line.toLowerCase() : sha256(line));", to: "hashes.add(line.toLowerCase());" }],
  },
  {
    name: "lz-any Host answered",
    file: "local/serve_beeline.py",
    test: "answers only to its own address",
    edits: [{ from: "        if self.headers.get(\"Host\", \"\").lower() not in ALLOWED_HOSTS:", to: "        if False:" }],
  },
  {
    name: "lz-folder listings back",
    file: "local/serve_beeline.py",
    test: "answers only to its own address",
    edits: [{ from: "    def list_directory(self, path):\n        self.send_error(404, \"File not found\")\n        return None\n\n", to: "" }],
  },
  {
    name: "lz-traversal check off",
    file: "local/serve_beeline.py",
    test: "answers only to its own address",
    edits: [{ from: "        if not inside(self.directory, self.translate_path(self.path)):", to: "        if False:" }],
  },
  {
    name: "lz-header on every file",
    file: "local/serve_beeline.py",
    test: "local build",
    edits: [{ from: "        if inside(os.path.join(self.directory, \"splash\"), self.translate_path(self.path)):", to: "        if True:" }],
  },
  {
    name: "lz-header by path prefix",
    file: "local/serve_beeline.py",
    test: "answers only to its own address",
    edits: [{ from: "        if inside(os.path.join(self.directory, \"splash\"), self.translate_path(self.path)):", to: "        if self.path.startswith(\"/splash/\"):" }],
  },
  {
    name: "lz-inside by prefix only",
    file: "local/serve_beeline.py",
    test: "answers only to its own address",
    edits: [{ from: "    return target == root or target.startswith(root + os.sep)", to: "    return target.startswith(os.path.dirname(root))" }],
  },
  {
    name: "sp-player back on the allow-list",
    file: "scripts/splash-files.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "export const SPLASH_SHARED = [\n", to: "export const SPLASH_SHARED = [\n  \"splash-player.js\",\n" }],
  },
  {
    name: "sp-player line checked",
    file: "scripts/copy-splash.ts",
    test: "allow-lists Frame Lab",
    edits: [{ from: "    if (SPLASH_NOT_SHIPPED.includes(file)) problems.push(`${file}: not shipped, but in the manifest`);\n    else if", to: "    if" }],
  },
  {
    name: "sp-css url exception added",
    file: "scripts/splash-files.ts",
    test: "resolves every url()",
    edits: [{ from: "export const SPLASH_CSS_UNSHIPPED_URLS: readonly string[] = [];", to: "export const SPLASH_CSS_UNSHIPPED_URLS: readonly string[] = [\"fonts/vt323.woff2\"];" }],
  },
  {
    name: "v34-al unknown names walked",
    file: "src/lib/crawl.ts",
    test: "refuses a folder name that isn't on the list",
    edits: [{ from: "    return names.every(hasName) && allowed.has(names.join(\" / \")) ? null : \"unknown\";", to: "    return null;" }],
  },
  {
    name: "v34-al dlx not paid",
    file: "src/lib/group.ts",
    test: "fails on \u201cDLX Edition\u201d",
    edits: [{ from: "const PAID_WORDS = /foil|delux|dlx|pf|premium/;", to: "const PAID_WORDS = /foil|delux|pf|premium/;" }],
  },
  {
    name: "v34-al pf not paid",
    file: "src/lib/group.ts",
    test: "fails on \u201cPF Edition\u201d",
    edits: [{ from: "const PAID_WORDS = /foil|delux|dlx|pf|premium/;", to: "const PAID_WORDS = /foil|delux|dlx|premium/;" }],
  },
  {
    name: "v34-al foil not paid",
    file: "src/lib/group.ts",
    test: "fails on \u201cPartial Foil Templates\u201d",
    edits: [{ from: "const PAID_WORDS = /foil|delux|dlx|pf|premium/;", to: "const PAID_WORDS = /delux|dlx|pf|premium/;" }],
  },
  {
    name: "v34-al delux not paid",
    file: "src/lib/group.ts",
    test: "fails on \u201cDeluxe PSD\u201d",
    edits: [{ from: "const PAID_WORDS = /foil|delux|dlx|pf|premium/;", to: "const PAID_WORDS = /foil|dlx|pf|premium/;" }],
  },
  {
    name: "v34-al premium not paid",
    file: "src/lib/group.ts",
    test: "reads every disguised paid name as paid",
    edits: [{ from: "const PAID_WORDS = /foil|delux|dlx|pf|premium/;", to: "const PAID_WORDS = /foil|delux|dlx|pf/;" }],
  },
  {
    name: "v34-al non-ASCII letters allowed",
    file: "src/lib/group.ts",
    test: "reads every disguised paid name as paid",
    edits: [{ from: "  for (const char of name) if (char.charCodeAt(0) > 0x7f && /\\p{L}/u.test(char)) return true;\n", to: "" }],
  },
  {
    name: "v34-al separators kept",
    file: "src/lib/group.ts",
    test: "reads every disguised paid name as paid",
    edits: [{ from: " || PAID_WORDS.test(lower.replace(/[^a-z0-9]+/g, \"\"))", to: "" }],
  },
  {
    name: "v34-al case-sensitive",
    file: "src/lib/group.ts",
    test: "fails on \u201cDLX Edition\u201d",
    edits: [{ from: "  const lower = name.normalize(\"NFKC\").toLowerCase();", to: "  const lower = name.normalize(\"NFKC\");" }],
  },
  {
    name: "v34-al shortcut name checked after listing",
    file: "src/lib/crawl.ts",
    test: "checks a shortcut's own title before listing its target",
    edits: [{ from: "    const refused = refusal(here);", to: "    const refused = entry.shortcut ? null : refusal(here);" }],
  },
  {
    name: "v34-al unknown target title walked",
    file: "src/lib/crawl.ts",
    test: "checks a shortcut's own title before listing its target",
    edits: [{ from: "    const refusedTitle = title === entry.name ? null : refusal([...trail, title]);", to: "    const refusedTitle = title !== entry.name && paidEditionName(title) ? \"paid\" : null;" }],
  },
  {
    name: "v34-al unknown root entry counted as deck",
    file: "src/lib/crawl.ts",
    test: "names every shipped deck missing from the root",
    edits: [{ from: "    const deck = refusal([entry.name]) ? null : {", to: "    const deck = paidEditionName(entry.name) ? null : {" }],
  },
  {
    name: "v34-al assert ignores unknown",
    file: "src/lib/crawl.ts",
    test: "refuses a folder name that isn't on the list",
    edits: [{ from: "...report.unknown.map((item) => `not on the public folder allow-list: ${item}`), ", to: "" }],
  },
  {
    name: "v34-al assert ignores unreadable",
    file: "src/lib/crawl.ts",
    test: "build-catalogue stops on a paid folder",
    edits: [{ from: ", ...report.unreadable.map((item) => `can't list: ${item}`)", to: "" }],
  },
  {
    name: "v34-al build-catalogue skips the assert",
    file: "scripts/build-catalogue.ts",
    test: "build-catalogue stops on a paid folder",
    edits: [{ from: "  assertPublicTreeFree(report);\n  return report;", to: "  return report;" }],
  },
  {
    name: "v34-al build-catalogue default list empty",
    file: "scripts/build-catalogue.ts",
    test: "build-catalogue stops on a paid folder",
    edits: [{ from: "allowed: ReadonlySet<string> = PUBLIC_FOLDER_PATHS", to: "allowed: ReadonlySet<string> = new Set<string>()" }],
  },
  {
    name: "v34-al check-public-root drops unknown",
    file: "scripts/check-public-root.ts",
    test: "names every shipped deck missing from the root",
    edits: [{ from: "  for (const item of report.unknown) problems.push(`not on the public folder allow-list: ${item}`);\n", to: "" }],
  },
  {
    name: "v34-al crawl skips by edition kind only",
    file: "src/lib/crawl.ts",
    test: "never crawls a folder inside Standard named like a paid edition",
    edits: [{ from: "function paidEditionName(name: string): boolean {\n  return looksLikePaidName(name);", to: "function paidEditionName(name: string): boolean {\n  const kind = productEditionKind(name);\n  return kind === \"deluxe\" || kind === \"partial_foil\";" }],
  },
  {
    name: "v34-al allow-list gains a paid name",
    file: "scripts/public-folder-paths.ts",
    test: "keeps the allow-list to plain public name paths",
    edits: [{ from: "export const PUBLIC_FOLDER_PATHS: ReadonlySet<string> = new Set([", to: "export const PUBLIC_FOLDER_PATHS: ReadonlySet<string> = new Set([\n  \"6_SxF / DLX Edition\"," }],
  },
  {
    name: "v34-in card-facts plain lookup",
    file: "src/lib/card-facts.ts",
    test: "treats a card named",
    edits: [{ from: "    const entry = own(lookup, normalizeKey(query));", to: "    const entry = lookup[normalizeKey(query)];" }],
  },
  {
    name: "v34-in tokens plain lookup",
    file: "src/lib/tokens.ts",
    test: "treats a card named",
    edits: [{ from: "    const entry = own(lookup, normalizeKey(query));", to: "    const entry = lookup[normalizeKey(query)];" }],
  },
  {
    name: "v34-in decklist plain header lookup",
    file: "src/lib/decklist.ts",
    test: "in a decklist as an ordinary line",
    edits: [{ from: "    const named = own(SECTION_HEADERS, header);", to: "    const named = SECTION_HEADERS[header];" }],
  },
  {
    name: "v34-in filter plain color lookup",
    file: "src/lib/card-filter.ts",
    test: "in the search box as a name",
    edits: [{ from: "  const words = own(COLOR_WORDS, v);", to: "  const words = COLOR_WORDS[v];" }],
  },
  {
    name: "v34-in filter plain rarity lookup",
    file: "src/lib/card-filter.ts",
    test: "in the search box as a name",
    edits: [{ from: "  return own(RARITY_LETTERS, v) ?? null;", to: "  return RARITY_LETTERS[v] ?? null;" }],
  },
  {
    name: "v34-in own reads the prototype",
    file: "src/lib/own.ts",
    test: "own\\(\\) answers only",
    edits: [{ from: "  return Object.hasOwn(record, key) ? record[key] : undefined;", to: "  return record[key];" }],
  },
  {
    name: "v34-mf player line kept",
    file: "scripts/copy-splash.ts",
    test: "checks against a derived 39-line manifest",
    edits: [{ from: "    .filter((line) => !SPLASH_NOT_SHIPPED.some(", to: "    .filter((line) => true || !SPLASH_NOT_SHIPPED.some(" }],
  },
  {
    name: "v34-mf drift not reported",
    file: "scripts/copy-splash.ts",
    test: "checks against a derived 39-line manifest",
    edits: [{ from: "  return shippedText === shippedManifestText(finalText) ? [] :", to: "  return true ? [] :" }],
  },
  {
    name: "v34-mf --check skips the drift",
    file: "scripts/copy-splash.ts",
    test: "checks against a derived 39-line manifest",
    edits: [{ from: "    ...(texts ? manifestProblems(texts.final, texts.shipped) : []),\n", to: "" }],
  },
  {
    name: "v34-de every 403 blames the key",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "  if (error.reasons.some((reason) => KEY_REASON.test(reason)) ||", to: "  if (status === 403 || error.reasons.some((reason) => KEY_REASON.test(reason)) ||" }],
  },
  {
    name: "v34-de key reasons ignored",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "const KEY_REASON = /^(?:API_KEY_[A-Z_]+|keyInvalid|", to: "const KEY_REASON = /^(?:keyInvalid|" }],
  },
  {
    name: "v34-de keyInvalid ignored",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "const KEY_REASON = /^(?:API_KEY_[A-Z_]+|keyInvalid|", to: "const KEY_REASON = /^(?:API_KEY_[A-Z_]+|" }],
  },
  {
    name: "v34-de key message text ignored",
    file: "src/lib/drive.ts",
    test: "and the key from its message alone",
    edits: [{ from: " || /API key not valid|API key expired/i.test(error.message)) {", to: ") {" }],
  },
  {
    name: "v34-de not-shared reasons ignored",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "const NOT_SHARED_REASON = /^(?:insufficientFilePermissions|notFound)$/;", to: "const NOT_SHARED_REASON = /^$/;" }],
  },
  {
    name: "v34-de not-shared text ignored",
    file: "src/lib/drive.ts",
    test: "knows 'does not have sufficient permissions'",
    edits: [{ from: "const NOT_SHARED_TEXT = /does not have sufficient permissions|file not found/i;", to: "const NOT_SHARED_TEXT = /^$/;" }],
  },
  {
    name: "v34-de 404 not read as not shared",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "    status === 404 ||\n", to: "" }],
  },
  {
    name: "v34-de pasted root named generically",
    file: "src/lib/drive.ts",
    test: "asks for the edition folder's link",
    edits: [{ from: "  if (notShared && item.kind === \"pasted\" && !item.name) return PASTED_UNREADABLE;\n", to: "" }],
  },
  {
    name: "v34-de 401 no longer the key",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "  if (status === 401) {\n    return \"Google Drive refused the API key.", to: "  if (status === 401 && false) {\n    return \"Google Drive refused the API key." }],
  },
  {
    name: "v34-de 403 refusal reason dropped",
    file: "src/lib/drive.ts",
    test: "below the root and for the pasted link",
    edits: [{ from: "    const why = error.reasons[0] && /^[A-Za-z_]{1,60}$/.test(error.reasons[0]) ? ` (${error.reasons[0]})` : \"\";", to: "    const why = \"\";" }],
  },
  {
    name: "v34-de details reasons ignored",
    file: "src/lib/drive.ts",
    test: "collects reasons from errors",
    edits: [{ from: "  for (const list of [record.errors, record.details]) {", to: "  for (const list of [record.errors]) {" }],
  },
  {
    name: "v34-de ids not blanked",
    file: "src/lib/drive.ts",
    test: "keeps quota and other errors as before",
    edits: [{ from: "  return text.replace(/[A-Za-z0-9_-]{25,}/g, \"\u2026\");", to: "  return text;" }],
  },
  {
    name: "v34-de reasons not kept on the error",
    file: "src/lib/drive.ts",
    test: "blames the key only for a key reason",
    edits: [{ from: "driveFailure(response.status, body, item), parseDriveError(body).reasons);", to: "driveFailure(response.status, body, item), []);" }],
  },
  {
    name: "v34-de subfolder named as the paste",
    file: "src/lib/drive.ts",
    test: "is named, inside a pasted Deluxe folder",
    edits: [{ from: ": { kind: \"subfolder\", name: file.name }, mask || maskFolder, maskFolder);", to: ": PASTED, mask || maskFolder, maskFolder);" }],
  },
  {
    name: "v34-de shortcut child named as subfolder",
    file: "src/lib/drive.ts",
    test: "is named by the shortcut",
    edits: [{ from: "file.shortcutDetails?.targetId ? { kind: \"shortcut\", name: file.name } :", to: "false ? { kind: \"shortcut\", name: file.name } :" }],
  },
  {
    name: "v34-de pasted shortcut item lost",
    file: "src/lib/drive.ts",
    test: "a pasted shortcut whose target answers",
    edits: [{ from: "insidePdfMap, true, { kind: \"shortcut\", name: own.name || fallbackName }, mask, maskRoot);", to: "insidePdfMap, true, item, mask, maskRoot);" }],
  },
  {
    name: "v34-de listing ignores the read name",
    file: "src/lib/drive.ts",
    test: "names the folder by its own name when its metadata reads",
    edits: [{ from: "    const files = await listChildren(id, apiKey, fetchImpl, here);", to: "    const files = await listChildren(id, apiKey, fetchImpl, item);" }],
  },
  {
    name: "v34-de New Drive Link hop named as the paste",
    file: "src/lib/drive.ts",
    test: "names a New Drive Link.txt hop",
    edits: [{ from: "insidePdfMap, true, { kind: \"linked\", from: folderName }, mask, maskRoot);", to: "insidePdfMap, true, PASTED, mask, maskRoot);" }],
  },
  {
    name: "v34-tok new Eggman extra missing from the token lookup",
    file: "src/data/token-lookup.ts",
    test: "covers every extra and token name in the shipped decks",
    edits: [{ from: "  \"cryptothrall\": {\"query\":\"Cryptothrall\",\"token\":false,\"scryfall\":\"Cryptothrall\",\"layout\":\"normal\",\"typeLine\":\"Artifact Creature \u2014 Construct\"},\n", to: "" }],
  },
  {
    name: "v35-rc checksum unchecked",
    file: "src/lib/restore-code.ts",
    test: "fails with a clear message for empty, foreign, newer",
    edits: [{ from: "  if (sha256Hex(json).slice(0, 8) !== check) throw", to: "  if (false && sha256Hex(json).slice(0, 8) !== check) throw" }],
  },
  {
    name: "v35-rc wrapped code not unwrapped",
    file: "src/lib/restore-code.ts",
    test: "ignores spaces and line breaks",
    edits: [{ from: "const text = input.replace(/\\s+/g, \"\");", to: "const text = input.trim();" }],
  },
  {
    name: "v35-rc newer code called foreign",
    file: "src/lib/restore-code.ts",
    test: "fails with a clear message for empty, foreign, newer",
    edits: [{ from: "  if (Number(head[1]) > RESTORE_VERSION) throw new RestoreCodeError(RESTORE_ERRORS.newer);\n", to: "" }],
  },
  {
    name: "v35-rc older version accepted",
    file: "src/lib/restore-code.ts",
    test: "fails with a clear message for empty, foreign, newer",
    edits: [{ from: "  if (Number(head[1]) !== RESTORE_VERSION) throw new RestoreCodeError(RESTORE_ERRORS.notCode);\n", to: "" }],
  },
  {
    name: "v35-rc empty paste not named",
    file: "src/lib/restore-code.ts",
    test: "fails with a clear message for empty, foreign, newer",
    edits: [{ from: "  if (!text) throw new RestoreCodeError(RESTORE_ERRORS.empty);\n", to: "" }],
  },
  {
    name: "v35-rc payload kind unchecked",
    file: "src/lib/restore-code.ts",
    test: "checks the payload, not just the checksum",
    edits: [{ from: "record.kind !== KIND || ", to: "" }],
  },
  {
    name: "v35-rc no valid pack accepted",
    file: "src/lib/restore-code.ts",
    test: "checks the payload, not just the checksum",
    edits: [{ from: "  if (!packs.length) throw new RestoreCodeError(RESTORE_ERRORS.noPacks);\n", to: "" }],
  },
  {
    name: "v35-rc folder id in the code",
    file: "src/lib/restore-code.ts",
    test: "never carries a folder id",
    edits: [{ from: "packs: stored })", to: "packs })" }],
  },
  {
    name: "v35-rc never compressed",
    file: "src/lib/restore-code.ts",
    test: "compresses: the code is much shorter",
    edits: [{ from: "const compress = (options?.compress ?? true) && canCompress();", to: "const compress = false && canCompress();" }],
  },
  {
    name: "v35-rc empty code made",
    file: "src/lib/restore-code.ts",
    test: "has nothing to make when nothing is unlocked",
    edits: [{ from: "  if (!packs.length) throw new RestoreCodeError(RESTORE_ERRORS.nothing);\n", to: "" }],
  },
  {
    name: "v35-rc merge counts every pack as new",
    file: "src/lib/restore-code.ts",
    test: "merges into the unlocks already here",
    edits: [{ from: "    if (existing) refreshed += 1;\n    else added += 1;", to: "    added += 1;" }],
  },
  {
    name: "v35-rc message ignores nothing new",
    file: "src/lib/restore-code.ts",
    test: "says what changed",
    edits: [{ from: "  if (!added) return `Your restore code matched", to: "  if (added < 0) return `Your restore code matched" }],
  },
  {
    name: "v35-ls Continue record ignored",
    file: "src/lib/storage.ts",
    test: "keeps the deck being built with its counts",
    edits: [{ from: "  if (last) return last;\n", to: "" }],
  },
  {
    name: "v35-ls oldest save offered",
    file: "src/lib/storage.ts",
    test: "falls back to the newest saved deck",
    edits: [{ from: "deck.updatedAt > newest.updatedAt", to: "deck.updatedAt < newest.updatedAt" }],
  },
  {
    name: "v35-ls no fallback to saves",
    file: "src/lib/storage.ts",
    test: "falls back to the newest saved deck",
    edits: [{ from: "  for (const deck of saved) if (!newest || deck.updatedAt > newest.updatedAt) newest = deck;\n  return newest;", to: "  for (const deck of saved) if (!newest || deck.updatedAt > newest.updatedAt) newest = deck;\n  return null;" }],
  },
  {
    name: "v35-ls full storage throws",
    file: "src/lib/storage.ts",
    test: "never throws when storage is full or blocked",
    edits: [{ from: "export function writeLastSession(store: Store, deck: SavedDeck) {\n  try {", to: "export function writeLastSession(store: Store, deck: SavedDeck) {\n  store.setItem(LAST_SESSION_KEY, JSON.stringify(deck));\n  try {" }],
  },
  {
    name: "v35-app deck being built not kept",
    file: "src/App.tsx",
    test: "survives a reload and reopens the deck",
    edits: [{ from: "    writeLastSession(localStorage, session);\n", to: "" }],
  },
  {
    name: "v35-app tour preview kept for Continue",
    file: "src/App.tsx",
    test: "opens a deck as an unsaved preview",
    edits: [{ from: "    if (!session || touring) return;\n    writeLastSession", to: "    if (!session) return;\n    writeLastSession" }],
  },
  {
    name: "v35-app Continue record not read",
    file: "src/App.tsx",
    test: "survives a reload and reopens the deck",
    edits: [{ from: "        setLastVisit(loadLastSession(localStorage, savedDecks));\n", to: "" }],
  },
  {
    name: "v35-app last visit wins over this visit",
    file: "src/App.tsx",
    test: "offers the deck opened on this visit",
    edits: [{ from: "const resumeDeck = session ?? lastVisit;", to: "const resumeDeck = lastVisit ?? session;" }],
  },
  {
    name: "v35-app Continue opens a deck it can't find",
    file: "src/App.tsx",
    test: "says why when the deck's paid folder",
    edits: [{ from: "            const found = locate(resumeDeck);\n            if (!(\"edition\" in found)) {\n              setError(found.note);\n              return;\n            }\n", to: "            const found = locate(resumeDeck);\n            if (!(\"edition\" in found)) {\n              setView(\"builder\");\n              return;\n            }\n" }],
  },
  {
    name: "v35-app restore not stored",
    file: "src/App.tsx",
    test: "restores on another device",
    edits: [{ from: "            writeUnlocked(localStorage, result.packs);\n            setUnlocked(result.packs);", to: "            setUnlocked(result.packs);" }],
  },
  {
    name: "v35-app restore replaces the unlocks here",
    file: "src/App.tsx",
    test: "restores on another device",
    edits: [{ from: "const result = mergeRestored(unlocked, incoming);", to: "const result = mergeRestored([], incoming);" }],
  },
  {
    name: "v35-hv Partial Foil notice blank",
    file: "src/components/HomeView.tsx",
    test: "says a Partial Foil link also unlocks",
    edits: [{ from: "<span>{PARTIAL_FOIL_NOTICE}</span>", to: "<span></span>" }],
  },
  {
    name: "v35-hv restore code not offered",
    file: "src/components/HomeView.tsx",
    test: "is offered only once something is unlocked",
    edits: [{ from: "{onMakeRestoreCode && onRestoreCode && <RestoreCode", to: "{false && onMakeRestoreCode && onRestoreCode && <RestoreCode" }],
  },
  {
    name: "v35-uh shown while in view",
    file: "src/components/UnlockHere.tsx",
    test: "shows only while the unlock section is out of view",
    edits: [{ from: "  if (hidden || place === \"in-view\") return null;", to: "  if (hidden) return null;" }],
  },
  {
    name: "v35-uh shown under the tour",
    file: "src/components/UnlockHere.tsx",
    test: "while the tour is open",
    edits: [{ from: "  if (hidden || place === \"in-view\") return null;", to: "  if (place === \"in-view\") return null;" }],
  },
  {
    name: "v35-uh arrows always down",
    file: "src/components/UnlockHere.tsx",
    test: "shows only while the unlock section is out of view",
    edits: [{ from: "const Arrow = place === \"above\" ? ChevronsUp : ChevronsDown;", to: "const Arrow = ChevronsDown;" }],
  },
  {
    name: "v35-uh smooth under reduced motion",
    file: "src/components/UnlockHere.tsx",
    test: "jumps instantly under reduced motion",
    edits: [{ from: "target.current?.scrollIntoView({ behavior: reduced ? \"auto\" : \"smooth\", block: \"start\" });", to: "target.current?.scrollIntoView({ behavior: \"smooth\", block: \"start\" });" }],
  },
  {
    name: "v35-uh focus stays on the button",
    file: "src/components/UnlockHere.tsx",
    test: "scrolls smoothly to the section and moves focus",
    edits: [{ from: "        focusTarget?.current?.focus({ preventScroll: true });\n", to: "" }],
  },
  {
    name: "v35-uh no destination in the name",
    file: "src/components/UnlockHere.tsx",
    test: "has an accessible name that starts with its label",
    edits: [{ from: "      <span className=\"sr-only\">: go to Unlock a paid deck</span>\n", to: "" }],
  },
  {
    name: "v35-uh on top of Back to top",
    file: "src/components/UnlockHere.tsx",
    test: "sits bottom centre",
    edits: [{ from: "left-1/2 z-40 -translate-x-1/2", to: "right-6 z-40" }],
  },
  {
    name: "v35-uh not observed",
    file: "src/components/UnlockHere.tsx",
    test: "shows only while the unlock section is out of view",
    edits: [{ from: "    observer.observe(node);\n", to: "" }],
  },
  {
    name: "v35-up edge counts as above",
    file: "src/lib/unlock-place.ts",
    test: "reads where the section is from the observer entry",
    edits: [{ from: "return entry.boundingClientRect.top >= viewTop ? \"below\" : \"above\";", to: "return entry.boundingClientRect.top > viewTop ? \"below\" : \"above\";" }],
  },
  {
    name: "v35-up root offset ignored",
    file: "src/lib/unlock-place.ts",
    test: "reads where the section is from the observer entry",
    edits: [{ from: "const viewTop = entry.rootBounds ? entry.rootBounds.top : 0;", to: "const viewTop = 0;" }],
  },
  {
    name: "v35-rcui code shown in clear",
    file: "src/components/RestoreCode.tsx",
    test: "shows the code masked until Reveal",
    edits: [{ from: "className={`h-10 flex-1 font-mono text-xs ${revealed ? \"\" : \"beeline-masked\"}`}", to: "className=\"h-10 flex-1 font-mono text-xs\"" }],
  },
  {
    name: "v35-rcui Reveal state not announced",
    file: "src/components/RestoreCode.tsx",
    test: "shows the code masked until Reveal",
    edits: [{ from: "aria-pressed={revealed} ", to: "" }],
  },
  {
    name: "v35-rcui Copy copies nothing",
    file: "src/components/RestoreCode.tsx",
    test: "shows the code masked until Reveal",
    edits: [{ from: "clip.writeText(code).then(", to: "clip.writeText(\"\").then(" }],
  },
  {
    name: "v35-rcui stale code kept",
    file: "src/components/RestoreCode.tsx",
    test: "drops a shown code when the unlocks change",
    edits: [{ from: "made && made.key === unlockedKey ? made.code : null", to: "made ? made.code : null" }],
  },
  {
    name: "v35-rcui restore error swallowed",
    file: "src/components/RestoreCode.tsx",
    test: "fails with a clear message and changes nothing",
    edits: [{ from: "(caught: unknown) => setRestoreError(caught instanceof Error ? caught.message : \"Couldn't read that restore code.\"),", to: "() => undefined," }],
  },
  {
    name: "v35-rcui pasted code left in the box",
    file: "src/components/RestoreCode.tsx",
    test: "restores on another device",
    edits: [{ from: "                setPasted(\"\");\n", to: "" }],
  },
  {
    name: "v35-rcui paste box in clear",
    file: "src/components/RestoreCode.tsx",
    test: "restores on another device",
    edits: [{ from: "className=\"beeline-masked h-10 flex-1 font-mono text-xs\"", to: "className=\"h-10 flex-1 font-mono text-xs\"" }],
  },
  {
    name: "v35-rcui code offered with nothing unlocked",
    file: "src/components/RestoreCode.tsx",
    test: "is offered only once something is unlocked",
    edits: [{ from: "            disabled={unlockedCount === 0}\n", to: "" }],
  },
  {
    name: "v35-rcui no public-posting warning",
    file: "src/components/RestoreCode.tsx",
    test: "is offered only once something is unlocked",
    edits: [{ from: " Don't post it publicly or send it to anyone.", to: "" }],
  },
  {
    name: "v35-rcui copy blocked unexplained",
    file: "src/components/RestoreCode.tsx",
    test: "explains when the browser blocks copying",
    edits: [{ from: "() => setStatus(\"Copy was blocked. Reveal the code, select all of it, and copy it yourself.\"),", to: "() => undefined," }],
  },
  {
    name: "v35-bb flight on the webp size",
    file: "src/components/BeeLineBanner.tsx",
    test: "measures the bee's flight on the original meridian size",
    edits: [{ from: "containBox(relative(back.getBoundingClientRect(), bannerRect), MERIDIAN_ART)", to: "containBox(relative(back.getBoundingClientRect(), bannerRect), { width: back.naturalWidth, height: back.naturalHeight })" }],
  },
  {
    name: "v35-fl measuring box resized",
    file: "src/lib/flight.ts",
    test: "measures the bee's flight on the original meridian size",
    edits: [{ from: "export const MERIDIAN_ART = { width: 437, height: 673 } as const;", to: "export const MERIDIAN_ART = { width: 292, height: 450 } as const;" }],
  },
  {
    name: "v35-bb gloss never starts",
    file: "src/components/BeeLineBanner.tsx",
    test: "sweeps the gloss once like the splash",
    edits: [{ from: "        back.parentElement?.setAttribute(\"data-gloss\", \"play\");\n", to: "" }],
  },
  {
    name: "v35-bb gloss under reduced motion",
    file: "src/components/BeeLineBanner.tsx",
    test: "sweeps the gloss once like the splash",
    edits: [{ from: "      if (prefersReducedMotion()) land();\n      else {", to: "      back.parentElement?.setAttribute(\"data-gloss\", \"play\");\n      if (prefersReducedMotion()) land();\n      else {" }],
  },
  {
    name: "v35-css gloss sweeps under reduced motion",
    file: "src/index.css",
    test: "sweeps the gloss once like the splash",
    edits: [{ from: "  .beeline-banner .emblem-shine::before { animation: none; }", to: "  .beeline-banner .emblem-shine::before { }" }],
  },
  {
    name: "v35-css gloss over the bee",
    file: "src/index.css",
    test: "layers the card back, the bee, the card front",
    edits: [{ from: ".beeline-banner .emblem-shine {\n  position: absolute;\n  z-index: 3;", to: ".beeline-banner .emblem-shine {\n  position: absolute;\n  z-index: 5;" }],
  },
  {
    name: "v35-bb old png art",
    file: "src/components/BeeLineBanner.tsx",
    test: "puts the slot left of the wordmark",
    edits: [{ from: "src={publicUrl(\"brand/meridian-front.webp\")}", to: "src={publicUrl(\"brand/meridian-front.png\")}" }],
  },
  {
    name: "v35-bb gloss layer missing",
    file: "src/components/BeeLineBanner.tsx",
    test: "puts the slot left of the wordmark",
    edits: [{ from: "          <div className=\"emblem-shine\" />\n", to: "" }],
  },
  {
    name: "v35-al name allowed anywhere",
    file: "src/lib/crawl.ts",
    test: "refuses an allowed name in the wrong place",
    edits: [{ from: "allowed.has(names.join(\" / \"))", to: "[...allowed].some((item) => item.split(\" / \").at(-1) === names.at(-1))" }],
  },
  {
    name: "v35-al shortcuts followed at any depth",
    file: "src/lib/crawl.ts",
    test: "refuses an allowed name in the wrong place",
    edits: [{ from: "    if (entry.shortcut && (here.length > 2 || inShortcut)) {", to: "    if (false) {" }],
  },
  {
    name: "v35-al shortcut depth off by one",
    file: "src/lib/crawl.ts",
    test: "follows a shortcut only at deck level",
    edits: [{ from: "here.length > 2 || inShortcut", to: "here.length > 3 || inShortcut" }],
  },
  {
    name: "v35-al shortcut inside a shortcut followed",
    file: "src/lib/crawl.ts",
    test: "follows a shortcut only at deck level",
    edits: [{ from: "here.length > 2 || inShortcut", to: "here.length > 2" }],
  },
  {
    name: "v35-al shortcut not carried down",
    file: "src/lib/crawl.ts",
    test: "follows a shortcut only at deck level",
    edits: [{ from: "inShortcut || Boolean(entry.shortcut)", to: "inShortcut" }],
  },
  {
    name: "v35-al empty title falls back to the name",
    file: "src/lib/crawl.ts",
    test: "refuses an empty or missing listing title",
    edits: [{ from: "    const title = listing.title;\n", to: "    const title = listing.title || entry.name;\n" }],
  },
  {
    name: "v35-al blank title passes",
    file: "src/lib/crawl.ts",
    test: "refuses an empty or missing listing title",
    edits: [{ from: "return typeof name === \"string\" && name.trim() !== \"\";", to: "return typeof name === \"string\" && name !== \"\";" }],
  },
  {
    name: "v35-al nameless folder not named",
    file: "src/lib/crawl.ts",
    test: "refuses a folder with no name",
    edits: [{ from: "    if (!hasName(entry.name)) {\n      report.unknown.push(`${shown(trail)} / (folder with no name)`);\n      return;\n    }\n", to: "" }],
  },
  {
    name: "v35-al untitled root walked",
    file: "src/lib/crawl.ts",
    test: "refuses a folder with no name",
    edits: [{ from: "  if (!hasName(root.title)) {", to: "  if (false) {" }],
  },
  {
    name: "v35-al target title checked as a bare name",
    file: "src/lib/crawl.ts",
    test: "refuses the deck parent reached through an allowed shortcut path",
    edits: [{ from: "refusal([...trail, title])", to: "refusal([title])" }],
  },
  {
    name: "v35-dr free paste by edition kind only",
    file: "src/lib/drive.ts",
    test: "a free paste never opens a folder with a disguised paid name",
    edits: [{ from: "function isPaidEditionName(name: string): boolean {\n  return looksLikePaidName(name);", to: "function isPaidEditionName(name: string): boolean {\n  const kind = productEditionKind(name);\n  return kind === \"deluxe\" || kind === \"partial_foil\";" }],
  },
  // v0.1.36: foil maps (A), restore-code limits and no rollback (B1, B2), no password input (B3),
  // footer padding (B5) and the harness's own verdicts (B4).
  {
    name: "v36-fm apostrophe underscore kept",
    file: "src/lib/foil-maps.ts",
    test: "matches across the apostrophe underscore",
    edits: [
      { from: ".replace(/[’‘'_]/g, \"'\")", to: ".replace(/[’‘']/g, \"'\")" },
    ],
  },
  {
    name: "v36-fm no NFC",
    file: "src/lib/foil-maps.ts",
    test: "matches across the apostrophe underscore",
    edits: [
      { from: "name.normalize(\"NFC\").trim()", to: "name.trim()" },
    ],
  },
  {
    name: "v36-fm case kept",
    file: "src/lib/foil-maps.ts",
    test: "matches across the apostrophe underscore",
    edits: [
      { from: "const words = stem.toLowerCase()", to: "const words = stem" },
    ],
  },
  {
    name: "v36-fm outer spaces kept",
    file: "src/lib/foil-maps.ts",
    test: "matches across the apostrophe underscore",
    edits: [
      { from: ".replace(/\\.[a-z0-9]{2,4}$/i, \"\").trim();", to: ".replace(/\\.[a-z0-9]{2,4}$/i, \"\");" },
      { from: ".replace(/\\s+/g, \" \").trim();\n  return face + words;", to: ".replace(/\\s+/g, \" \");\n  return face + words;" },
    ],
  },
  {
    name: "v36-fm face dropped",
    file: "src/lib/foil-maps.ts",
    test: "matches across the apostrophe underscore",
    edits: [
      { from: "face = `${prefix[1]}_${prefix[2]} `;", to: "face = \"\";" },
    ],
  },
  {
    name: "v36-fm face dropped pairs",
    file: "src/lib/foil-maps.ts",
    test: "but never guesses between two",
    edits: [
      { from: "face = `${prefix[1]}_${prefix[2]} `;", to: "face = \"\";" },
    ],
  },
  {
    name: "v36-fm own group ignored",
    file: "src/lib/foil-maps.ts",
    test: "pairs each print file with its mask by name",
    edits: [
      { from: "const pool = own.length ? own : list;", to: "const pool = list;" },
    ],
  },
  {
    name: "v36-fm guesses between two",
    file: "src/lib/foil-maps.ts",
    test: "but never guesses between two",
    edits: [
      { from: "    if (unique && pool.length !== 1) return undefined;\n", to: "" },
    ],
  },
  {
    name: "v36-fm name fallbacks off",
    file: "src/lib/foil-maps.ts",
    test: "but never guesses between two",
    edits: [
      { from: "            byCardPick(artParts, manyArts, group) ??\n            (artParts.face ? undefined : byCardPick(asName(face.name), manyArts, group)) ??\n            (card.faces.length === 1 && index === 0 ? byCardPick(asName(card.name), manyArts, group) : undefined);", to: "            undefined;\n          void asName;\n          void index;" },
    ],
  },
  {
    name: "v36-fm mask becomes thumbnail",
    file: "src/lib/foil-maps.ts",
    test: "never turns a mask into a card",
    edits: [
      { from: "return { ...plain, maskId: mask.id };", to: "return { ...plain, maskId: mask.id, thumbId: mask.id };" },
    ],
  },
  {
    name: "v36-fm mask folder kept in tree",
    file: "src/lib/group.ts",
    test: "never turns a mask into a card",
    edits: [
      { from: "  const { tree, masks } = splitFoilMasks(root);", to: "  const { masks } = splitFoilMasks(root);\n  const tree = { ...root, maskScan: undefined };" },
    ],
  },
  {
    name: "v36-fm mask folder kept in split",
    file: "src/lib/foil-maps.ts",
    test: "takes the mask folder out of the tree",
    edits: [
      { from: "      if (child.folder && child.masks) collect(child, \"main\");\n      else children.push", to: "      if (child.folder && child.masks) { collect(child, \"main\"); children.push(child); }\n      else children.push" },
    ],
  },
  {
    name: "v36-fm maskScan path off",
    file: "src/lib/group.ts",
    test: "pairs each print file with its mask by name",
    edits: [
      { from: "  if (!root.maskScan) return catalogueFromPlainTree", to: "  if (true) return catalogueFromPlainTree" },
    ],
  },
  {
    name: "v36-fm Standard gets maps",
    file: "src/lib/foil-maps.ts",
    test: "but never guesses between two",
    edits: [
      { from: "    if (edition.printType !== \"partial_foil\") return edition;\n    let found", to: "    let found" },
    ],
  },
  {
    name: "v36-fm non-images are masks",
    file: "src/lib/foil-maps.ts",
    test: "takes the mask folder out of the tree",
    edits: [
      { from: "} else if (MASK_IMAGE.test(child.name)) {", to: "} else if (child.name) {" },
    ],
  },
  {
    name: "v36-fm Tokens folder not a group",
    file: "src/lib/foil-maps.ts",
    test: "takes the mask folder out of the tree",
    edits: [
      { from: "plain.includes(\"token\") ? \"tokens\"", to: "plain.includes(\"tokenzz\") ? \"tokens\"" },
    ],
  },
  {
    name: "v36-fm unmatched still counted found",
    file: "src/lib/foil-maps.ts",
    test: "leaves a card with no mask on its own art",
    edits: [
      { from: "          if (!mask) return plain;\n          found += 1;", to: "          found += 1;\n          if (!mask) return plain;" },
    ],
  },
  {
    name: "v36-fm folder name takes the PDF map",
    file: "src/lib/foil-maps.ts",
    test: "knows the mask folder from the PDF print map",
    edits: [
      { from: " && !plain.includes(\"pdf\");", to: ";" },
    ],
  },
  {
    name: "v36-drive mask folder skipped",
    file: "src/lib/drive.ts",
    test: "lists the mask folder of a Partial Foil paste for masks only",
    edits: [
      { from: "const maskFolder = partialFoilPaste && !mask && isFoilMaskFolder(file.name, pdfMap);", to: "const maskFolder = false;" },
    ],
  },
  {
    name: "v36-drive masks not marked",
    file: "src/lib/drive.ts",
    test: "lists the mask folder of a Partial Foil paste for masks only",
    edits: [
      { from: "    if (maskRoot && item.kind !== \"file\") node.masks = true;\n", to: "" },
    ],
  },
  {
    name: "v36-drive no maskScan",
    file: "src/lib/drive.ts",
    test: "lists the mask folder of a Partial Foil paste for masks only",
    edits: [
      { from: "return partialFoilPaste ? { ...tree, maskScan: true } : tree;", to: "return tree;" },
    ],
  },
  {
    name: "v36-drive Standard folders opened",
    file: "src/lib/drive.ts",
    test: "lists the mask folder of a Partial Foil paste for masks only",
    edits: [
      { from: "if (partialFoilPaste && !maskFolder && skipOnPartialFoilCrawl(file.name, pdfMap)) continue;", to: "if (partialFoilPaste && !maskFolder && false) continue;" },
    ],
  },
  {
    name: "v36-view no swap",
    file: "src/lib/foil-maps.ts",
    test: "swaps only thumbnails to masks",
    edits: [
      { from: "art.maskId ? { ...art, thumbId: art.maskId }", to: "art.maskId ? { ...art }" },
    ],
  },
  {
    name: "v36-view swaps the export id",
    file: "src/lib/foil-maps.ts",
    test: "swaps only thumbnails to masks",
    edits: [
      { from: "art.maskId ? { ...art, thumbId: art.maskId }", to: "art.maskId ? { ...art, id: art.maskId, thumbId: art.maskId }" },
    ],
  },
  {
    name: "v36-view no tag",
    file: "src/lib/foil-maps.ts",
    test: "swaps only thumbnails to masks",
    edits: [
      { from: ": { ...art, noFoilMap: true });", to: ": { ...art });" },
    ],
  },
  {
    name: "v36-can show Standard",
    file: "src/lib/foil-maps.ts",
    test: "shows only on an unlocked Partial Foil edition",
    edits: [
      { from: "return edition.printType === \"partial_foil\" && edition.origin === \"unlocked\";", to: "return edition.origin === \"unlocked\";" },
    ],
  },
  {
    name: "v36-can show shipped",
    file: "src/lib/foil-maps.ts",
    test: "shows only on an unlocked Partial Foil edition",
    edits: [
      { from: "return edition.printType === \"partial_foil\" && edition.origin === \"unlocked\";", to: "return edition.printType === \"partial_foil\";" },
    ],
  },
  {
    name: "v36-view old unlock swapped",
    file: "src/lib/foil-maps.ts",
    test: "leaves other editions, and an old unlock",
    edits: [
      { from: "if (!canShowFoil(edition) || foilMapsMissing(edition)) return edition;", to: "if (!canShowFoil(edition)) return edition;" },
    ],
  },
  {
    name: "v36-session never read",
    file: "src/lib/foil-maps.ts",
    test: "remembers the switch for the session, and treats",
    edits: [
      { from: "return store?.getItem(FOIL_SESSION_KEY) === \"1\";", to: "return store?.getItem(FOIL_SESSION_KEY) === \"true\";" },
    ],
  },
  {
    name: "v36-session write throws",
    file: "src/lib/foil-maps.ts",
    test: "remembers the switch for the session, and treats",
    edits: [
      { from: "  try {\n    if (on) store?.setItem(FOIL_SESSION_KEY, \"1\");\n    else store?.removeItem(FOIL_SESSION_KEY);\n  } catch {\n    // Not remembered; the switch still works for this view.\n  }", to: "  if (on) store?.setItem(FOIL_SESSION_KEY, \"1\");\n  else store?.removeItem(FOIL_SESSION_KEY);" },
    ],
  },
  {
    name: "v36-storage foilMaps dropped",
    file: "src/lib/storage.ts",
    test: "keeps mask ids in the stored pack",
    edits: [
      { from: "    ...(edition.printType === \"partial_foil\" && isFoilMapCount(edition.foilMaps) ? { foilMaps: { found: edition.foilMaps.found, total: edition.foilMaps.total } } : {}),\n", to: "" },
    ],
  },
  {
    name: "v36-storage bad count kept",
    file: "src/lib/storage.ts",
    test: "keeps mask ids in the stored pack",
    edits: [
      { from: "(count.found as number) <= (count.total as number)", to: "true" },
    ],
  },
  {
    name: "v36-ui switch on every edition",
    file: "src/components/BuilderView.tsx",
    test: "appears only on an unlocked Partial Foil edition",
    edits: [
      { from: "{foilable && (\n          <div className=\"grid gap-1 self-end text-sm\" data-foil-switch=\"\">", to: "{(true) && (\n          <div className=\"grid gap-1 self-end text-sm\" data-foil-switch=\"\">" },
    ],
  },
  {
    name: "v36-ui aria-checked stuck",
    file: "src/components/BuilderView.tsx",
    test: "is an accessible switch",
    edits: [
      { from: "aria-checked={foilOn}", to: "aria-checked={false}" },
    ],
  },
  {
    name: "v36-ui not a switch role",
    file: "src/components/BuilderView.tsx",
    test: "is an accessible switch",
    edits: [
      { from: "role=\"switch\"", to: "role=\"button\"" },
    ],
  },
  {
    name: "v36-ui describedby while off",
    file: "src/components/BuilderView.tsx",
    test: "shows the caption only while on",
    edits: [
      { from: "aria-describedby={foilOn ? foilCaptionId : undefined}", to: "aria-describedby={foilCaptionId}" },
    ],
  },
  {
    name: "v36-ui caption while off",
    file: "src/components/BuilderView.tsx",
    test: "shows the caption only while on",
    edits: [
      { from: "{foilOn ? (\n              <p id={foilCaptionId}", to: "{true ? (\n              <p id={foilCaptionId}" },
    ],
  },
  {
    name: "v36-ui caption not linked",
    file: "src/components/BuilderView.tsx",
    test: "shows the caption only while on",
    edits: [
      { from: "<p id={foilCaptionId} data-foil-caption=\"\"", to: "<p data-foil-caption=\"\"" },
    ],
  },
  {
    name: "v36-ui view not used",
    file: "src/components/BuilderView.tsx",
    test: "swaps thumbnails to the masks and back",
    edits: [
      { from: "useMemo(() => (foilOn ? foilView(baseEdition) : baseEdition), [foilOn, baseEdition]);", to: "useMemo(() => baseEdition, [baseEdition]);" },
    ],
  },
  {
    name: "v36-ui view not used flyout",
    file: "src/components/BuilderView.tsx",
    test: "puts the mask in the desktop hover flyout",
    edits: [
      { from: "useMemo(() => (foilOn ? foilView(baseEdition) : baseEdition), [foilOn, baseEdition]);", to: "useMemo(() => baseEdition, [baseEdition]);" },
    ],
  },
  {
    name: "v36-ui view not used picker",
    file: "src/components/BuilderView.tsx",
    test: "a tapped card's art picker follows the switch",
    edits: [
      { from: "useMemo(() => (foilOn ? foilView(baseEdition) : baseEdition), [foilOn, baseEdition]);", to: "useMemo(() => baseEdition, [baseEdition]);" },
    ],
  },
  {
    name: "v36-ui picker uses the base edition",
    file: "src/components/BuilderView.tsx",
    test: "a tapped card's art picker follows the switch",
    edits: [
      { from: "<CardThumb id={art.thumbId} alt={art.label} tag={art.noFoilMap ? NO_FOIL_MAP : undefined} />", to: "<CardThumb id={baseEdition.cards.flatMap((c) => c.faces).flatMap((f) => [f.defaultArt, ...f.alternates]).find((a) => a?.id === art.id)?.thumbId} alt={art.label} />" },
    ],
  },
  {
    name: "v36-ui switch not remembered",
    file: "src/components/BuilderView.tsx",
    test: "remembers the switch for the session across",
    edits: [
      { from: "                  writeShowFoil(sessionStore(), !foilOn);\n", to: "" },
    ],
  },
  {
    name: "v36-ui row tag missing",
    file: "src/components/BuilderView.tsx",
    test: "swaps thumbnails to the masks and back",
    edits: [
      { from: "<CardThumb id={art?.thumbId} alt={card.name} tag={art?.noFoilMap ? NO_FOIL_MAP : undefined} />", to: "<CardThumb id={art?.thumbId} alt={card.name} />" },
    ],
  },
  {
    name: "v36-ui missing note hidden",
    file: "src/components/BuilderView.tsx",
    test: "tells the user in one line",
    edits: [
      { from: "{foilMissing ? <span", to: "{false ? <span" },
    ],
  },
  {
    name: "v36-thumb tag not drawn",
    file: "src/components/thumbs.tsx",
    test: "swaps thumbnails to the masks and back",
    edits: [
      { from: "      {tag ? (\n        <span data-thumb-tag=\"\"", to: "      {false ? (\n        <span data-thumb-tag=\"\"" },
    ],
  },
  {
    name: "v36-rc no inflate cap",
    file: "src/lib/restore-code.ts",
    test: "refuses a deflate bomb",
    edits: [
      { from: "await pipe(bytes, new DecompressionStream(\"deflate-raw\"), MAX_JSON_BYTES)", to: "await pipe(bytes, new DecompressionStream(\"deflate-raw\"))" },
    ],
  },
  {
    name: "v36-rc inflate cap loose",
    file: "src/lib/restore-code.ts",
    test: "stops just past the inflate limit",
    edits: [
      { from: "    if (total > limit) {", to: "    if (total > limit + 1024) {" },
    ],
  },
  {
    name: "v36-rc no length cap",
    file: "src/lib/restore-code.ts",
    test: "refuses a pasted code over the length limit",
    edits: [
      { from: "  if (text.length > MAX_CODE_CHARS) throw new RestoreCodeError(TOO_BIG);\n", to: "" },
    ],
  },
  {
    name: "v36-rc no raw length cap",
    file: "src/lib/restore-code.ts",
    test: "refuses a pasted code over the length limit",
    edits: [
      { from: "  if (input.length > MAX_CODE_CHARS * 2) throw new RestoreCodeError(TOO_BIG);\n", to: "" },
    ],
  },
  {
    name: "v36-rc restore replaces any",
    file: "src/lib/restore-code.ts",
    test: "keeps the catalogue here when the code's copy is older",
    edits: [
      { from: "if (existing && catalogueStamp(pack) <= catalogueStamp(existing)) {", to: "if (false) {" },
    ],
  },
  {
    name: "v36-rc same age replaces",
    file: "src/lib/restore-code.ts",
    test: "keeps the catalogue here when the code's copy is older",
    edits: [
      { from: "catalogueStamp(pack) <= catalogueStamp(existing)", to: "catalogueStamp(pack) < catalogueStamp(existing)" },
    ],
  },
  {
    name: "v36-rc newer kept",
    file: "src/lib/restore-code.ts",
    test: "replaces it when the code's copy was read later",
    edits: [
      { from: "if (existing && catalogueStamp(pack) <= catalogueStamp(existing)) {", to: "if (existing) {" },
    ],
  },
  {
    name: "v36-rc older code drops packs",
    file: "src/lib/restore-code.ts",
    test: "an older code that lacks some folders",
    edits: [
      { from: "      kept += 1;\n      continue;", to: "      kept += 1;\n      packs = packs.filter((item) => item !== existing);\n      continue;" },
    ],
  },
  {
    name: "v36-st stamp ignores refreshedAt",
    file: "src/lib/storage.ts",
    test: "falls back to the first unlock time",
    edits: [
      { from: "Date.parse(pack.refreshedAt || pack.savedAt)", to: "Date.parse(pack.savedAt)" },
    ],
  },
  {
    name: "v36-st refreshedAt not stored",
    file: "src/lib/storage.ts",
    test: "carries the refresh time through storage",
    edits: [
      { from: "  if (pack.refreshedAt) stored.refreshedAt = pack.refreshedAt;\n", to: "" },
    ],
  },
  {
    name: "v36-st refreshedAt not parsed",
    file: "src/lib/storage.ts",
    test: "carries the refresh time through storage",
    edits: [
      { from: "    ...(typeof pack.refreshedAt === \"string\" && Number.isFinite(Date.parse(pack.refreshedAt)) ? { refreshedAt: pack.refreshedAt } : {}),\n", to: "" },
    ],
  },
  {
    name: "v36-st paste not stamped",
    file: "src/lib/storage.ts",
    test: "carries the refresh time through storage",
    edits: [
      { from: "refreshedAt: pack.refreshedAt || pack.savedAt };", to: "refreshedAt: pack.refreshedAt };" },
    ],
  },
  {
    name: "v36-app kept not told",
    file: "src/App.tsx",
    test: "restores on another device",
    edits: [
      { from: "restoredMessage(result.added, result.refreshed, result.kept, result.empty)", to: "restoredMessage(result.added, result.refreshed, 0, result.empty)" },
    ],
  },
  {
    name: "v36-rs paste is a password",
    file: "src/components/RestoreCode.tsx",
    test: "never uses a password input",
    edits: [
      { from: "            {...NOT_A_PASSWORD}\n            value={pasted}", to: "            {...NOT_A_PASSWORD}\n            type=\"password\"\n            value={pasted}" },
    ],
  },
  {
    name: "v36-rs output is a password",
    file: "src/components/RestoreCode.tsx",
    test: "never uses a password input",
    edits: [
      { from: "              {...NOT_A_PASSWORD}\n              readOnly", to: "              {...NOT_A_PASSWORD}\n              type={revealed ? \"text\" : \"password\"}\n              readOnly" },
    ],
  },
  {
    name: "v36-rs paste unmasked",
    file: "src/components/RestoreCode.tsx",
    test: "never uses a password input",
    edits: [
      { from: "className=\"beeline-masked h-10 flex-1 font-mono text-xs\"", to: "className=\"h-10 flex-1 font-mono text-xs\"" },
    ],
  },
  {
    name: "v36-rs manager hints off",
    file: "src/components/RestoreCode.tsx",
    test: "never uses a password input",
    edits: [
      { from: "  \"data-lpignore\": \"true\",\n", to: "" },
    ],
  },
  {
    name: "v36-css no text-security",
    file: "src/index.css",
    test: "never uses a password input",
    edits: [
      { from: ".beeline-masked {\n  -webkit-text-security: disc;\n  text-security: disc;\n}", to: ".beeline-masked {\n}" },
    ],
  },
  {
    name: "v36-css no fallback",
    file: "src/index.css",
    test: "never uses a password input",
    edits: [
      { from: "    color: transparent;\n    text-shadow: 0 0 0.45em var(--foreground);", to: "    text-shadow: 0 0 0.45em var(--foreground);" },
    ],
  },
  {
    name: "v36-footer old padding",
    file: "src/components/HomeView.tsx",
    test: "pads the footer by the floating button",
    edits: [
      { from: "<footer className=\"home-footer text-xs", to: "<footer className=\"pb-6 text-xs" },
    ],
  },
  {
    name: "v36-css footer misses button height",
    file: "src/index.css",
    test: "pads the footer by the floating button",
    edits: [
      { from: "calc(var(--unlock-here-bottom) + var(--unlock-here-height) + var(--unlock-here-gap))", to: "calc(var(--unlock-here-bottom) + var(--unlock-here-gap))" },
    ],
  },
  {
    name: "v36-css button taller than padded",
    file: "src/index.css",
    test: "pads the footer by the floating button",
    edits: [
      { from: "  --unlock-here-height: 2.75rem;", to: "  --unlock-here-height: 2.75rem;\n  --unlock-here-gap-unused: 0;" },
      { from: ".unlock-here { bottom: var(--unlock-here-bottom); height: var(--unlock-here-height); }", to: ".unlock-here { bottom: var(--unlock-here-bottom); height: 4rem; }" },
    ],
  },
  {
    name: "v36-uh own bottom",
    file: "src/components/UnlockHere.tsx",
    test: "pads the footer by the floating button",
    edits: [
      { from: "className=\"unlock-here fixed left-1/2", to: "className=\"unlock-here fixed bottom-4 left-1/2" },
    ],
  },
  {
    name: "v36-mv load failure is a kill",
    file: "scripts/mutate-verdict.ts",
    test: "does not count a file that failed to load",
    edits: [
      { from: "  if (brokenFiles.length || (report.numFailedTestSuites ?? 0) > 0) {\n    return { kind: \"invalid\"", to: "  if (brokenFiles.length || (report.numFailedTestSuites ?? 0) > 0) {\n    return { kind: \"killed\"" },
    ],
  },
  {
    name: "v36-mv failure count trusted",
    file: "scripts/mutate-verdict.ts",
    test: "does not count a filter that matched nothing",
    edits: [
      { from: "if ((report.numFailedTests ?? 0) > 0 && failedTests.length > 0) {", to: "if ((report.numFailedTests ?? 0) > 0) {" },
    ],
  },
  {
    name: "v36-mv no-match survives",
    file: "scripts/mutate-verdict.ts",
    test: "does not count a filter that matched nothing",
    edits: [
      { from: "  if (passedTests.length === 0) return { kind: \"invalid\", detail: [\"the test filter matched no test\"] };\n", to: "" },
    ],
  },
  {
    name: "v36-mv any failure kills",
    file: "scripts/mutate-verdict.ts",
    test: "counts a kill only when a test ran and failed",
    edits: [
      { from: "  if ((report.numFailedTests ?? 0) > 0 && failedTests.length > 0) {\n    return { kind: \"killed\", detail: [`Tests ${failedTests.length} failed`", to: "  if ((report.numFailedTests ?? 0) > 0 && failedTests.length > 0) {\n    return { kind: \"killed\", detail: [`Tests ${report.numFailedTests} failed!`" },
    ],
  },
  // v0.1.37: restore-code limits and make-side checks (1), future stamps and empty deck lists (2),
  // variant and art number in mask pairing (3), the mask folder decided by its listed name (4).
  {
    name: "v37-rc paste limit back to 256 KB",
    file: "src/lib/restore-code.ts",
    test: "every shipped deck unlocked as Partial Foil makes a code",
    edits: [
      { from: "export const MAX_CODE_CHARS = 1024 * 1024;", to: "export const MAX_CODE_CHARS = 256 * 1024;" },
    ],
  },
  {
    name: "v37-rc paste limit 4 MB",
    file: "src/lib/restore-code.ts",
    test: "uses 1 MB pasted and 8 MB unpacked",
    edits: [
      { from: "export const MAX_CODE_CHARS = 1024 * 1024;", to: "export const MAX_CODE_CHARS = 4 * 1024 * 1024;" },
    ],
  },
  {
    name: "v37-rc inflate limit back to 2 MB",
    file: "src/lib/restore-code.ts",
    test: "uses 1 MB pasted and 8 MB unpacked",
    edits: [
      { from: "export const MAX_JSON_BYTES = 8 * 1024 * 1024;", to: "export const MAX_JSON_BYTES = 2 * 1024 * 1024;" },
    ],
  },
  {
    name: "v37-rc inflate limit 32 MB",
    file: "src/lib/restore-code.ts",
    test: "uses 1 MB pasted and 8 MB unpacked",
    edits: [
      { from: "export const MAX_JSON_BYTES = 8 * 1024 * 1024;", to: "export const MAX_JSON_BYTES = 32 * 1024 * 1024;" },
    ],
  },
  {
    name: "v37-rc make skips the code size check",
    file: "src/lib/restore-code.ts",
    test: "refuses to make a code a restore would refuse",
    edits: [
      { from: "  if (code.length > MAX_CODE_CHARS) throw new RestoreCodeError(codeTooBigMessage(code.length));\n", to: "" },
    ],
  },
  {
    name: "v37-rc make skips the unpacked size check",
    file: "src/lib/restore-code.ts",
    test: "refuses to make a code a restore would refuse",
    edits: [
      { from: "  if (raw.length > MAX_JSON_BYTES) throw new RestoreCodeError(codeTooBigMessage(raw.length, MAX_JSON_BYTES));\n", to: "" },
    ],
  },
  {
    name: "v37-rc make never reads its code back",
    file: "src/lib/restore-code.ts",
    test: "refuses to show a code that doesn't read back",
    edits: [
      { from: "  let back: UnlockedPack[];\n  try {\n    back = await readRestoreCode(code);\n  } catch {\n    throw new RestoreCodeError(CODE_CHECK_FAILED);\n  }\n  if (JSON.stringify(back.map(packForStorage)) !== JSON.stringify(stored)) throw new RestoreCodeError(CODE_CHECK_FAILED);\n", to: "" },
    ],
  },
  {
    name: "v37-rc make returns a code that failed to read",
    file: "src/lib/restore-code.ts",
    test: "refuses to show a code that doesn't read back",
    edits: [
      { from: "  } catch {\n    throw new RestoreCodeError(CODE_CHECK_FAILED);\n  }\n  if (JSON.stringify(back.map(packForStorage))", to: "  } catch {\n    return code;\n  }\n  if (JSON.stringify(back.map(packForStorage))" },
    ],
  },
  {
    name: "v37-rc code carries in-memory fields",
    file: "src/lib/restore-code.ts",
    test: "every shipped deck unlocked as Partial Foil makes a code",
    edits: [
      { from: "const json = JSON.stringify({ kind: KIND, version: RESTORE_VERSION, packs: stored });", to: "const json = JSON.stringify({ kind: KIND, version: RESTORE_VERSION, packs: packs.map(packForStorage) });" },
    ],
  },
  {
    name: "v37-rc message names the wrong limit",
    file: "src/lib/restore-code.ts",
    test: "refuses to make a code a restore would refuse",
    edits: [
      { from: "export function codeTooBigMessage(size: number, limit = MAX_CODE_CHARS): string {", to: "export function codeTooBigMessage(size: number, limit = MAX_JSON_BYTES): string {" },
    ],
  },
  {
    name: "v37-rc message size rounded down",
    file: "src/lib/restore-code.ts",
    test: "refuses to make a code a restore would refuse",
    edits: [
      { from: "const kb = (n: number) => Math.ceil(n / 1024).toLocaleString(\"en-US\");", to: "const kb = (n: number) => String(Math.floor(n / 1024 / 1024));" },
    ],
  },
  {
    name: "v37-ui make problem not an alert",
    file: "src/components/RestoreCode.tsx",
    test: "warns and shows no code when the unlocks here are too many",
    edits: [
      { from: "<p role=\"alert\" className=\"mt-2 flex max-w-2xl items-start gap-2 rounded-xl border border-destructive/50", to: "<p role=\"status\" className=\"mt-2 flex max-w-2xl items-start gap-2 rounded-xl border border-destructive/50" },
    ],
  },
  {
    name: "v37-ui make problem hidden",
    file: "src/components/RestoreCode.tsx",
    test: "warns and shows no code when the unlocks here are too many",
    edits: [
      { from: "      {problem && (\n", to: "      {false && (\n" },
    ],
  },
  {
    name: "v37-rc future stamps not capped",
    file: "src/lib/restore-code.ts",
    test: "counts a stamp later than this device's clock plus a day",
    edits: [
      { from: "  if (!ahead(pack.refreshedAt) && !ahead(pack.savedAt)) return pack;", to: "  return pack;" },
    ],
  },
  {
    name: "v37-rc cap a week ahead",
    file: "src/lib/restore-code.ts",
    test: "counts a stamp later than this device's clock plus a day",
    edits: [
      { from: "export const MAX_STAMP_AHEAD_MS = 24 * 60 * 60 * 1000;", to: "export const MAX_STAMP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;" },
    ],
  },
  {
    name: "v37-rc cap at now (no skew allowed)",
    file: "src/lib/restore-code.ts",
    test: "counts a stamp later than this device's clock plus a day",
    edits: [
      { from: "  const latest = now + MAX_STAMP_AHEAD_MS;", to: "  const latest = now;" },
    ],
  },
  {
    name: "v37-rc first unlock time not capped",
    file: "src/lib/restore-code.ts",
    test: "counts a stamp later than this device's clock plus a day",
    edits: [
      { from: "savedAt: ahead(pack.savedAt) ? cap : pack.savedAt", to: "savedAt: pack.savedAt" },
    ],
  },
  {
    name: "v37-rc merge ignores the given clock",
    file: "src/lib/restore-code.ts",
    test: "counts a stamp later than this device's clock plus a day",
    edits: [
      { from: "    const pack = capStamps(given, now);", to: "    const pack = capStamps(given, Date.now());" },
    ],
  },
  {
    name: "v37-rc empty deck list replaces",
    file: "src/lib/restore-code.ts",
    test: "never lets a deck list with no cards replace one here",
    edits: [
      { from: "    if (existing && cardCount(pack) === 0) {\n      empty += 1;\n      continue;\n    }\n", to: "" },
    ],
  },
  {
    name: "v37-rc empty checked before the stamp counts as kept",
    file: "src/lib/restore-code.ts",
    test: "never lets a deck list with no cards replace one here",
    edits: [
      { from: "    if (existing && cardCount(pack) === 0) {\n      empty += 1;", to: "    if (existing && cardCount(pack) === 0) {\n      kept += 1;" },
    ],
  },
  {
    name: "v37-msg empty note missing",
    file: "src/lib/restore-code.ts",
    test: "never lets a deck list with no cards replace one here",
    edits: [
      { from: "  const notes = keptNote + emptyNote;", to: "  const notes = keptNote;" },
    ],
  },
  {
    name: "v37-msg empty not counted as matched",
    file: "src/lib/restore-code.ts",
    test: "never lets a deck list with no cards replace one here",
    edits: [
      { from: "return `Your restore code matched ${folders(kept + empty)} already on this device.${notes}`;", to: "return `Your restore code matched ${folders(kept)} already on this device.${notes}`;" },
    ],
  },
  {
    name: "v37-fm variants ignored",
    file: "src/lib/foil-maps.ts",
    test: "never gives a print another variant's mask",
    edits: [
      { from: "  if (target.variant && mask.variant && target.variant !== mask.variant) return false;\n", to: "" },
    ],
  },
  {
    name: "v37-fm variant needed on both sides",
    file: "src/lib/foil-maps.ts",
    test: "never gives a print another variant's mask",
    edits: [
      { from: "  if (target.variant && mask.variant && target.variant !== mask.variant) return false;", to: "  if (target.variant !== mask.variant) return false;" },
    ],
  },
  {
    name: "v37-fm variant spacing not normalised",
    file: "src/lib/foil-maps.ts",
    test: "never gives a print another variant's mask",
    edits: [
      { from: ".map((match) => match[1]!.replace(/\\s+/g, \" \").trim())", to: ".map((match) => match[1]!)" },
    ],
  },
  {
    name: "v37-fm art number ignored",
    file: "src/lib/foil-maps.ts",
    test: "keeps the art number when a card has more than one art",
    edits: [
      { from: "  if (manyArts && (target.art ?? \"1\") !== (mask.art ?? \"1\")) return false;\n", to: "" },
    ],
  },
  {
    name: "v37-fm art number checked on one-art cards",
    file: "src/lib/foil-maps.ts",
    test: "keeps the art number when a card has more than one art",
    edits: [
      { from: "  if (manyArts && (target.art ?? \"1\")", to: "  if ((target.art ?? \"1\")" },
    ],
  },
  {
    name: "v37-fm unnumbered is not art 1",
    file: "src/lib/foil-maps.ts",
    test: "keeps the art number when a card has more than one art",
    edits: [
      { from: "(target.art ?? \"1\") !== (mask.art ?? \"1\")", to: "target.art !== mask.art" },
    ],
  },
  {
    name: "v37-fm name fallback drops the art number",
    file: "src/lib/foil-maps.ts",
    test: "keeps the art number when a card has more than one art",
    edits: [
      { from: "return { face: \"\", base: parts.base, variant: artParts.variant ?? parts.variant, art: artParts.art };", to: "return { face: \"\", base: parts.base, variant: artParts.variant ?? parts.variant, art: parts.art };" },
    ],
  },
  {
    name: "v37-fm many arts counted by card",
    file: "src/lib/foil-maps.ts",
    test: "keeps the art number when a card has more than one art",
    edits: [
      { from: "const manyArts = (face.defaultArt ? 1 : 0) + face.alternates.length > 1;", to: "const manyArts = card.faces.length > 1;" },
    ],
  },
  {
    name: "v37-drive target's own name decides again",
    file: "src/lib/drive.ts",
    test: "marks a mask folder by the name it is listed under",
    edits: [
      { from: "    if (maskRoot && item.kind !== \"file\") node.masks = true;", to: "    if (maskRoot && item.kind !== \"file\" && isFoilMaskFolderName(folderName)) node.masks = true;" },
    ],
  },
  {
    name: "v37-drive parent's decision not passed",
    file: "src/lib/drive.ts",
    test: "marks a mask folder by the name it is listed under",
    edits: [
      { from: ": { kind: \"subfolder\", name: file.name }, mask || maskFolder, maskFolder);", to: ": { kind: \"subfolder\", name: file.name }, mask || maskFolder, false);" },
    ],
  },
  {
    name: "v37-drive every folder inside marked",
    file: "src/lib/drive.ts",
    test: "marks a mask folder by the name it is listed under",
    edits: [
      { from: ": { kind: \"subfolder\", name: file.name }, mask || maskFolder, maskFolder);", to: ": { kind: \"subfolder\", name: file.name }, mask || maskFolder, mask || maskFolder);" },
    ],
  },
];

function runTest(test: string): Verdict {
  const out = join(tmpdir(), `beeline-mutate-${process.pid}.json`);
  rmSync(out, { force: true });
  const result = spawnSync("npx", ["vitest", "run", "-t", test, "--reporter=json", `--outputFile=${out}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let report: Report | null = null;
  try {
    if (existsSync(out)) report = JSON.parse(readFileSync(out, "utf8")) as Report;
  } catch {
    report = null;
  } finally {
    rmSync(out, { force: true });
  }
  const verdict = verdictOf(report);
  if (!report) verdict.detail.push(`exit ${result.status}: ${`${result.stderr ?? ""}`.split("\n").filter(Boolean).slice(0, 3).join(" | ").slice(0, 300)}`);
  return verdict;
}

const only = process.env.MUTATE_ONLY ? new RegExp(process.env.MUTATE_ONLY) : null;
const selected = only ? mutations.filter((mutation) => only.test(mutation.name)) : mutations;
const counts = { killed: 0, survived: 0, invalid: 0, missing: 0 };
for (const mutation of selected) {
  const path = `${root}${mutation.file}`;
  const original = readFileSync(path, "utf8");
  let patched = original;
  let missing = false;
  for (const edit of mutation.edits) {
    if (!patched.includes(edit.from)) {
      missing = true;
      console.log(`\n===== ${mutation.name} =====\nPATCH MISSING in ${mutation.file}\n`);
      break;
    }
    patched = patched.replace(edit.from, edit.to);
  }
  if (missing) {
    counts.missing += 1;
    continue;
  }
  writeFileSync(path, patched);
  console.log(`\n===== ${mutation.name} =====`);
  try {
    const verdict = runTest(mutation.test);
    counts[verdict.kind] += 1;
    console.log(verdict.kind === "killed" ? "KILLED" : verdict.kind === "survived" ? "STILL PASSED" : "INVALID (not a kill)");
    console.log(verdict.detail.join("\n"));
  } finally {
    writeFileSync(path, original);
  }
}

console.log(`\n${counts.killed} killed by a failing test, ${counts.survived} still passed, ${counts.invalid} invalid, ${counts.missing} patch missing, ${selected.length} total`);
if (counts.survived || counts.invalid || counts.missing) process.exit(1);
