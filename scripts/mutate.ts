/**
 * Apply each review mutation, run the test that should kill it, and restore the file.
 * A mutation that still passes is a failure of this script.
 *
 *   npx tsx scripts/mutate.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

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
    edits: [{ from: "      else if (!front) front = artId.trim();", to: "      else front = artId.trim();" }],
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
  { name: "v26-flip ends on the back", file: "src/lib/desktop.ts", test: "turns twice and ends on the front", edits: [{ from: 'faces.push(half % 2 === 0 ? "front" : "back")', to: 'faces.push(half % 2 === 0 ? "back" : "front")' }] },
  { name: "v26-dfc back ignored (plan)", file: "src/lib/desktop.ts", test: "shows a double-faced card's own back", edits: [{ from: "backImage: customBack || dfcBack || cardback || null", to: "backImage: customBack || cardback || dfcBack || null" }] },
  { name: "v26-dfc back ignored (tile)", file: "src/components/BuilderView.tsx", test: "uses a double-faced card's own back face", edits: [{ from: "dfcBack: backArt?.thumbId, customBack: customBack?.thumbId, alt: card.name };", to: "dfcBack: null, customBack: customBack?.thumbId, alt: card.name };" }] },
  { name: "v26-reduced motion still flips", file: "src/lib/desktop.ts", test: "does no flips with reduced motion", edits: [{ from: "if (reducedMotion || turns <= 0)", to: "if (turns <= 0)" }] },
  { name: "v26-spin draws no back", file: "src/components/CardFlyout.tsx", test: "spins with the front on both sides", edits: [{ from: "(plan.backImage ?? front)", to: "plan.backImage" }] },
  { name: "v26-flyout over its own row", file: "src/lib/desktop.ts", test: "goes right of the card row", edits: [{ from: "    left = anchor.right + gap;\n    side = \"right\";", to: "    left = anchor.left + gap;\n    side = \"right\";" }] },
  { name: "v26-no left flip", file: "src/lib/desktop.ts", test: "flips to the left near the right edge", edits: [{ from: "} else if (anchor.left - gap - width >= margin) {", to: "} else if (false) {" }] },
  { name: "v26-no horizontal clamp", file: "src/lib/desktop.ts", test: "clamps inside the viewport when neither side fits", edits: [{ from: "    left = clamp(left, margin, viewport.width - margin - width);\n", to: "" }] },
  { name: "v26-no vertical clamp", file: "src/lib/desktop.ts", test: "centres on the row and clamps", edits: [{ from: "const top = clamp(middle - height / 2, margin, viewport.height - margin - height);", to: "const top = middle - height / 2;" }] },
  { name: "v26-size ignores window height", file: "src/lib/desktop.ts", test: "shrinks the card to fit a short window", edits: [{ from: "Math.min(maxWidth, byHeight, byWidth)", to: "Math.min(maxWidth, byWidth)" }] },
  { name: "v26-flyout takes the pointer", file: "src/components/CardFlyout.tsx", test: "never takes the pointer", edits: [{ from: 'className="beeline-flyout pointer-events-none fixed z-[70]"', to: 'className="beeline-flyout fixed z-[70]"' }] },
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
  { name: "v27-flip back to 900ms", file: "src/lib/desktop.ts", test: "is about twice as long as v0.1.26", edits: [{ from: "export const FLYOUT_FLIP_MS = 1800;", to: "export const FLYOUT_FLIP_MS = 900;" }] },
  { name: "v27-whippy v0.1.26 easing", file: "src/lib/desktop.ts", test: "eases in and out with no whip", edits: [{ from: 'FLYOUT_FLIP_EASING = "cubic-bezier(0.45, 0, 0.25, 1)"', to: 'FLYOUT_FLIP_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)"' }] },
  { name: "v27-linear easing", file: "src/lib/desktop.ts", test: "eases in and out with no whip", edits: [{ from: 'FLYOUT_FLIP_EASING = "cubic-bezier(0.45, 0, 0.25, 1)"', to: 'FLYOUT_FLIP_EASING = "linear"' }] },
  { name: "v27-easing overshoots the front", file: "src/lib/desktop.ts", test: "eases in and out with no whip", edits: [{ from: 'FLYOUT_FLIP_EASING = "cubic-bezier(0.45, 0, 0.25, 1)"', to: 'FLYOUT_FLIP_EASING = "cubic-bezier(0.45, 0, 0.25, 1.3)"' }] },
  { name: "v27-smooth check allows a whip", file: "src/lib/desktop.ts", test: "eases in and out with no whip", edits: [{ from: "&& y1 === 0 && y2 === 1;", to: "&& y2 === 1;" }] },
  { name: "v27-smooth check allows linear", file: "src/lib/desktop.ts", test: "eases in and out with no whip", edits: [{ from: "return x1 > 0 && x1 <= 1 && x2 >= 0 && x2 < 1", to: "return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1" }] },
  { name: "v27-grow slower than the flip", file: "src/lib/desktop.ts", test: "is about twice as long as v0.1.26", edits: [{ from: "export const FLYOUT_GROW_MS = 600;", to: "export const FLYOUT_GROW_MS = 2000;" }] },
  { name: "v27-flip timing not applied", file: "src/components/CardFlyout.tsx", test: "takes its flip timing and easing from desktop.ts", edits: [{ from: '    "--flyout-flip-ms": `${FLYOUT_FLIP_MS}ms`,\n', to: "" }] },
  { name: "v27-flip easing not applied", file: "src/components/CardFlyout.tsx", test: "takes its flip timing and easing from desktop.ts", edits: [{ from: '    "--flyout-flip-ease": FLYOUT_FLIP_EASING,\n', to: "" }] },
  { name: "v27-css fallback drifts", file: "src/index.css", test: "keeps the stylesheet fallbacks in step", edits: [{ from: "var(--flyout-flip-ms, 1800ms)", to: "var(--flyout-flip-ms, 900ms)" }] },
  { name: "v27-flip stops between turns", file: "src/index.css", test: "keeps the stylesheet fallbacks in step", edits: [{ from: "  from { transform: rotateY(0deg); }\n", to: "  from { transform: rotateY(0deg); }\n  50% { transform: rotateY(360deg); }\n" }] },
  { name: "v27-fade mode still grows", file: "src/index.css", test: "keeps the stylesheet fallbacks in step", edits: [{ from: '.beeline-flyout[data-flyout-mode="fade"] { animation: beeline-flyout-appear 160ms ease-out both; }\n', to: "" }] },
  { name: "v27-reduced motion still grows", file: "src/index.css", test: "keeps the stylesheet fallbacks in step", edits: [{ from: "  .beeline-flyout,\n  .beeline-flyout[data-flyout-mode] { animation: beeline-flyout-appear 160ms ease-out both; }", to: "  .beeline-flyout { animation-duration: 160ms; }" }] },
  { name: "v27-flyout not keyed per card", file: "src/components/use-card-flyout.tsx", test: "closes at once mid-flip", edits: [{ from: "<FlyoutLayer key={shown.card.key} shown={shown} />", to: "<FlyoutLayer shown={shown} />" }] },
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
      { from: "<CardThumb id={customBack?.thumbId ?? backArt?.thumbId} alt={customBack?.label ?? back.name} />", to: "<CardThumb id={backArt?.thumbId} alt={back.name} />" },
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
    name: "v0.1.28 flyout: own back wins over pick",
    file: "src/lib/desktop.ts",
    test: "flyout with a picked back",
    edits: [
      { from: "const mode: FlipMode = customBack ? \"custom\" : dfcBack ? \"dfc\"", to: "const mode: FlipMode = dfcBack ? \"dfc\" : customBack ? \"custom\"" },
    ],
  },
  {
    name: "v0.1.28 flyout: pick not passed",
    file: "src/components/use-card-flyout.tsx",
    test: "saves a pick, shows it on the tile",
    edits: [
      { from: "flipPlan({ customBack: card.customBack, dfcBack", to: "flipPlan({ dfcBack" },
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
      { from: "    const entry = lookup[normalizeKey(query)];", to: "    const entry = undefined as TokenLookupEntry | undefined;" },
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
    edits: [{ from: "resolveBackOverride(edition, card.id, cardBacks[card.id], tokenTest)", to: "resolveBackOverride(edition, card.id, cardBacks[card.id])" }],
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
    edits: [{ from: "if (COLOR_WORDS[v]) return COLOR_WORDS[v]!;", to: "" }],
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
    edits: [{ from: "!lookup[key] && !listed.has(key)", to: "!lookup[key] && !listed.has(key) && false" }],
  },
  {
    name: "q-card-lookup check allows both",
    file: "scripts/card-lookup.ts",
    test: "passes on the committed lookup, and fails when a name has no entry",
    edits: [{ from: "const both = [...listed].filter((key) => lookup[key]);", to: "const both: string[] = [];" }],
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
];

let failed = 0;
for (const mutation of mutations) {
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
    failed += 1;
    continue;
  }
  writeFileSync(path, patched);
  console.log(`\n===== ${mutation.name} =====`);
  try {
    const out = execSync(`npx vitest run -t ${JSON.stringify(mutation.test)} --reporter=verbose`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    failed += 1;
    console.log("STILL PASSED");
    console.log(out);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    console.log("KILLED");
    console.log(`${err.stdout ?? ""}${err.stderr ?? ""}`);
  } finally {
    writeFileSync(path, original);
  }
}

console.log(`\n${mutations.length - failed} killed, ${failed} still passed, ${mutations.length} total`);
if (failed) process.exit(1);
