# BeeLine Deck Builder

BeeLine (formerly Print-a-Bee) builds [MPCFill](https://mpcfill.com) print-order XML for Beespair's MTG proxy decks. It is a static site: the catalogue, the art picker, and the XML all run in the browser. There is no Python server and no backend.

Standard prints ship with the site. Deluxe and Partial Foil do not. A buyer unlocks those by pasting the Google Drive folder link from their Ko-fi order. The browser lists that folder with the Drive API and stores the result in `localStorage`. Paid file ids and folder ids are never written into this repo.

The XML matches the Art Picker's `build_xml` (`order`, `details`, `fronts`, `backs`, `cardback`) and adds a `printabee` block other tools ignore. The block keeps that name so Leyline's print script keeps reading it:

```xml
<printabee>
    <deck>Silksong</deck>
    <printType>standard</printType>
    <treatment>Standard Holo Rainbow</treatment>
</printabee>
```

`<treatment>` is left out when none is picked. A partial-foil order only contains partial-foil files, and its fronts are the converted PDF ids.

## Run it

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:4178](http://127.0.0.1:4178).

A production folder, the thing you would later put on GitHub Pages, is:

```bash
npm run build
npm run preview
```

`dist/` is static. Asset paths are relative (`base: "./"`), so the same folder works at a domain root, a project-site subpath such as `https://<owner>.github.io/beeline-deck-builder/`, and `http://127.0.0.1:4178`. Nothing in this repo deploys by itself; see [GitHub Pages](#github-pages).

## What's in the box

The home page is a **Make a Deck** banner with two sections:

- **Foil / Non-Foil** lists decks that have standard files (the free Standard editions that shipped, plus a Deluxe edition after it is unlocked). Deluxe is still a normal print, so it stays in this section.
- **Partial Foil** lists only partial-foil files. It is empty until someone unlocks one.

Choosing a deck loads it as designed (one copy of each main-deck card on the art from Full Deck). From there you can:

- swap any card for an alternate art
- add tokens and other extras, with a quantity on every card
- pick the card back
- give one card its own back in the card editor (click the card's art): **Card Back** (one of the deck's card backs), **Alt Back** (any extra that is not a token) or **Token Backs** (a token). It prints on every copy of that card. Without a pick the card uses the deck back, and a double-faced card keeps its own back face. A pick on a double-faced card replaces that face, and the editor says so. In SxF a pick on a Color or Black and White token or extra moves to that card's other file when you switch the print set. A card with a pick shows a small "Back:" label on its tile and the desktop flyout turns to that back; cards without one look as before
- **All cards**, which sets every card in that deck and section to 1 copy
- **Random**, which picks a main-deck or alternate art for each main-deck card. Lock a card and Random leaves it alone
- **Clear all**, which sets every card in the deck to 0: main deck, tokens and extras (locked cards too, the same as pressing − to 0). Per-card back picks stay. While a filter is on, **Clear shown (N)** sits beside it and sets only the N counted cards the filter shows to 0; the cards it hides keep their counts. Both say what they did in a status line with **Undo Clear all** / **Undo Clear shown**, which puts back every count from just before. Any other change ends the Undo
- filter the deck view (see below). The filter only changes what is shown, never a count
- save the deck, keep several, and export each as its own XML
- export or import the saved-deck list as JSON

### The tour

On the first visit BeeLine asks "New to BeeLine? Want a quick tour?" with **Take the tour** and **No thanks**. The answer is stored under `printabee.tour.v1` (`taken` or `declined`), so the question never comes back on its own; Esc counts as No thanks. The **Tour** button in the bottom-left corner replays it any time. Six steps highlight the real controls with a short caption and Back, Next and Skip tour; Esc closes it at any point. The steps: pick a deck; unlock a paid deck with the Drive folder link from the Ko-fi order; click a card's art to swap its front and back (Card Back, Alt Back, Token Backs); the search box (`t:creature c:g mv<=3`); the Filters panel; Clear all and Clear shown. The deck-view steps use the deck being built; with none, the tour opens the first deck as an unsaved preview and closes it again at the end. The tour never changes a count or a saved deck, keeps keyboard focus inside its caption, and gives focus back when it closes. A control that isn't on screen (the phone's Add cards tab is open, say) gets its caption in the middle of the screen instead.

### Filtering the deck view

The search box takes plain words (all must be in the card's name, as before) and Scryfall-style terms; **Filters** opens the same filter as controls, and the controls write the query back into the box. Terms that are not understood are listed under the box and not used.

| Filter | Query | Controls |
| --- | --- | --- |
| name | `sol ring`, `"sol ring"`, `name:signet` | the box |
| color | `c:g`, `c:wu` (all of), `c=wu` (exactly), `c>=wu`, `(c:w or c:u)` (any of), `c:c` colorless, `c:m` multicolor, guild names (`c:izzet`) | W U B R G C Multi chips, any / all / exact |
| card type | `t:creature`, `t:creature t:artifact` (both), `(t:creature or t:instant)`; any other word is matched against the type line (`t:goblin`, `t:"legendary creature"`) | type chips, any / all, Type line contains |
| mana value | `mv=3`, `mv<3`, `mv>3`, `mv<=3`, `mv>=3`, `mv!=3`, a range `mv>=2 mv<=4` (also `cmc`) | = < > ≤ ≥ or range |
| rarity | `r:common`, `r:u`, `(r:rare or r:mythic)`; also special and bonus | rarity chips (any of) |
| rules text | `o:flying`, `o:"draw a card"` | Rules text contains |
| power / toughness | `pow>=3`, `tou<2`, ranges as for mana value | Power, Toughness |
| quick toggles | `qty>0` (or `is:indeck`), `is:dfc`, `is:token` (or `is:extra`), `is:basic` | Show only chips |

Terms are joined with "and"; `or` works inside one kind of term (types, colors, rarities). Parentheses group, nothing more. Color, type, mana value, rarity, rules text, power and toughness come from `src/data/card-lookup.ts`, a one-time cross-reference of every card name in the shipped decks against Scryfall's public API (the app never calls Scryfall; the lookup loads as its own file the first time the deck view opens). A double-faced card has both faces' colors, type lines and rules text, the front's power and toughness, and matches a type on either face. Rarity is that of the printing Scryfall returns for the name. A name Scryfall has no card for is **unmatched**, and a name several different Scryfall cards share (most tokens) is **ambiguous** and keeps only the facts they agree on. While filtering, such cards carry an "unmatched" or "ambiguous" marker; name search and the quick toggles still find them, but a filter on a fact they lack leaves them out, and the line under the box says how many were left out that way. If the card data file can't load (a dropped connection, say), the box says so with a **Try again** link, and those filters are set aside rather than hiding every card: the list shows every card that matches the rest of the search.

Treatments live in `src/data/treatments.ts`. Foil / Non-Foil offers the White Holo and Standard Holo finishes. Partial Foil offers only the Standard Holo finishes. Add a row to offer another one. Choosing a treatment sets `<foil>true</foil>`. Stock is `(S30) Standard Smooth`, the same default as the Art Picker.

## Deck lists

A deck list is a text file named `decklist.txt` or `decklist - <label>.txt` that sits directly in an edition folder (not in a subfolder). The dropdown shows the text after the dash; a bare `decklist.txt` uses the `Name` line under `About`, or "Deck list". When a folder has more than one list, the builder shows a **Deck list** dropdown. A new deck opens on "Complete Collection" when there is one, otherwise the first list. Each deck card on the homepage shows that opening total (the copies a new deck starts with), not the number of files in the main folder.

Lines can be Tapped Out style (`1x Name (SET) 123`, with `*F*` or `#tags` ignored) or plain (`1 Name`). `About`, `Commander`, `Deck`, and `Sideboard` headers are understood; `Maybeboard` is ignored. Commander lines count toward the main deck. Sideboard lines are kept apart and shown in a note; they are never added to the main counts (Vader's list has a five-card sideboard). Repeated lines for one card add up.

How a list sets counts:

- A listed card gets the list's quantity. When several files share the card's name (several arts), the copies are spread over them so each art keeps its own count.
- A main-folder card the list leaves out opens at 0. You can still add it.
- Basic lands follow the list. Only the basics the list asks for are kept: the listed copies are spread over that basic's arts, one each in turn, so a leftover art can open at 0, and a basic the list leaves out opens at 0. Without a list, basic lands never open at 0.
- Tokens in the main folder keep their folder count and stay in the main deck, even past 100.
- `Flip N`, `Front N`, and `Mask N` have no card title, so they keep their folder count.
- Double-faced prints are named `N_1_Front name` and `N_2_Back name` (a space after the face number also works, as in `1_2 Lost Vale`). `N_1` is the front and `N_2` the back, even when the two names differ, so the back is printed with its front and never counted as its own card. A back with no front is listed as an extra at 0. A deck saved before a pair was joined (for example a v0.1.11 save with The Ring Tempts You as its own token, or TMNT's old Lost Vale card) puts the back's copies on the paired card. If the deck already has that card, the back row is not counted again. A few known double-faced cards were once shared without the prefix (`KNOWN_UNPREFIXED_PAIRS` in `src/lib/faces.ts`: SxF's Hydroelectric Specimen and Hydroelectric Laboratory). Those files pair the same way when both faces are there, which covers a paid folder named before the rename and a pack unlocked before it. A folder that also has the renamed `1_1_`/`1_2_` files gets its card from those, and the old files join it as more arts of the same faces. Only this pair's old back row is folded in the deck's print set; other decks' saved back rows load exactly as before. In a Black and White SxF deck saved before the pair was joined, Specimen loads on the Black and White Laboratory (the saved Laboratory file when it is in that set), and new art rows always start on the back face in the deck's print set.
- A list line whose file name is spelled a little differently (one or two letters, a shortened name, the same first two words) is matched only when exactly one leftover file fits. Every list line with no file is listed in a note. Nothing is invented.

Shipped Standard lists live in `decklists/` and are copied into `public/decks/*.json` by `npx tsx scripts/attach-decklists.ts` (run it after `npm run catalogue`; `--check` verifies the JSON matches). Unlocked Deluxe and Partial Foil editions read the list files in their own folders through the Drive API. If a list there can't be read, the shipped copy with the same file name is used, and if there is none the deck opens on folder counts with a note.

Coverage of the shipped lists:

| Deck | Lists |
| --- | --- |
| Dr. Eggman, KPDH, NieR, Persona 5, Silksong, Spy x Family, TMNT, Vader, X-Men | one each |
| Floating World | six (25, Complete Collection, Fish of '97, Fish of Heat, Fish of Legends, Fish of Lies); the Standard and Deluxe folders only |
| Horror Movie Poster Secret Lair | none: every image opens at its default count |

TMNT and X-Men have no Partial Foil folder. There is no Dandan deck; Floating World lists that name Dandan, Red Herring, Filigree Familiar, or Slash Panther show those lines as missing because the folder has no file for them.

### Spy x Family Color and Black and White

Spy x Family keeps 35 always-color cards in Full Deck and 53 files (plus basic lands) twice under `IMPORTANT OPTIONS/Color` and `IMPORTANT OPTIONS/Black and White` (`Black & White` in Deluxe). Those become one card each with a Color file and a Black and White file, and the builder shows a **Print set** switch. Hydroelectric Laboratory is one of the 53, and it is the back face of Hydroelectric Specimen (`1_1_`/`1_2_` in the source since v0.1.28), so there are 52 option cards. Switching moves the option cards, Laboratory and the basics to that set and leaves the 35 alone. All cards and Random stay in the chosen set. Partial Foil never shows the switch.

## Silksong standard

The free files are generated from the public Drive folder `REDACTED_PAID_ID`, which is a list of decks. Silksong's folder has three editions. The build only requests **1_ Silksong Standard Edition**. It records the Deluxe and Partial Foil sibling names and does not open them.

Inside Standard:

- `Full Deck` image files are the main deck. `1_1_` / `1_2_` prefixes are the two faces of one card, so Cecil and the other double-faced cards are a single slot with a back.
- `Full Deck/Card Back` is the card backs.
- `Full Deck/Tokens` is the token list, not part of the 100.
- `Extras` folders are alternate arts when the name matches a main-deck card (`Sol Ring 2`, `Card Name (Variant) 2`, `Plains 3 1` under `Plains 3 (Crystal Peak)`). A folder of several different cards, or a loose file that isn't in the deck, becomes an extra.

The generated file is `public/decks/silksong.json`: 100 main cards, 10 tokens, 10 extras, 4 backs. The same public folder also ships Standard for X-Men, Vader, KPDH, Dr. Eggman, Nier, Persona 5, TMNT, Spy x Family, Floating World, and Horror Movie Poster Secret Lair. Thumbnails use `https://drive.google.com/thumbnail?id=<ID>&sz=w400` with no referrer, then `https://lh3.googleusercontent.com/d/<ID>=w400`.

### Names that needed a judgement

These are also in `editions[0].notes`.

The script could not treat this folder as alternates of a main-deck card, so the three cards are extras:

- **True Duals**: Scrubland (The Cradle), Tundra (Mount Fay), Underground Sea (Greenpath). The main deck has the shock lands with those themes, not these duals.

These were placed, and the note says the names don't match exactly:

- `Lochtwain Lancer (Last Judge)` is a one-letter typo for Locthwain. Kept as alternates.
- `Suppressor Skyguard (The Hive Knight)` sits in the Nyleth and Seth folder. Kept as an alternate.
- `Unsettled Mariner (Seth)` sits in the Crust King Khann folder. Kept as alternates.
- Folder titles that are longer or shorter than the deck file (`Island (Fog Canyon)`, `Plains 3 (Crystal Peak)`, `Teferi's Protection (Bench's Repose)`, `Watery Grave`, `Swamp (Shellwood)`) were matched and tagged `info`.

Loose files in Extras that are not in the main deck are extras, including Farewell and a few cards whose file names are spelled the way the folder spells them (`Muderous Rider`, `Zurgo,Helmsmasher`).

## Add a deck

Decks are data. The app reads `public/decks/index.json` and whatever JSON files it points at.

1. Put the deck in a public Drive folder whose name contains the deck's name, with a child folder whose name contains "Standard" and "Edition" (and not Deluxe or Partial Foil). Use the same Full Deck / Extras / Tokens / Card Back layout.
2. Rebuild:

```bash
npm run catalogue -- --root REDACTED_PAID_ID --deck vader
```

`--deck` is matched against folder names. The default root is the public Decks folder above. Output defaults to `public/decks/<deck>.json` and the script adds the deck to `public/decks/index.json`.

The crawl uses `https://drive.google.com/embeddedfolderview?id=<ID>`, which lists names and ids with no sign-in. It waits a short beat between folders. It will not request a sibling whose name is a Deluxe or Partial Foil edition.

## Paid unlock and the API key

`public/config.js` is loaded as a plain script so it can be edited after a build:

```js
window.PRINTABEE_CONFIG = {
  googleApiKey: "YOUR_GOOGLE_API_KEY",
};
```

Until that placeholder is replaced, unlock explains that the key is missing and does not call Drive.

To create the key:

1. In Google Cloud, enable the **Google Drive API**.
2. Create an API key. Restrict it to that API.
3. Restrict the websites that can use it (HTTP referrers). Include the GitHub Pages origin, and `http://127.0.0.1:4178/*` if you want to try unlock locally.
4. For the GitHub Pages site, add it as a repository secret named `GOOGLE_API_KEY` (**Settings → Secrets and variables → Actions → New repository secret**). The Pages workflow writes it into the built `dist/config.js` at deploy time (see GitHub Pages below). Leave `public/config.js` as the placeholder: never commit the key.
5. For a local build or the local zip, paste the key into the built `config.js` (`dist/config.js`, or `site\config.js` in the local zip), or run `GOOGLE_API_KEY=… npx tsx scripts/write-config.ts dist/config.js` after `npm run build`.

The key is visible to anyone who can load the page. The referrer restriction is what stops other sites from using it. Do not use a key that can do anything besides read Drive.

The paid folder has to be visible to an API key, which means shared so anyone with the link can view it. The app calls Drive API v3 `files.list` with `'<id>' in parents`, follows shortcuts, and walks subfolders. If it finds `New Drive Link.txt`, it reads the file and continues from the newer folder link inside (up to three hops).

Unlocked catalogues stay in `localStorage` under `printabee.unlocked.v1`. Saved decks are `printabee.savedDecks.v1`. Export that JSON before upgrading BeeLine. The storage keys keep their old `printabee.` names so saved decks carry over. An upgrade can change how a saved Deluxe or Partial Foil deck finds its folder, and the export is the copy you can put back. Forgetting unlocked folders does not delete saved decks, but a saved Deluxe or Partial Foil deck cannot export until that folder is unlocked again on that browser. A saved deck remembers the first 12 characters of the SHA-256 of its folder, not the folder id. A hash from v0.1.5 still finds that folder and is replaced with the SHA-256 form. If that folder is not unlocked, the deck stays put and asks you to unlock it instead of opening a different pack. The unlocked list stores the deck catalogue and that hash. It does not store the Drive link. Paste the link again when you want to refresh a folder. On the first load after an upgrade, an older unlock record that still contains a folder id or a link is rewritten without them.

A pack is partial foil only when an edition folder's own name says partial foil (`Partial-Foil`, `partial_foil`, `PartialFoil`, and `Partial Foil Edition (Standard Holo)` all count). A pasted folder title does not decide the print type. `Nonstandard art` is not a Standard edition. Inside a partial foil edition, Deluxe and Standard folders are not partial-foil print sources. A nested Deluxe folder is unlocked as its own Foil / Non-Foil deck. Its id comes from the folder name, and an id that is already taken is skipped, so “Deluxe Edition 2” does not collide with a second “Deluxe Edition”. The edition label includes that folder name. If a pasted Deluxe pack and a nested Deluxe folder still share an id, both stay in the merged deck with different ids. A deck saved in v0.1.0–v0.1.2 with the edition id `deluxe` opens the only Deluxe edition when there is one. When there is more than one, the deck stays in the list with a note asking which edition to use. A PDF folder is used when its name says partial foil. If there is exactly one PDF folder and it sits directly under the edition, it is used and the deck shows a note naming that folder. A nested unnamed PDF folder is not used, and the largest folder is never chosen. `DeLuxe` and `deLuxe` count as Deluxe. Partial foil decks can turn on "Print flip backs as fronts". That also prints the back face of each double-faced main card, flip card, and token as its own card when the back is a partial-foil PDF. A back without that PDF stays a normal back. PNG previews are thumbnails only, and export refuses a partial foil XML if any front is not one of those PDFs. `npm test` fails if a Drive file id in the repo or in `dist/` is not listed in `src/lib/drive-allow-list.txt`, or if its SHA-256 is in `src/lib/drive-deny-list.txt`. `Front` / `Back` files named `Flip N` and `Token N` don't carry card titles, so they stay under those names and the deck shows a note. Folders named template or font, and `Readme.txt`, are skipped.

## GitHub Pages

Suggested repository name: `beeline-deck-builder`. The site would then live at `https://<owner>.github.io/beeline-deck-builder/`.

`.github/workflows/pages.yml` builds with `npm ci` and `npm run build` (tests run first) and deploys `dist/` with the official Pages actions on every push to `main`, or by hand from the Actions tab. It does nothing until someone:

1. creates the repository and pushes this tree,
2. sets **Settings → Pages → Source** to **GitHub Actions**,
3. adds the repository secret `GOOGLE_API_KEY`: a browser key restricted to the Drive API and to the referrers `https://<owner>.github.io/beeline-deck-builder/*` and `http://127.0.0.1:4178/*` (local dev and preview).

After `npm run build`, the workflow's "Write the Google API key into dist/config.js" step runs `npx tsx scripts/write-config.ts dist/config.js` with the secret in the `GOOGLE_API_KEY` environment variable. The script replaces only the `googleApiKey: "YOUR_GOOGLE_API_KEY",` line, writing the key as a JSON string literal, so the file keeps the format the app reads. It never prints the key (its only output is one line saying whether it wrote a key or kept the placeholder), and the workflow passes the secret only through `env`, never on a command line, with no `echo`, `cat` or `set -x`. A key with spaces or line breaks fails the step without being shown. Without the secret, `dist/config.js` keeps the placeholder and paid unlock stays off. `public/config.js` in the repository is always the placeholder. `src/lib/deploy-config.test.ts` checks the workflow text and does a dry run of the step with a fake key.

The key stays out of the bundle, so it can also be edited in the deployed `config.js`. Never commit a paid Drive file or folder id; `npm test` checks every id in the repo and in `dist/` against the allow list.

## Tests

```bash
npm test
```

Vitest covers:

- the XML builder (brackets, slot grouping, escaping, the `printabee` block, omitting treatment, rejecting a standard file in a partial-foil id set)
- catalogue grouping (Plains 1 vs Plains 3, alternates, double-faced cards, tokens, True Duals, the Locthwain typo)
- the shipped crawl refusing to request Deluxe or Partial Foil ids
- the Drive client against a mocked `fetch` (pagination, `New Drive Link.txt`, a 403, reading deck list files)
- deck lists: file names and labels, both line formats, the shipped lists, list counts and every never-zero rule, folder fallbacks, Spy x Family Color and Black and White
- the banner copy, the shop link, the stacking rules, and the bee's flight path
- Clear all, Clear shown and their Undo; the deck filter's matching, the query box and the controls; the card lookup
- the first-run tour (the remembered answer, replay, Esc, focus, a missing control, no count or save changes); the deploy-time key step (workflow text and a dry run with a fake key)

Which extras are tokens comes from a one-time cross-reference of every extra and token name in the shipped decks against Scryfall's public API, committed as `src/data/token-lookup.ts`. The app never calls Scryfall. A name is a token when Scryfall's card has the layout token, double_faced_token or emblem, or "Token" in its type line. Names Scryfall has no card for, names that are both a token and a game card, and names whose only match is an art card or vanguard use the old rule (a Tokens folder, or a name starting with "Token"). `npx tsx scripts/token-lookup.ts` asks Scryfall again (about 165 requests, 8 a second) and rewrites the lookup; `--report <file>` writes the report from the committed lookup; `--check` fails when a shipped name has no entry or when a hand override matches no card. A few cards are decided by hand in `src/data/token-overrides.ts` (deck id and exact card name; the script never rewrites it), and those win over Scryfall and the old rule: Persona 5's Raphael, Thor and Titania, Silksong's Blood (Infection) and Vader's Shapeshifter 1-9 are tokens, and Persona 5's Lands (the Forest 3 art) is not. Nothing else uses the lookup: the Tokens and Extras lists still follow the folders.

The card facts come from `npx tsx scripts/card-lookup.ts [--cache <dir>]`, which asks Scryfall's `/cards/collection` for every card name (75 a request, 8 requests a second, backing off on a 429), tries `The <name>` and then Scryfall's fuzzy match for main-deck names it still has no card for (flagged for a check by eye in the report), and does an exact search with extras for tokens and names shared by several cards. `--report <file>` writes the report from the committed lookup; `--check` fails when a shipped card name has no entry or is listed as both matched and unmatched.

The golden tests `src/lib/v0127-golden.test.ts` and `src/lib/v0128-golden.test.ts` load saves made by v0.1.27 and v0.1.28 and check that they store, load and export byte for byte as those versions did, the v0.1.28 ones including Spy x Family Color and Black and White decks with Hydroelectric.

`npx tsx scripts/mutate.ts` breaks the code on purpose, one rule at a time, and fails if any test still passes.

## Layout

```
public/config.js          API key, not bundled
public/decks/index.json   decks the site ships
public/decks/<deck>.json
scripts/build-catalogue.ts
src/data/treatments.ts
src/lib/group.ts          folder tree → cards
src/lib/xml.ts            MPCFill XML
src/lib/drive.ts          paid folder listing
src/lib/selection.ts      quantities, All cards, Random, print set, per-card backs
src/lib/tokens.ts         which extras are tokens
src/data/token-lookup.ts  static Scryfall token lookup (generated)
src/data/token-overrides.ts  hand token decisions (wins over the lookup)
scripts/token-lookup.ts
src/lib/card-facts.ts     Scryfall facts per card
src/lib/card-filter.ts    deck filter and its query syntax
src/lib/clear.ts          Clear all / Clear shown
src/data/card-lookup.ts   static Scryfall card facts (generated)
scripts/card-lookup.ts
src/components/Tour.tsx   first-run prompt, Tour button, coach marks
src/lib/tour.ts           tour steps and the printabee.tour.v1 flag
scripts/write-config.ts   writes the GOOGLE_API_KEY secret into dist/config.js at deploy time
src/lib/decklist.ts       deck list parsing and counts
src/lib/flight.ts         banner bee path
decklists/                shipped deck list text files
scripts/attach-decklists.ts
.github/workflows/pages.yml
```
