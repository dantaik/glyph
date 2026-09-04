# Xueni implementation plan

> This file is the complete brief for an implementing AI session. It assumes no
> other context: not the conversation that produced it, not any earlier plan.
> Read it in full before touching code. It lives at the repository root as
> `IMPLEMENTATION_PLAN.md` for as long as the work is in progress, and the last
> phase deletes it.

## 0. How to use this plan

1. **One phase at a time, one pull request per phase.** Phases are numbered 0 to
   14 and ordered by dependency. Do not start a phase before the previous one is
   merged into `main`. Each phase is its own branch and its own pull request
   against `main`. If your environment dictates the branch name, use that name;
   the one-phase-per-PR rule still holds.
2. **Green before you push.** Every pull request must pass the repository's whole
   check locally before it is opened: `cd webapp && npm run check` (unit tests,
   production build, Playwright end-to-end tests over the mock node). From
   Phase 12 on, `cd cli && npm test` as well. CI (`.github/workflows/ci.yml`)
   runs the same steps; a red CI is yours to fix in the same PR. Phase 13 adds
   a second workflow, `desktop.yml`, that builds the macOS app; it must be
   green on that phase's PR and on every later one that touches it.
3. **Update the progress table** in section 1 in every phase PR: tick the phase,
   write the PR number, and note any decision you had to make that this plan
   did not settle (keep such notes short and put them under the table).
4. **Documentation is part of every phase.** Each phase says which parts of
   `README.md`, `glyph-spec.md`, the two locale files and `.codewhale/instructions.md`
   change. A phase whose docs are not updated is not done.
5. **Ask a human only at the marked checkpoints.** There are three, all
   about credentials or rights the session cannot create itself: Phase 2
   needs a WalletConnect project ID from the repository owner; Phase 13 needs
   that ID as a repository secret, optionally Apple signing secrets, and a
   release tag pushed on `main`. Every other decision is settled here. If something in this plan turns out to be
   impossible as written, choose the closest thing that keeps the stated
   behaviour, do it, and record the deviation under the progress table.
6. **Phase 14 deletes this file.** When every phase is merged and the closing
   sweep is done, remove `IMPLEMENTATION_PLAN.md` in the final PR. Nothing may
   reference it afterwards (grep for the file name before you open that PR).

Baseline at the time of writing: `webapp` has 227 unit tests and 22 end-to-end
tests, all green, and a clean production build. Keep every one of them green;
never delete or skip a test to get there.

## 1. Progress

| Phase | Title | Status | PR | Notes |
|---|---|---|---|---|
| 0 | Groundwork: shared refactors and two doc fixes | ☑ | #16 | |
| 1 | Draft autosave | ☑ | #16 | |
| 2 | Wallets: EIP-6963 discovery, optional WalletConnect | ☑ | #16 | ID still needed |
| 3 | Cost awareness: base-fee history and both chains side by side | ☑ | #16 | |
| 4 | Images: on-chain refs in the preview, a reuse ledger, paste and drop | ☑ | #16 | |
| 5 | Markdown round trip and the raw view | ☑ | #16 | |
| 6 | Front-matter relations and the body index | ☐ | | |
| 7 | Tags and search over what this browser has read | ☐ | | |
| 8 | The following feed | ☐ | | |
| 9 | ENS identity: names in URLs, avatars, profiles | ☐ | | |
| 10 | Reader polish: keyboard, lightbox, print, share and embed | ☐ | | |
| 11 | Archive bundles: export and import | ☐ | | |
| 12 | The command-line tool | ☐ | | |
| 13 | The macOS desktop app | ☐ | | |
| 14 | Closing sweep and deletion of this plan | ☐ | | |

Deviations and decisions made during implementation (append here, newest last):

- **One branch, one pull request, a commit per phase.** The implementing
  session is pinned to the branch `claude/interesting-features-flz4rr` and may
  not push to another, so the phases arrive as separate commits on that one
  branch and its pull request (#16) rather than as fourteen pull requests.
  Everything else about the rule holds: a phase is finished, green on
  `npm run check`, and committed on its own before the next one starts.
- **Phase 0.** `brotli-wasm` cannot initialise under Vitest's node
  environment (it takes its browser path and throws "not implemented"), which
  is why no unit test had ever decoded a real payload. The new `chainIO` body
  test therefore stubs the compression boundary and is about chainIO's own
  wiring; real brotli is exercised end to end by the Playwright suite against
  the mock node, which compresses with `node:zlib`.
- **Phase 1.** The end-to-end test found a real race the plan had not
  foreseen: a debounced save scheduled before publishing could land after
  the publish had cleared the draft, putting a letter that was already on
  chain back in the editor. Fixed with an epoch the save checks before it
  writes, bumped whenever the draft is deliberately forgotten.
- **Phase 4.** The reuse path is covered end to end (publish an image, then
  publish it again and count the transactions) rather than by a unit test:
  `embedImages` runs the image through a canvas, which jsdom has no answer
  for, so the honest test is a real browser. A useful side effect of the
  reuse check falls out of it: a body whose images are all already on chain
  now needs no wallet prompt at all, because the wallet is only fetched when
  something actually has to be sent.
- **Phase 2.** Built and verified without a WalletConnect project id, which
  the repository owner has not supplied yet. The code path is complete and
  the gating is proven both ways: a default build contains no WalletConnect
  library code at all (only the app's own `'walletconnect'` string), and a
  build with `VITE_WALLETCONNECT_PROJECT_ID` set bundles it. What is untested
  is the QR flow itself, which needs a real project id and a real wallet.
  A remembered WalletConnect choice is deliberately NOT reconnected on load:
  opening the write tab must never put a QR code on screen nobody asked for,
  so it reconnects on the next connect instead.

## 2. What Xueni is, in one page

Xueni (雪泥; the Solidity contract keeps its original name `Glyph`) is a
multi-author journal stored entirely in Ethereum L1 calldata. One ownerless,
non-upgradeable contract, deployed with CREATE2 to the same address on every
chain: `0x000000AE2f2249c497cfc5F262dd1491634C361C`, live on Ethereum mainnet
(chain id 1) and Taiko mainnet (167000). Every wallet is its own author.

- A post is one `publish(bytes32 title, bytes payload)` transaction. The title
  is UTF-8 right-padded to 32 bytes and appears in the `Post` event; the body is
  brotli-compressed UTF-8 Markdown with an optional YAML-style front-matter
  block, carried only in the transaction's calldata, never in the event.
- Images are separate plain-calldata self-transfer transactions holding WebP
  bytes, referenced from the Markdown as `![alt](eth:0x<txhash>)`.
- The contract keeps, per author, a packed `{ latestBlock, count }` and emits
  `Post(author indexed, index, prevBlock, title)`. An author's list is therefore
  a reverse block-linked list read one block at a time (cheap, O(1) per step).
  Cross-author discovery (the home feed) is the one range scan in the design:
  bounded `eth_getLogs` sweeps, newest first, with coverage recorded as a set of
  block ranges so nothing is read twice.
- The front end is a Vite + React 19 single-page app in `webapp/`, styled with
  Tailwind 4 design tokens, bilingual (English default, Chinese), with a
  permanent IndexedDB cache for bodies and images, per-chain scan stores in
  localStorage, ordered RPC failover per chain, and a live cost estimate.
- Principles that every change must respect: trust Ethereum and nothing else for
  content (the only off-chain HTTP dependency today is CoinGecko for the ETH/USD
  price, and it degrades gracefully); one contract, any number of authors; the
  stored text stays plain, human-readable Markdown; the per-author path stays
  O(1) per step; permanence comes from the on-chain anchor plus the reader's own
  caches and backups.

Read `README.md` and `glyph-spec.md` once before starting. They are the
authoritative description of what exists; this plan describes what to add.

### 2.1 Repository map

```
contracts/                Foundry project: src/Blog.sol (contract Glyph), script/Create2Deploy.s.sol
webapp/                   the app (npm; Node 22 in CI)
  src/App.jsx             shell: Header, Reader | Publisher | SettingsPage, Footer
  src/components/         React components (one per file, PascalCase)
  src/lib/                everything that is not a component:
    chains.js             chain registry (RPCs, explorer, deployBlock, scanBlocks, slugs)
    config.js             runtime config: READ_CHAIN_IDS, publish chain, RPC lists, rescan delay
    clients.js            one viem public client per chain over transport.js (ordered failover)
    chainIO.js            every node read for one chain (postsInRange, authorPostsInBlock, postBody, imageBytes, ensName…)
    scanStore.js          what one chain has already read: rows, coverage segments, localStorage snapshot
    scanner.js            traversal rules (sweepFeed, authorRowsAt, findAuthorPost), no I/O
    feed.js               FeedController: one chain's home-feed sweeps (refresh / more / gap)
    authorList.js         AuthorListController: one author's walk on one chain
    mergedFeed.js         MergedFeed: several chains' feeds merged by time, with the "frontier"
    mergedAuthorList.js   MergedAuthorList: one author across chains
    timeline.js           pure merge arithmetic: timeRows, compareMerged, frontierOf, rowKey
    reader.js             createReader(chainId): the per-chain facade (feed, authorList, findMetaByTx, loadPostBody, resolveImages, ensName, clock, blockTime)
    data.js               getReader(chainId), one per chain for the page; DEV fixtures switch
    view.js               createView(readers): the chain set a page reads; getView, useView
    router.js             URL ↔ state map: readParams, hrefFor, navigateTo, useUrlState, isHeadless
    payload.js            front-matter + brotli encode/decode of the body
    title.js              bytes32 title encode/decode
    glyphRefs.js          in-body cross-post references `[text](0x<tx>/<n>)`
    renderMarkdown.js     marked + sanitizer (the Markdown subset)
    publish.js            author side: image processing, image txs, publish()
    wallet.js             EIP-1193 wallet store (window.ethereum only, today)
    price.js              gas price, ETH/USD (CoinGecko), gas estimates, formatting
    cache.js              IndexedDB `glyph-cache` (stores: bodies, images), memory fallback
    settingsFile.js       settings export/import (format 1)
    i18n.js, locales/en.js, locales/zh.js
    theme.js, format.js, rpcLog.js, hooks.js, ttlCache.js, segments.js, rowTimes.js, view.js
    fixtureWorld.js, fixtures.js   the DEV/test demo chains (`?fixtures=1`)
  test/unit/*.test.js(x)  vitest (node by default; `// @vitest-environment jsdom` per file)
  test/e2e/*.spec.js      Playwright over dist/ + test/e2e/rpcServer.mjs (mock JSON-RPC node, both chains) + wallet.mjs (EIP-1193 mock)
glyph-spec.md             the technical design document
README.md                 user-facing documentation
.codewhale/instructions.md  a short auto-generated orientation file; keep its key-path list current
vercel.json               static hosting rewrites (every path → index.html)
```

There is no linter or formatter configured. Match the surrounding code's style
by eye: two-space indentation, single quotes, semicolons, trailing commas,
explanatory comments in full sentences.

### 2.2 Conventions that every phase follows

- **Both locales, always.** Every user-visible string goes through `t()` /
  `useT()` (`src/lib/i18n.js`) with a key in `locales/en.js` AND `locales/zh.js`.
  Keys are grouped by surface (`draft.*`, `following.*`, …). Entries are strings
  or functions of their interpolated parts; never concatenate sentence fragments
  at the call site. A key present in one file and missing from the other is a
  bug: add a unit test in Phase 0 that asserts the two dictionaries have the
  same key set, and keep it green.
- **Type roles, not ad-hoc utilities.** Text is set with the components in
  `src/components/Text.jsx` (`ArticleTitle`, `Title`, `Label`, `Body`, `Meta`,
  `Micro`, `Hint`, `Note`). Buttons and fields use the constants in
  `src/components/formStyles.js`. Icons come from `src/components/Icons.jsx`
  (add new ones there as `currentColor` SVGs, same style as the existing set).
- **One console line per node read.** Every new chain call goes through the
  reader's `log.fromNode(method, detail, fn, summarize)` and every locally
  answered read through `log.fromCache(...)` (`src/lib/rpcLog.js`).
- **Per-chain everything.** Caches, indexes and stores are scoped by chain id.
  A transaction hash means nothing across chains; never key anything by hash
  alone.
- **BigInt discipline.** Block heights and indexes are BigInt in memory and
  plain numbers/strings in JSON. Never put an array of BigInt into a React prop
  (React 19's DEV render log calls `JSON.stringify` on changed props and
  throws); pass strings or pre-rendered text instead. See the comment in
  `HomeFeed.jsx` above `running`.
- **Immutable content, cached forever; volatile facts, cached briefly.** Bodies,
  images, post metadata and block timestamps never expire. Head blocks, counts,
  gas prices and ENS records use a TTL (`makeTtlCache`).
- **Nothing is scanned twice.** Any new read path reuses `scanStore` coverage
  and the reader's `forever`/`volatile` caches rather than fetching on its own.
- **Tests come with the code.** Unit tests for every lib module (follow the
  patterns in `test/unit/helpers.js`, `mergedHelpers.js`, and the existing
  tests for the module you touch). End-to-end tests for every user-visible
  surface, against the mock node. When a feature needs a new RPC method or new
  fixture data, extend `test/e2e/rpcServer.mjs`, `test/e2e/wallet.mjs` and
  `src/lib/fixtureWorld.js` in the same phase.
- **Dependencies.** Adding an npm dependency is allowed only where this plan
  names one. Run `npm install` so `package-lock.json` is updated (CI uses
  `npm ci`). Prefer browser and Node built-ins (WebCrypto, `<dialog>`,
  `CompressionStream`, `node:zlib`, `node:util` `parseArgs`).
- **No new servers, indexers or content CDNs.** The reader must keep working
  from a static host with nothing but RPC endpoints. The exceptions already
  accepted: CoinGecko (price, optional); from Phase 2, the WalletConnect relay
  (wallet transport only, opt-in via a build-time variable); and, in the
  desktop app only, a once-a-day GitHub Releases lookup for a newer version
  (Phase 13).
- **Do not touch `contracts/src/Blog.sol` or the CREATE2 constants.** Any change
  moves the deployed address. The contract is out of scope for this plan.
- **Do not reintroduce the single-file offline build** (removed on purpose in
  PR #12) or the "featured post" card (removed in PR #11).
- **Commit and PR style.** Follow the history: a subject line that says what
  changed in plain words (optionally prefixed `feat:`, `ui:`, `fix:`, `test:`),
  a body that says why and how it was verified (test counts, what was checked
  by hand). The PR description lists the phase number, what changed, the tests
  added, and the docs updated.

### 2.3 Cross-cutting registries (kept current by every phase)

**localStorage keys** (all `glyph.`-prefixed; existing ones listed for
orientation, new ones marked with the phase that adds them):

| Key | Holds | Phase |
|---|---|---|
| `glyph.lang.v1`, `glyph.theme.v1`, `glyph.log.v1` | language, theme, console log switch | existing |
| `glyph.rpcs.v1`, `glyph.publishChain.v1`, `glyph.rescanDelay.v1` | endpoint lists, publish chain, rescan delay | existing |
| `glyph.feedScan.v2.<chainId>`, `glyph.authorScan.v2.<chainId>` | scan store snapshots | existing |
| `glyph.wallet.choice.v1` | `{ kind: 'injected' \| 'walletconnect', rdns?: string }` | 2 |
| `glyph.images.v1` | image reuse ledger `{ [chainId]: { [sha256hex]: txHash } }` | 4 |
| `glyph.following.v1` | `{ addresses: string[] }` (lowercase) | 8 |
| `glyph.followingSeen.v1` | `{ ts: number }` newest row time seen on the following page | 8 |
| `glyph.desktop.updateSeen.v1` | the release version whose update notice was dismissed (desktop app only) | 13 |

**IndexedDB** database `glyph-cache`: version 1 has stores `bodies` and
`images`, keyed `"<chainId>:<txhash lowercase>"`. Phase 1 bumps the version to
2 and adds the store `drafts`. Body records grow in Phase 0 (see there); older
records without the new fields must keep working.

**Routes** (`src/lib/router.js`; every route may carry a leading chain segment
`/ethereum` or `/taiko` as a filter, post routes always do):

| Route | Page | Phase |
|---|---|---|
| `/`, `/author/0x…`, `/tx/0x…/<n>`, `/scan`, `/settings` | existing | existing |
| `/following` | the following feed | 8 |
| `/tag/<name>` | posts with a tag | 7 |
| `/search?q=<text>` | full-text search | 7 |
| `/author/<name>.eth` | an author by ENS name | 9 |

**Settings file** (`settingsFile.js`, `glyph.settings` format 1): Phase 8 adds
the optional key `following` (array of addresses). The format number does not
change; readers ignore unknown keys and a file without the key leaves the list
alone.

**Front-matter keys** (Phase 6 defines them; see there): `tags`, `lang`, `re`,
`supersedes`, `prev`, `series`, `part`.

---

## Phase 0 · Groundwork: shared refactors and two doc fixes

**Goal.** Make the small structural changes that several later phases depend
on, in one PR that changes no user-visible behaviour, and fix two documentation
inconsistencies found during review.

### 0.1 Split the payload text layer out of `payload.js`

Later phases add front-matter keys (Phase 6), need the exact on-chain text
(Phase 5) and need to build and parse payload text in Node without Vite or
brotli-wasm (Phase 12). So:

- Create `webapp/src/lib/payloadText.js`, pure and free of any import that is
  not plain JavaScript. It exports:
  - `splitFrontMatter(text) → { meta: Record<string,string>, body: string }`
    (move the existing conservative parser here unchanged: first line exactly
    `---`, a closing `---`, every line between them `key: value`, else the whole
    text is body).
  - `parseTags(raw) → string[]` (moved; tolerates `[a, b]`).
  - `buildPayloadText({ markdown, meta }) → string`. `meta` is an object whose
    values are strings or arrays of strings (arrays serialise as `a, b`).
    Keys are written in the fixed order of `FRONT_MATTER_KEYS` (below), keys
    with empty values are omitted, and when no key is left the result is the
    bare Markdown with no front-matter block at all. With only `tags`, the
    output must be byte-identical to what `encodePayload` produces today
    (`---\ntags: a, b\n---\n\n<markdown>`), so existing tests keep passing.
  - `parsePayloadText(text) → { meta, tags, markdown }` where `tags` is
    `parseTags(meta.tags)` and `meta` is the raw key map (unknown keys kept).
  - `FRONT_MATTER_KEYS = ['tags', 'lang', 're', 'supersedes', 'prev', 'series', 'part']`
    (the order they are written in). Phase 6 gives them meaning; here they only
    fix the serialisation order.
- `payload.js` keeps `encodePayload` and `decodePayload` as the brotli
  boundary. `encodePayload({ tags, markdown, meta })` merges `tags` into `meta`
  and calls `buildPayloadText`. `decodePayload(bytes)` returns
  `{ meta, tags, markdown, text }` where `text` is the exact decompressed
  string. Existing callers that destructure `{ tags, markdown }` keep working.
- Update `test/e2e/rpcServer.mjs` (`txOf`) and `src/lib/fixtures.js`
  (`postBody`) to build their text with `buildPayloadText` so the mock node and
  the DEV demo produce the same bytes the app does.

### 0.2 Body records carry the exact text and its compressed size

- `chainIO.postBody(txHash)` returns `{ meta, tags, markdown, text, compressedBytes }`
  (`compressedBytes` = byte length of the `payload` argument decoded from the
  transaction input).
- `reader.loadPostBody(txHash)` stores the whole object in IndexedDB. A cached
  record from before this phase lacks `text`; add `reader.loadPostText(txHash)`
  that returns the cached record when it has `text`, otherwise refetches through
  `io.postBody`, rewrites the cache record, and returns it. Phase 5 uses this.
- `cache.js` needs no schema change for this (the record is opaque JSON).

### 0.3 The contract address is Node-safe

`config.js` reads `import.meta.env` at module top level, which throws in plain
Node. Move `DEFAULT_GLYPH_ADDRESS` into `chains.js` (which the mock node already
imports from Node) and have `config.js` re-export it, so `GLYPH_ADDRESS` in
`config.js` is unchanged for the app and Phase 12 can import the address
without Vite.

### 0.4 Block reads carry the base fee

`chainIO.block(which)` returns `{ number, timestamp, baseFeePerGas }`
(`baseFeePerGas` as BigInt, or `null` when the node omits it). The fixture I/O
(`fixtures.js`) and the unit-test fake chain (`test/unit/helpers.js`) return a
constant `1n`. The mock node already answers `baseFeePerGas: '0x1'`. Phase 3
uses this.

### 0.5 A shared clipboard helper

Move `copyToClipboard(text)` out of `ImageUploader.jsx` into
`webapp/src/lib/clipboard.js` (same behaviour: async Clipboard API, hidden
textarea fallback, resolves to a boolean). Phases 4 and 10 use it.

### 0.6 Locale parity test

Add `test/unit/locales.test.js`: the key sets of `locales/en.js` and
`locales/zh.js` are identical, and for every key both entries are of the same
type (string or function). This test protects every later phase.

### 0.7 Two documentation fixes

- The backup note (`backup.note` in both locales, and the "Backup and restore"
  paragraph in `README.md`) says the settings file carries "the body text size".
  There is no such setting (`settingsFile.collectSettings` exports language,
  theme, endpoints, rescan delay, publish chain and the log switch). Remove the
  phrase from all three places.
- `glyph-spec.md` §8 lists tables under **Cut**, but `renderMarkdown.js` runs
  `marked` with `gfm: true` and `index.css` styles `.prose-glyph table`. Tables
  are supported. Move them to **Supported** in §8 and in the design decision
  record row "Content format" if it mentions the subset.

### 0.8 The size ceilings are Node-safe

Move `MAX_TX_BYTES` and `MAX_CALLDATA_BYTES` from `publish.js` into
`webapp/src/lib/limits.js` (a module with no imports) and re-export them from
`publish.js` so every existing import keeps working. Phase 12 imports the
ceiling from `limits.js`.

### 0.9 Tests, docs, done

- Unit: `payloadText.test.js` (round trips, ordering, no-front-matter case,
  unknown keys preserved, `---` rule at the top of a body is not front-matter);
  extend `chainIO.test.js` for `text`/`compressedBytes`/`baseFeePerGas`;
  `reader.test.js` for `loadPostText` on a record without `text`;
  `locales.test.js`.
- Docs: spec §5 mentions `payloadText.js` as the text layer; §8 table fix;
  README backup paragraph; `.codewhale/instructions.md` lists `payloadText.js`
  and `limits.js`.
- Done when: no behaviour change is visible in the app, `npm run check` is
  green, and every later phase's dependency above exists.

---

## Phase 1 · Draft autosave

**Goal.** A writer never loses a draft. Today the draft lives only in React
state in `Publisher.jsx`: a reload, a wallet redirect on mobile, or a closed tab
loses everything, including image references that were already paid for.

### 1.1 Behaviour

- Title, tags, body, attached images and the front-matter fields added in
  Phase 6 are saved to the browser automatically, about half a second after the
  last change, and restored the next time the Write tab opens.
- A restored draft is announced with a quiet notice above the title:
  "Draft restored from <relative time> · Discard". Discard clears the stored
  draft and resets the form to the empty placeholder.
- Publishing successfully clears the draft. "Write another" starts from an
  empty form. Resetting the draft never happens silently.
- While images are being uploaded or the publish transaction is awaiting
  signature, closing or reloading the tab asks for confirmation
  (`beforeunload`). The confirmation is not shown at other times: autosave
  makes it unnecessary.
- After image uploads succeed the body already holds `eth:` references
  (the code sets `setMarkdown(finalMd)`); the autosave must capture that state
  so a failure at the signing step does not lose paid image transactions.

### 1.2 Implementation

- `cache.js`: bump `DB_VERSION` to 2; in `onupgradeneeded` create the object
  store `drafts` if missing. Existing stores are untouched. The memory fallback
  (`idbDenied`) applies to drafts too.
- New `webapp/src/lib/drafts.js`:
  - `DRAFT_KEY = 'current'` (one draft per browser).
  - `saveDraft(draft)` writes `{ title, tags, markdown, meta, files, updatedAt }`
    where `files` is a plain object `{ [key]: File }` (structured clone stores
    File/Blob), `meta` is the front-matter field state (empty object until
    Phase 6), `updatedAt` is `Date.now()`.
  - `loadDraft()` returns the record or null. `clearDraft()` deletes it.
  - `isEmptyDraft(draft, placeholderBody)` is true when title, tags, meta and
    files are empty and the body equals the placeholder or is blank; such a
    draft is never saved, and a stored empty draft is not restored.
- `Publisher.jsx`:
  - On mount, `loadDraft()`; if non-empty, seed state from it and show the
    notice (`draft.restored` with the relative time from `fmtRelTime`).
  - A debounced effect (500 ms) saves whenever title, tags, markdown, meta or
    files change; skipped while the restore is in progress and when the draft
    is empty.
  - `resetDraft()` also calls `clearDraft()`; `handlePublish` clears the draft
    after `publishPost` resolves.
  - `beforeunload` listener registered only while `status` is `processing` or
    `signing`.
- `ImageUploader` keys stay `img1, img2…`; a restored draft keeps the keys so
  the body's `upload:imgN` references still resolve.

### 1.3 Tests

- Unit (`test/unit/drafts.test.js`, jsdom): save/load/clear round trip
  including a File; empty-draft detection; the memory fallback when IndexedDB
  is unavailable (follow `cache.test.js` for how IndexedDB is exercised or
  stubbed in this repo).
- Unit (`publisher.test.jsx`, jsdom): a stored draft is restored on mount and
  the notice appears; Discard clears it; a change triggers a save after the
  debounce (use fake timers).
- End-to-end (`test/e2e/drafts.spec.js`): type a title and a body, add a tag,
  reload, the form still holds them and the restore notice is visible; Discard
  empties the form; after a mocked publish (wallet mock connected) the draft is
  gone on reload.

### 1.4 Docs and done

- Locale keys `draft.restored` and `draft.discard` in both files (the
  `beforeunload` prompt's text is the browser's own; it needs no key).
- README "Writing" paragraph: one sentence that drafts are saved in this
  browser automatically and restored.
- Done when a reload mid-draft loses nothing and publishing clears the draft.

---

## Phase 2 · Wallets: EIP-6963 discovery, optional WalletConnect

**Goal.** Reach more writers. Today `wallet.js` and `publish.js` use
`window.ethereum` directly, which picks whichever extension won the race and
leaves mobile readers without a browser extension unable to publish.

**Human checkpoint.** WalletConnect requires a project ID from Reown Cloud
(formerly WalletConnect Cloud). Ask the repository owner for it. It is a
build-time variable, `VITE_WALLETCONNECT_PROJECT_ID`; when it is absent the
WalletConnect option does not exist in the UI and the app behaves exactly as
before. Do not block the rest of this phase on the ID: build the injected
discovery first, then WalletConnect behind the variable, and test the latter
with the variable set to a dummy value where the UI is concerned.

### 2.1 Behaviour

- The write tab's "Wallet and network" panel lists every wallet the browser
  announces through EIP-6963 (icon and name). One click connects that wallet.
  With exactly one wallet announced there is no chooser, just the existing
  connect button. The choice is remembered (`glyph.wallet.choice.v1`) and
  reused on the next visit without prompting.
- When the build carries `VITE_WALLETCONNECT_PROJECT_ID`, "WalletConnect"
  appears as one more entry. Choosing it opens the WalletConnect QR modal; a
  mobile wallet scans it; from then on the app treats it as the wallet (account,
  chain, chain switching, sending) through the same EIP-1193 surface.
- Everything downstream (publish chain resolution, mismatch notice, chain
  switch, image transactions, `publish()`) works unchanged with whichever
  provider is selected.

### 2.2 Implementation

- `wallet.js`:
  - Keep the module-level store, add `providers: [{ info: { uuid, name, icon, rdns }, provider }]`
    and `selected: { kind, rdns } | null`.
  - `discoverProviders()`: register a `window` listener for
    `eip6963:announceProvider` (dedupe by `rdns`), then dispatch
    `eip6963:requestProvider`. Run once from `init()`. A bare `window.ethereum`
    with no announcements is listed as a single synthetic entry
    `{ rdns: 'injected', name: 'Browser wallet' }`.
  - `getProvider()` returns the selected provider, else the only announced one,
    else `window.ethereum`, else null. `selectProvider({ kind, rdns })` stores
    the choice, re-subscribes the `accountsChanged` / `chainChanged` /
    `disconnect` listeners on the new provider, re-reads accounts and chain,
    and emits.
  - `connect()` and `switchToConfiguredChain()` use `getProvider()`.
  - WalletConnect: `selectProvider({ kind: 'walletconnect' })` lazily
    `import('@walletconnect/ethereum-provider')` (code-split; the import must
    not be reachable when the variable is absent, so guard it with a literal
    check on `import.meta.env.VITE_WALLETCONNECT_PROJECT_ID`), then
    `EthereumProvider.init({ projectId, chains: [1], optionalChains: [167000], showQrModal: true, rpcMap: { 1: <first Ethereum RPC>, 167000: <first Taiko RPC> }, metadata: { name: 'Xueni', description, url: location.origin, icons: [] } })`
    and `provider.enable()`. Add the dependency `@walletconnect/ethereum-provider`
    (latest 2.x at implementation time; verify the package is still the
    maintained EIP-1193 provider and note the version in the PR).
- `publish.js`: `getWallet(chainId)` uses `getProvider()` instead of
  `window.ethereum` (`custom(provider)`).
- New `components/WalletChooser.jsx`, rendered inside `WalletPanel` when there
  is more than one candidate (announced wallets plus WalletConnect when
  enabled): a row of small buttons with the wallet icon (EIP-6963 gives a data
  URI) and name; the selected one uses `SEGMENT_ON`. A "Disconnect" quiet action
  clears the choice (for WalletConnect also calls `provider.disconnect()`).
- `WalletPanel` shows the connected wallet's name beside the address.
- `test/e2e/wallet.mjs`: the mock announces itself through EIP-6963 as
  `{ rdns: 'io.mock.wallet', name: 'Mock Wallet' }` in addition to installing
  `window.ethereum`; accept an option `announceSecond: true` that announces a
  second mock wallet so the chooser path is testable.

### 2.3 Tests

- Unit (`wallet.test.js`, jsdom): discovery collects announced providers and
  dedupes by rdns; `getProvider()` precedence; the stored choice is restored;
  selecting re-subscribes events. Stub `import()` of the WalletConnect module
  and assert it is only attempted when the variable is set.
- End-to-end (`test/e2e/wallet.spec.js`): with two announced wallets the
  chooser appears and connecting through the second one records
  `eth_requestAccounts` on that provider; with one wallet no chooser; the choice
  survives a reload. WalletConnect's modal cannot run in the mock; test only
  that the entry is absent without the variable (the default build).
- Existing `write.spec.js` and `walletPanel.test.jsx` keep passing.

### 2.4 Docs and done

- Locale keys under `wallet.*`: `chooseWallet`, `browserWallet`, `walletConnect`,
  `disconnect`, `connectedWith`.
- README "Writing": wallets are discovered through EIP-6963; WalletConnect is
  available when the site is built with `VITE_WALLETCONNECT_PROJECT_ID`
  (document the variable in the env block of the Quick start). Spec §6 gets a
  sentence on provider selection; §10 a row "Wallet transport".
- Done when two installed wallets can be told apart and chosen, and a build
  without the variable is byte-for-byte free of WalletConnect code (check the
  `dist/` chunk list).

---

## Phase 3 · Cost awareness: base-fee history and both chains side by side

**Goal.** The spec calls the moment of publishing the biggest cost lever, by a
factor of a hundred. Give the writer that lever without any off-chain
dependency: recent base fees come from the node, and the other chain's price is
shown next to the chosen one.

### 3.1 Behaviour

- The "Estimated cost" panel gains a 24-hour base-fee sparkline for the publish
  chain with three facts under it: the current base fee, the lowest hourly
  sample in the window with its time, and how much cheaper the current draft
  would have been then, in the same units the panel already shows (ETH, and USD
  when available). Wording: "24h low: 0.31 gwei at 04:00 · this post would have
  cost ≈ $0.02".
- Below the total, one line per other read chain: "On Taiko this would cost
  ≈ 0.000001 ETH ($0.002) · Publish there". "Publish there" sets the publish
  chain (`savePublishChainId`), which the wallet panel already reacts to.
- The panel keeps degrading gracefully: no USD when CoinGecko is unreachable,
  no sparkline when a node fails to answer header reads, never an error state.

### 3.2 Implementation

- New `webapp/src/lib/gasHistory.js`:
  - `baseFeeHistory(reader, { hours = 24, samples = 25 } = {})` → `[{ block, ts, baseFeePerGas }]`,
    oldest first. Uses `reader.clock()` for the head and the measured
    `secondsPerBlock`, computes `blocksPerHour = round(3600 / secondsPerBlock)`,
    and reads `reader.io.block(head - k * blocksPerHour)` for `k = samples-1 … 0`
    with at most 4 reads in flight (move `mapLimit` out of `chainIO.js` into a
    small `webapp/src/lib/async.js` and import it in both places).
    Every header read is logged by `chainIO.block` already.
  - Cached per reader with `makeTtlCache(() => 10 * 60_000)` (ten minutes), keyed
    `baseFees:<hours>:<samples>`. Expose it from the reader as
    `reader.baseFeeHistory(opts)`.
  - Pure helpers, unit-testable: `lowestSample(samples)`, `costAt(baseFee, gas)`.
- `price.js`: `getMarketState(client)` stays; add `getMarketStates(chainIds)`
  that returns `{ [chainId]: { gasPriceWei, ethUsd } }` (ETH/USD fetched once
  and shared; both chains use ETH).
- `Publisher.jsx`: compute the estimate for every `READ_CHAIN_IDS` entry
  (same `estimatePublishGas` + image gas, different gas price), pass
  `comparisons` to `CostPanel`.
- `CostPanel.jsx`: new `GasSparkline` (inline SVG, 25 points, `currentColor`
  stroke, no library, `role="img"` with an `aria-label` sentence), the three
  facts as `Micro` text, and the per-chain comparison lines with a quiet
  "Publish there" button.
- Taiko note: the estimate for an L2 uses the L2 gas price the node reports, the
  same approximation the panel already makes. Say so in a `Note` under the
  comparison ("Estimates use each network's own gas price").

### 3.3 Tests

- Unit: `gasHistory.test.js` over `fakeChain` (sample count, ordering, TTL
  caching, tolerance of a failed header read: the sample is dropped, not the
  whole history); `price.test.js` for `getMarketStates`.
- Component (`costPanel.test.jsx`, jsdom): sparkline renders with data and is
  absent without; comparison lines list the other chain; "Publish there" calls
  `savePublishChainId`.
- End-to-end (`test/e2e/cost.spec.js`): on the write tab the panel shows a line
  for the other chain, and clicking "Publish there" switches the publish target
  in the wallet panel. The mock node's constant base fee is fine for presence
  checks.

### 3.4 Docs and done

- Locale keys under `cost.*`: `low24h`, `wouldHaveCost`, `onOtherChain`,
  `publishThere`, `ownGasPriceNote`, `sparklineLabel`.
- README "Cost estimate" line: mention the 24-hour base-fee history and the
  side-by-side comparison. Spec §3: a paragraph on where the history comes from
  (`eth_getBlockByNumber` samples, no off-chain source).
- Done when a writer can see a cheaper hour and a cheaper chain without leaving
  the page, and a node that refuses header reads only hides the sparkline.

---

## Phase 4 · Images: on-chain refs in the preview, a reuse ledger, paste and drop

**Goal.** Make images cheaper and easier. Today the editor preview resolves
`upload:` references but not `eth:` ones, so reusing an image already on chain
is blind; the same image can be paid for twice; and adding an image takes three
steps (upload, copy reference, paste).

### 4.1 Behaviour

- The preview pane renders `![alt](eth:0x…)` references by fetching the image
  through the publish chain's reader (cache-first), exactly as the post page
  will.
- When an image about to be uploaded has already been published by this
  browser on the same chain (same processed bytes), no new transaction is sent:
  the existing transaction hash is used, the progress line says "reusing the
  copy published earlier", and the cost panel shows that image at zero once it
  is known to be reusable.
- Pasting an image from the clipboard or dropping one onto the editor attaches
  it (`imgN`) and inserts `![](upload:imgN)` at the cursor in one step.

### 4.2 Implementation

- `MarkdownEditor.jsx`: accept `resolveEth(markdown) → Promise<{ markdown, urls }>`.
  In preview mode, after the `upload:` substitution, call it, hold the result
  in state, and revoke the returned object URLs when the input changes or the
  component unmounts. `Publisher` passes `(md) => reader.resolveImages(md)`
  where `reader` is the publish chain's reader (already in scope).
- New `webapp/src/lib/imageLedger.js`:
  - `sha256Hex(bytes)` via `crypto.subtle.digest('SHA-256', …)`.
  - `knownImage(chainId, hash) → txHash | null`, `rememberImage(chainId, hash, txHash)`
    over `glyph.images.v1` (JSON, tolerant of corruption, bounded to the newest
    500 entries per chain).
- `publish.js` `embedImages`: after `processImage`, hash the bytes; if
  `knownImage(chainId, hash)` exists, skip `storeImage`, call
  `onProgress(key, i, total, { reused: true })` and reuse the hash; otherwise
  send, then `rememberImage`. Export `hashProcessedImage(file)` so the cost
  panel can pre-compute reusability for attached files (best effort, cached per
  File object in `Publisher`).
- `Publisher.jsx`: image cost lines show "already on chain · no cost" for
  reusable images.
- Paste and drop: in `MarkdownEditor`, add
  `EditorView.domEventHandlers({ paste, drop })`. For clipboard or DataTransfer
  items of type `image/*`, call the new prop `onAddImages(files) → keys[]`
  (Publisher assigns the next `imgN` keys through the same logic
  `ImageUploader.addFiles` uses; move that key assignment into a shared helper
  `nextImageKeys(files, count)` in a small `webapp/src/lib/imageKeys.js`) and
  insert `![](upload:<key>)` per file at the cursor
  (`view.dispatch({ changes: { from, insert } })`). Text pastes are untouched.

### 4.3 Tests

- Unit: `imageLedger.test.js` (jsdom; hashing a known byte string, remember and
  recall, bound, corrupt storage); `publish.test.js` additions with a stubbed
  wallet: a known hash sends no transaction and reports `reused`.
- Component (`markdownEditor.test.jsx`, jsdom): preview calls `resolveEth` and
  swaps the reference; a synthetic paste event with an image file calls
  `onAddImages` and inserts the reference.
- End-to-end (`test/e2e/images.spec.js`): drop a small PNG onto the editor
  (Playwright `dispatchEvent` with a DataTransfer or `setInputFiles` on the
  dropzone plus the paste path via `page.evaluate`), the reference appears in
  the body and the thumbnail in the grid; preview shows the image. Reuse: with
  the wallet mock, publish once, start a new draft with the same image, the
  second publish sends one fewer `eth_sendTransaction` (compare
  `window.__wallet.calls`).

### 4.4 Docs and done

- Locale keys under `image.*`: `reused`, `reusing`, `pasteHint`, `noCost`.
- README "Writing": images can be pasted or dropped into the editor; an image
  published before from this browser is reused instead of paid for again. Spec
  §6: the ledger and the reuse rule.
- Done when the same image is never paid for twice from one browser and an
  image goes from clipboard to body in one action.

---

## Phase 5 · Markdown round trip and the raw view

**Goal.** Make the "any editor, decades later" principle usable now: a post can
be imported from a `.md` file, exported as the exact text the chain holds, and
inspected as the chain holds it.

### 5.1 Behaviour

- Write tab: an "Import Markdown file" action beside the body heading. The file
  is parsed with `parsePayloadText`: a `title:` key in its front-matter becomes
  the title (the key is not written on chain; `title` is not in
  `FRONT_MATTER_KEYS`), otherwise the first `# Heading` line, otherwise the file
  name without extension, truncated to fit 32 bytes. `tags` and the Phase 6
  keys populate their fields; unknown keys are dropped with a notice that names
  them. The body is the text after the front-matter. Importing replaces the
  current draft after a confirmation when the draft is not empty.
- Post page footer: two new actions in the provenance line, "Raw" and
  "Download .md".
  - **Raw** toggles a monospace `<pre>` under the article showing the exact
    decompressed on-chain text (front-matter included) with a header line:
    compressed bytes, decompressed bytes, compression ratio, transaction hash,
    block, chain. The ordinary rendering stays above it.
  - **Download .md** saves the exact text as a file named
    `<yyyy-mm-dd>-<title slug>.md` (date from the block time; slug = title
    lower-cased, non-alphanumerics collapsed to `-`, CJK kept as is, max 60
    characters; fall back to the short transaction hash when the title is
    empty).
- Both actions also exist in headless mode (they are part of the letter's
  provenance, not navigation).

### 5.2 Implementation

- `PostPage.jsx`: use `reader.loadPostText(meta.txHash)` (Phase 0) lazily when
  Raw or Download is first used. New `components/RawView.jsx` renders the
  header facts and the `<pre>`; add `fmtBytes(n)` to `format.js`.
- Download: build a `Blob([text], { type: 'text/markdown;charset=utf-8' })` and
  an anchor click, the same pattern `BackupSection.exportFile` uses; factor that
  into `webapp/src/lib/download.js` (`downloadText(name, text, mime)`) and use
  it from both places.
- Import: `components/ImportMarkdown.jsx` (a hidden `<input type=file accept=".md,.markdown,text/markdown">`
  and the button) with `importMarkdownFile(file) → { title, tags, meta, markdown, dropped: string[] }`
  in `webapp/src/lib/markdownImport.js` (pure, unit-testable, takes text).
- `titleFromMarkdown(text)` in `markdownImport.js` handles the fallback chain
  and byte-truncation using `titleByteLength`.

### 5.3 Tests

- Unit: `markdownImport.test.js` (front-matter title, heading title, filename
  title, byte truncation on a CJK title, unknown keys reported, no front-matter
  case); `format.test.js` for `fmtBytes`; `download.test.js` (jsdom, anchor
  click observed).
- Component: `postPage` test for the Raw toggle showing `text` and the byte
  facts from `compressedBytes`.
- End-to-end (`test/e2e/raw.spec.js`): open a post, click Raw, the front-matter
  line `tags:` from the fixture body is visible in the `<pre>`; Download
  produces a file whose content equals the raw text (Playwright `waitForEvent('download')`
  and read the file). Import: `setInputFiles` with a generated `.md`, the title
  and tags fields fill.

### 5.4 Docs and done

- Locale keys under `raw.*` (`show`, `hide`, `compressed`, `decompressed`,
  `ratio`) and `export.*` (`download`, `import`, `importReplace`, `importDropped`).
- README "Reading": Raw and Download; "Writing": Import. Spec §8 "Render order"
  mentions the raw view; §9 lists the download as the simplest personal
  backup.
- Done when a post can be downloaded, edited in any editor, and imported back
  as a new draft without loss.

---

## Phase 6 · Front-matter relations and the body index

**Goal.** Give posts relations without touching the contract. The payload's
front-matter is the spec's stated extensibility mechanism: unknown keys are
kept by the parser and ignored by older readers. This phase defines a small
vocabulary, writes it from the editor, renders it on the post page, and builds
the local index that Phase 7 and Phase 8 also use.

### 6.1 The vocabulary

All keys optional. A **post reference** is `[<chainSlug>:]0x<64 hex>[/<n>]`:
the publish transaction hash, an optional 0-based event index (default 0), and
an optional chain slug prefix (`taiko:` or `ethereum:`); without a prefix the
reference is on the same chain as the post that carries it.

| Key | Value | Meaning | Rendered as |
|---|---|---|---|
| `tags` | `a, b` | existing | tag chips (Phase 7 makes them links) |
| `lang` | BCP-47 tag, e.g. `zh`, `en-GB` | the post's language | `lang` attribute on the article element (better CJK line breaking, screen readers) |
| `re` | post reference | this post replies to that one | "In reply to <title>" under the byline, linking to it; on the target, a "Replies" list |
| `supersedes` | post reference | this post replaces that one (errata, a new version) | on the old post, a banner "A newer version of this post exists: <title>"; on the new post, "Supersedes <title>" in the provenance line |
| `prev` | post reference | this post continues that one | "Continues from <title>"; on the target, "Continued in <title>" |
| `series` | free text, ≤ 64 characters | the name of a series this post belongs to | "Part k of <series>" with previous/next in the series when known |
| `part` | positive integer | the post's number within `series` | as above |

Rules: `parsePostRef(str, defaultChainId)` in `glyphRefs.js` returns
`{ chainId, txHash (lowercase), eventIndex }` or null; `formatPostRef(ref, currentChainId)`
writes the shortest form (no prefix when same chain, no `/0`). Values that fail
validation are ignored at render time (never an error) and refused at publish
time with a field-level message. `series` and `part` are meaningful only
together; `part` without `series` is ignored. Relations are never followed
across authors for `series` (a series is one author's), but `re`, `supersedes`
and `prev` may point at any author's post.

### 6.2 Writing

- `Publisher.jsx` gains a collapsed "Relations" section (`components/RelationsFields.jsx`)
  between Tags and Body with fields: Reply to, Supersedes, Continues from
  (each a post reference input accepting the reference forms above or a full
  Xueni post URL, which is converted), Series (text), Part (number), Language
  (a short text field with a datalist of `en`, `zh`). Each reference field
  resolves its target's title through the view (`findMetaByTx`) and shows it
  under the field, or "no such post" in the danger colour.
- The fields feed `meta` in the draft (Phase 1 persists it) and go on chain
  through `encodePayload({ tags, markdown, meta })`.
- A "Reply" action on the post page, a quiet link in the provenance line for
  now (Phase 10 moves it into the share menu), opens the write tab with `re`
  pre-filled. Implement via a module-level `pendingDraftPatch` in
  `drafts.js` that `Publisher` consumes on mount.

### 6.3 Reading

- `PostPage.jsx` renders the relations from `body.meta` (`components/RelationsPanel.jsx`):
  the lines under the byline for `re`, `prev`, `supersedes`, `series/part`, and
  below the article a "Replies", "Continued in" and "Superseded by" list drawn
  from the body index (6.4). Titles are resolved through the view
  (`view.findMetaByTx(chainId, txHash, n)`), cached forever by the reader.
- The `lang` value sets `lang` on the `<article>`.

### 6.4 The body index

New `webapp/src/lib/bodyIndex.js`, one index per chain (`getBodyIndex(chainId)`),
fed by every decoded body:

- `add(post, body)` where `post` is a row (`author, index, block, txHash, eventIndex, title, ts`)
  and `body` the decoded record. Records: `tags` (lower-cased, trimmed) →
  rowKeys; `backlinks` target key `"<chainId>:<txhash>:<n>"` → `[{ kind: 're'|'supersedes'|'prev', from: rowKey, post }]`;
  `series` `"<author lowercase>|<series lowercase>"` → `[{ part, post }]`.
  `rowKey` is `timeline.rowKey`.
- `warm()` iterates the IndexedDB `bodies` store once per session for this
  chain's keys and adds every record whose row the scan store knows
  (`store.knownPostByTx`); records for unknown rows are indexed with the
  metadata that can be recovered from the body key alone (chain, txHash) and
  upgraded when the row becomes known. `warm()` is idempotent and returns a
  promise; the reader calls it lazily the first time an index query happens.
- Queries: `rowsWithTag(tag)`, `tagsWithCounts()`, `backlinksTo(txHash, n)`,
  `seriesOf(author, name)`, `bodyOf(txHash)`; `subscribe(fn)` fires on change
  so React surfaces re-render (`useSyncExternalStore`).
- `reader.loadPostBody` calls `index.add(row, body)` after every decode, using
  `store.knownPostByTx(txHash, 0)` for the row; when the row is unknown (a body
  fetched by hash only) the index still records the body and fills the row in
  later via `store.subscribe`.
- Honesty rule: every surface built on the index says "among the posts this
  browser has read" and offers the way to read more (Phase 7's note and
  buttons).

### 6.5 Fixtures and the mock node

Extend `fixtureWorld.js` so the demo worlds contain: one reply (`re`) between
two Ethereum posts by different authors; one `supersedes` pair by one author on
Taiko; one three-part `series` on Ethereum with `prev` links between the parts;
a `lang: zh` on the two Chinese posts. `buildPayloadText` (Phase 0) already
serialises `meta`, so `rpcServer.mjs` and `fixtures.js` pick this up when the
bodies carry `meta`; make sure `expectedMergedOrder` and the e2e oracle expose
the relations so specs can find the target posts.

### 6.6 Tests

- Unit: `glyphRefs.test.js` for `parsePostRef` / `formatPostRef` (all forms,
  invalid input, chain prefixes); `payloadText.test.js` for the full vocabulary
  round trip; `bodyIndex.test.js` (add, warm from a stubbed cache, queries,
  subscription, unknown-row upgrade); `publisher` tests for validation
  messages.
- Component: `relationsPanel.test.jsx` renders each relation from `meta` and
  the backlink lists from an index fixture.
- End-to-end (`test/e2e/relations.spec.js`): open the reply, "In reply to"
  links to the parent; open the parent, "Replies" lists the reply after its
  body has been read (visit the reply first in the same session, or rely on the
  feed's excerpt loading which decodes bodies); the superseded post shows the
  banner; the series shows "Part 2 of 3" with previous/next; writing a reply
  from a post pre-fills the field.

### 6.7 Docs and done

- Locale keys under `relations.*` (`heading`, `replyTo`, `supersedes`,
  `continuesFrom`, `series`, `part`, `language`, `inReplyTo`, `replies`,
  `supersededBy`, `continuedIn`, `partOf`, `noSuchPost`, `invalidRef`, `reply`).
- Spec: new §5.1 "Front-matter keys" with the table above and the reference
  grammar; §8.1 mentions the same grammar; §10 rows "Relations" and "Post
  language". README "Writing" and "Reading" paragraphs describe relations in two
  sentences each.
- Done when a reply, an erratum and a three-part series can be written from the
  editor and read back with working links, and old posts without the keys look
  exactly as before.

---

## Phase 7 · Tags and search over what this browser has read

**Goal.** Find posts by tag or by text, honestly scoped to what the browser has
already read, with the way to read more always one click away.

### 7.1 Behaviour

- Tag chips on the post page and in list rows (rows show at most three, from
  the body the row already loads for its excerpt) link to `/tag/<name>`.
- `/tag/<name>` lists every post this browser knows (`store.allPosts()` on each
  chain of the current view) whose body carries the tag, newest first, in the
  ordinary `ArticleListItem` rows, with a header "Tagged <name>" and a
  subtitle "Among the N posts this browser has read". Bodies not yet cached are
  loaded cache-first, at most four in flight per chain, with the list filling
  in as they arrive. At the bottom, the usual "Load earlier posts" control
  deepens the home-feed scan (`view.feed.loadMore()`), so reading more is the
  same action as everywhere else.
- A search icon in the header (folded into the ⋯ menu on narrow screens) opens
  `/search`. The page has one text field; typing (debounced 250 ms) updates
  `?q=` and the results: posts whose title, tags or body contain the query,
  case-insensitive, Unicode-aware (`toLocaleLowerCase`, substring match so CJK
  works without tokenisation). Each result is a row with a snippet around the
  first match (about 160 characters, the match wrapped in `<mark>`). The same
  "among the posts this browser has read" subtitle and the same load-more
  control. An empty query shows the tag cloud from `tagsWithCounts()` instead.

### 7.2 Implementation

- `router.js`: parse `/tag/<name>` (URL-decoded, trimmed) into `params.tag`,
  `/search` into `params.search = '1'` with `params.q` from the query string;
  `buildUrl` writes them (`tag` and `search` in the path, `q` in the query).
- `Reader.jsx` routes to `components/TagPage.jsx` and `components/SearchPage.jsx`.
- New `webapp/src/lib/search.js` (pure): `matchPost({ title, tags, markdown }, query) → { hit, snippet } | null`,
  `snippetAround(text, index, width)`, `normalizeQuery(q)`.
- New hook `useBodiesFor(view, rows)` in `hooks.js`: given
  rows, ensures bodies are loaded through `view.loadPostBody` with the
  concurrency limit and returns `{ loaded: Map<rowKey, body>, pending: number }`.
- `TagPage` and `SearchPage` both use `view.readers.map(r => r.store.allPosts())`
  tagged with chain ids through `timeRows` and sorted with `compareMerged`
  (reuse `timeline.js`).
- `Header.jsx`: a search icon button (add `Search` to `Icons.jsx`) next to the
  language button on wide screens; a menu item in `OverflowMenu`.
- `ArticleListItem`: tag chips under the excerpt (they already have the body).

### 7.3 Tests

- Unit: `search.test.js` (ASCII and CJK matches, case folding, snippet
  boundaries, no match); `router.test.js` for the new routes; `bodyIndex`
  queries for tags.
- Component: `tagPage.test.jsx`, `searchPage.test.jsx` over fixture readers.
- End-to-end (`test/e2e/tags.spec.js`, `search.spec.js`): click a tag chip on a
  fixture post, the tag page lists the posts with that tag from the oracle;
  search for a distinctive word from a fixture body, the post appears with a
  highlighted snippet; the subtitle states the count of posts read; an empty
  query shows the tag cloud.

### 7.4 Docs and done

- Locale keys under `tag.*` (`title`, `scope`, `none`) and `search.*`
  (`title`, `placeholder`, `scope`, `none`, `tagCloud`, `open`).
- README "Reading": tag pages and search, with the scope sentence. Spec §7: a
  paragraph "Local search" stating what is indexed and that nothing is fetched
  beyond what the reader already reads.
- Done when a tag or a word finds every matching post the browser has read, and
  the page never claims completeness it does not have.

---

## Phase 8 · The following feed

**Goal.** Use the design's cheap path. The home feed must scan block ranges
because the contract has no global head pointer, but an author's list is an
O(1) head read plus a reverse-linked walk. A reader who follows a handful of
authors gets a feed that needs no range scan at all.

### 8.1 Behaviour

- Every author page and every post byline offers "Follow" /
  "Following" (a small pill toggle, `components/FollowButton.jsx`). The list is
  kept in this browser (`glyph.following.v1`) and travels in the settings file.
- `/following` (in the Read tab, reachable from a "Following" link in the home
  feed's list header, one click from `/`) shows the newest posts of the followed
  authors across the chains of the current view, merged by time, in the
  ordinary rows, with the same frontier marker logic as the home feed: the list
  is complete only down to the newest "bound" among the (author, chain) walks;
  "Load earlier posts" deepens the walk that sits at the frontier.
- A divider "New since your last visit" sits above the rows newer than the time
  recorded when the page was last left. Leaving the page (unmount or `pagehide`)
  records the newest row's time in `glyph.followingSeen.v1`.
- With no one followed, the page explains itself and links to the home feed.
  With followed authors who have never posted, their absence is stated in the
  subtitle ("3 authors · 1 has not published yet").
- `/settings` shows the followed list (addresses with identicons, ENS names
  from Phase 9 later) with remove buttons, and the export/import carries it.

### 8.2 Implementation

- New `webapp/src/lib/following.js`: `getFollowing() → string[]` (lowercase),
  `follow(addr)`, `unfollow(addr)`, `isFollowing(addr)`, `setFollowing(list)`,
  `FOLLOWING_EVT`, `useFollowing()` (`useSyncExternalStore`), `getSeenTs()`,
  `setSeenTs(ts)`. Validate with `ADDRESS_RE`; dedupe; cap at 500.
- New `webapp/src/lib/followFeed.js`, class `FollowFeed`:
  - Constructed with `{ readers, addresses, pageSize }`. For every (address,
    reader) pair it takes `reader.authorList(address)` (an
    `AuthorListController`; it already persists to the per-chain scan store and
    survives navigation) and subscribes to it.
  - Snapshot: rows = union of every controller's rows, tagged through
    `timeRows(rows, chainId, clock)`, sorted with `compareMerged`, sliced to
    `shown`; per-walk bound computed exactly as `MergedAuthorList.#bound` does
    (extract that function into `timeline.js` as `walkBound(snapshot, rows)`
    and reuse it in both classes); `frontier` from `frontierOf(bounds)` with
    leaders described as `{ chainId, author, state }`; `chains` summary per
    chain (jobs, errors) so the page can reuse `ChainProgress`.
  - `ensureFresh()` calls each controller's `ensureFresh()` and refreshes
    clocks (copy the `#refreshClocks` pattern; consider extracting a
    `ClockSet` helper into `timeline.js` or `rowTimes.js` used by all three
    merged controllers).
  - `loadMore()`: `shown += pageSize`, then while the complete count is below
    `shown`, deepen the walk with the newest bound (`refresh()` if it has no
    rows yet, else `loadMore()`), at most three walks per call (mirror
    `MergedFeed.#more`).
  - `useFollowFeed(feed)` hook.
- `view.js`: `view.followFeed(addresses)` memoised by the sorted address key,
  invalidated when the following list changes (a new instance for a new set;
  controllers are shared through the readers so no walk is repeated).
- `router.js`: `/following` → `params.following = '1'` (chain prefix allowed).
  `Reader.jsx` renders `components/FollowingPage.jsx`.
- `FrontierMarker` gets a `variant="following"` with wording that names authors
  as well as chains when useful (keep it short: "Earlier posts by 2 authors on
  Taiko have not been read yet").
- `settingsFile.js`: export `following: getFollowing()`; import validates each
  entry, summary line "Following: N authors", applies with `setFollowing`.
- `SettingsPage.jsx`: a "Following" section listing the addresses with remove.
- `Header.jsx`: no new tab. The home feed's `ListHeader` subtitle gains a
  "Following" link when the list is non-empty, and `/following`'s header links
  back with "All posts".

### 8.3 Tests

- Unit: `following.test.js` (jsdom; storage, validation, events);
  `followFeed.test.js` over `fakeChain` readers (`ioReader` in
  `mergedHelpers.js`) with three authors on two chains: merged order equals the
  oracle, frontier and leaders correct, `loadMore` deepens the right walk, an
  author with nothing published is handled, an erroring chain leaves the others
  standing; `settingsFile.test.js` for the new key; `timeline.test.js` for
  `walkBound`.
- Component: `followingPage.test.jsx` (empty state, divider placement from a
  stubbed seen time).
- End-to-end (`test/e2e/following.spec.js`): follow two fixture authors from
  their pages, open `/following`, the rows are exactly their posts from the
  oracle in merged order, and no `eth_getLogs` with a range wider than one
  block was issued for the page (inspect `__calls`); reload, the divider marks
  nothing new; unfollow removes the rows; export includes `following`.

### 8.4 Docs and done

- Locale keys under `following.*` (`follow`, `unfollow`, `following`, `title`,
  `subtitle`, `empty`, `emptyBody`, `newSince`, `settingsHeading`, `remove`,
  `neverPublished`, `link`, `allPosts`) and `settingsFile.following`.
- README "Reading": the following feed and why it is cheap (one head read per
  author per chain, no range scan). Spec §7: a section "The following feed"
  explaining it as the intended cheap path; §10 row "Following".
- Done when a reader following three authors gets a complete, correctly
  ordered feed without a single range `eth_getLogs`.

---

## Phase 9 · ENS identity: names in URLs, avatars, profiles

**Goal.** Use the Ethereum Name Service as the identity layer that the contract
deliberately does not have. Today only reverse lookup exists (`reader.ensName`,
mainnet only, shown in bylines). Add forward resolution in URLs, avatars, and a
small profile from text records. Only Ethereum mainnet hosts ENS; an address is
the same on every chain, so a Taiko-only view still asks mainnet (the view
already routes `ensName` that way through `ensReader`).

### 9.1 Behaviour

- `/author/<name>.eth` (and `/taiko/author/<name>.eth`) resolves the name and
  shows that author's page with the name in the header and the address under
  it; the URL keeps the name. An unresolvable name shows "No such name" with
  the address form as the alternative. Author links in the app keep using
  addresses (stable), but when a name is known the link text shows it (this
  already happens in bylines).
- Wherever an identicon appears for an address whose ENS avatar resolves to an
  image URL (`getEnsAvatar`), the avatar is shown instead, same size, same
  rounded square; the identicon returns if the image fails to load.
- The author page gains a profile header when text records exist: `description`
  as a paragraph, `url` as a link, `com.twitter` and `com.github` as small
  links. Nothing is shown when no records exist. All lookups are best effort
  and cached for ten minutes per address.
- The settings and following lists show names where known.

### 9.2 Implementation

- New `webapp/src/lib/ens.js`, over the mainnet reader's client
  (`getReader(1).io` gains `ensAddress(name)`, `ensAvatar(name)`, `ensText(name, key)`
  wrappers with `log.fromNode`, all guarded by the existing "does this chain
  host ENS" check): `isEnsName(str)` (lower-cased, `/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/`),
  `resolveEnsName(name) → address | null` (uses `normalize` from `viem/ens`),
  `ensProfile(address) → { name, avatar, description, url, twitter, github } | null`
  (reverse name first, then records for that name; verify the forward
  resolution of the reverse name matches the address before trusting it).
  TTL caches with `makeTtlCache(() => 10 * 60_000)`. Failures resolve to null.
- `router.js`: `/author/<segment>` accepts either an address (existing) or an
  ENS name → `params.authorName`. `hrefFor({ authorName })` writes it.
- `Reader.jsx`: with `authorName`, render `components/AuthorResolver.jsx` that
  resolves and then renders `AuthorPage` with `author` set and `displayName`
  passed for the header; not-found state otherwise.
- `Address.jsx`: `Identicon` accepts an optional `avatar` URL; `AddressLabel`
  fetches it through a hook `useEnsProfile(address)` (returns undefined while
  loading, null when none) but only renders the avatar once loaded so lists do
  not jump; `onError` falls back.
- `AuthorPage.jsx`: `components/AuthorProfile.jsx` under the `ListHeader`.
- Mock node: extend `rpcServer.mjs` `eth_call` handling so that calls to
  mainnet's ENS universal resolver address (from `viem/chains` `mainnet.contracts.ensUniversalResolver.address`)
  answer `resolve(bytes,bytes)` and `reverse(bytes)` for one fixture name
  `xiaoman.eth` ↔ `AUTHORS[0]`, with `text(node,"description")` returning a
  fixed sentence and every other record empty. Decode the wrapped call with
  viem's ABI helpers; unknown names return the resolver's "not found" revert
  the way viem expects (study viem's `getEnsAddress` to match the encoding).
  Expose the mapping in the oracle so specs can use it.

### 9.3 Tests

- Unit: `ens.test.js` with a fake client (resolution, reverse verification,
  TTL, failure → null, `isEnsName`); `router.test.js` for the name route.
- Component: `addressLabel` with avatar success and failure; `authorProfile`.
- End-to-end (`test/e2e/ens.spec.js`): `/author/xiaoman.eth` shows the fixture
  author's posts and the name in the header; the description appears; an
  unknown name shows the not-found state; the byline of that author's post
  shows the name.

### 9.4 Docs and done

- Locale keys under `ens.*` (`notFound`, `notFoundBody`, `resolving`) and
  `profile.*` (`website`, `twitter`, `github`).
- README "Reading": `/author/name.eth`, avatars and profiles come from ENS on
  mainnet. Spec §7 paragraph "Identity through ENS"; §10 row "Identity".
- Done when a reader can type `/author/<name>.eth` and see the right author,
  and avatars show without layout jumps.

---

## Phase 10 · Reader polish: keyboard, lightbox, print, share and embed

**Goal.** The small things a reading surface owes its readers.

### 10.1 Behaviour

- On a post page, `←` and `→` go to the previous and next post of the same
  author on the same chain when those exist (the cards already resolve them);
  ignored while focus is in an input, textarea, contenteditable or a dialog.
- Clicking an image in the article opens it full size in a native `<dialog>`
  lightbox with the alt text as caption; `Esc`, clicking outside, or a close
  button closes it. Images in the lightbox are the same blob URLs, no refetch.
- A print stylesheet (`@media print` in `index.css`): masthead, footer, back
  button, prev/next cards, share menu and lightbox hidden; the article at full
  width in black on white with the provenance line (block, transaction hash in
  full, chain) printed under the title so a paper copy carries its anchor.
- A share menu (`components/ShareMenu.jsx`, an icon button in the provenance
  line, also present in headless mode) with: "Copy link" (the canonical
  `/chain/tx/0x…/n` URL), "Share…" (Web Share API, shown only when
  `navigator.share` exists), "Copy embed code" (an `<iframe>` snippet pointing
  at the same URL with `?headless=1`, width 100%, a sensible height, `loading="lazy"`,
  `title` set to the post title), "Copy reference" (the Markdown cross-post
  reference `[title](0x<tx>/<n>)` for quoting in another post), and "Reply"
  (Phase 6's pre-filled write tab). Each copy action confirms with a short
  "Copied" notice.

### 10.2 Implementation

- `PostPage.jsx`: a `useEffect` keydown listener (window) checking
  `neighbors.prev/next` and calling `onNavigate`; `components/Lightbox.jsx`
  attached through the existing `onClick` delegation on the article (an `img`
  target opens it); `ShareMenu` uses `clipboard.js` (Phase 0) and
  `hrefFor`/`location.origin` for absolute URLs.
- `index.css`: the print block; give the elements to hide a `data-noprint`
  attribute rather than enumerating classes.

### 10.3 Tests

- Component: keyboard navigation calls `onNavigate` with the right neighbour
  and not from inside an input; lightbox opens and closes; share menu copies
  the expected strings (stub `navigator.clipboard`).
- End-to-end (`test/e2e/polish.spec.js`): arrow key moves to the previous post;
  clicking a fixture image (the Chinese post with `data:` images) opens the
  dialog and `Escape` closes it; "Copy embed code" puts an iframe snippet with
  `?headless=1` on the clipboard (grant clipboard permissions in the test
  context and read it back); `page.emulateMedia({ media: 'print' })` hides the
  masthead.

### 10.4 Docs and done

- Locale keys under `share.*` (`menu`, `copyLink`, `share`, `copyEmbed`,
  `copyRef`, `copied`) and `lightbox.*` (`close`).
- README "Reading": one sentence each for keyboard, lightbox, print and the
  share menu; the embed snippet documented next to `?headless=1`.
- Done when a post can be read with the keyboard, its images inspected, printed
  with its anchor, and quoted or embedded in two clicks.

---

## Phase 11 · Archive bundles: export and import

**Goal.** Turn the spec's "your own backup" layer (§9) into a feature. A
reader can export everything this browser has read, or one author's complete
output, as a single file, and seed another browser from it. This is the
practical answer to history expiry (EIP-4444): a reader years from now loads a
bundle instead of needing an archive node. It is data, not the app; it is
unrelated to the removed single-file offline build.

### 11.1 The format

One JSON document, UTF-8, extension `.xueni.json`:

```json
{
  "glyph": { "archive": 1 },
  "exportedAt": "2026-09-04T12:00:00.000Z",
  "contract": "0x000000AE2f2249c497cfc5F262dd1491634C361C",
  "scope": { "kind": "browser" },
  "posts": [
    {
      "chainId": 1, "txHash": "0x…", "eventIndex": 0,
      "author": "0x…", "index": 5, "block": 25945650, "prevBlock": 25901234,
      "logIndex": 12, "ts": 1757000000, "title": "A letter before the solstice",
      "text": "---\ntags: letters home\n---\n\nXiaoman, …",
      "compressedBytes": 1432
    }
  ],
  "images": [
    { "chainId": 1, "txHash": "0x…", "mime": "image/webp", "base64": "UklGR…" }
  ],
  "authors": [
    { "chainId": 1, "address": "0x…", "head": 25945650, "complete": true }
  ]
}
```

- `scope.kind` is `browser` (everything cached) or `author` with `address`.
- `posts[].text` is the exact on-chain text (Phase 0). Numbers are plain JSON
  numbers (heights stay far below 2^53).
- `authors[]` lists, per chain, the authors whose list was walked completely at
  export time (`complete: true` when the walk reached index 0) with the head
  block it was walked from. Import uses it to claim author coverage.
- Images are base64 because the format must stay one plain JSON file that any
  future tool can read; size is acceptable (a WebP image is ~40 KB, ~55 KB
  encoded).

### 11.2 Behaviour

- `/settings` gains an "Archive" section (`components/ArchiveSection.jsx`):
  "Export everything this browser has read" (counts shown first: N posts, M
  images, per chain), and "Import an archive…" which reads a file, shows a
  review (format, counts per chain, how many are new to this browser, any
  problems), and applies on confirmation.
- The author page gains "Export this author's posts": it first completes the
  author's walk on every chain of the view (calling `loadMore()` until
  `hasMore` is false, with progress), loads every body and image, then
  downloads the bundle. Large authors are fine: progress is shown, the work runs
  in the page, and the download happens at the end.
- Import writes bodies and images into IndexedDB (never overwriting an existing
  record, since content is immutable), records the rows in the per-chain scan
  stores (`rememberPosts`), claims single-block author coverage for every row
  (`rememberAuthorBlock(author, block)`), sets the author scan head for authors
  marked `complete`, persists, and feeds the body index. It never claims
  home-feed coverage (a bundle proves nothing about other authors). After
  import, the imported authors' pages and posts render from cache with no node
  reads; the home feed still scans as before.
- Imported posts whose `contract` field differs from the app's address are
  refused with a clear message.

### 11.3 Implementation

- New `webapp/src/lib/archive.js`: `ARCHIVE_FORMAT = 1`;
  `collectBrowserArchive(readers, { onProgress })` (iterate each chain's
  `store.allPosts()`, `loadPostText` for each, `cache` image records referenced
  by the bodies' `eth:` refs); `collectAuthorArchive(view, author, { onProgress })`;
  `serializeArchive(doc)`; `parseArchive(text) → { doc, problems, summary }`
  (strict validation, unknown keys ignored); `applyArchive(doc, readers) → { posts, images, skipped }`.
  Base64 through a chunked `btoa`/`atob` helper in `webapp/src/lib/base64.js`
  (`bytesToBase64`, `base64ToBytes`; both globals exist in browsers and in
  Node 22, so Phase 12 can share the module).
- `cache.js`: add `hasBody`, `hasImage`, and `iterate(storeName, chainId, fn)`
  (used by `warm()` in Phase 6 as well; if Phase 6 added its own iterator,
  reuse it).
- `download.js` (Phase 5) for the file; `settingsFile.js` untouched (an
  archive is a different document with its own marker `glyph.archive`, refused
  by the settings importer with the existing "not a settings file" problem,
  and vice versa).

### 11.4 Tests

- Unit: `archive.test.js` (jsdom): export from stubbed readers produces the
  documented shape; parse rejects wrong marker, wrong contract, malformed
  rows; apply writes cache records, rows, author coverage and heads, and skips
  existing records; round trip export→import on a fresh store yields identical
  `allPosts()`.
- End-to-end (`test/e2e/archive.spec.js`): browse a few fixture posts, export
  from settings, read the downloaded file, assert counts; in a fresh browser
  context import it, then open an imported post and an imported author page
  and assert (through `__calls` after `__reset`) that no `eth_getTransactionByHash`
  and no author-walk `eth_getLogs` were issued for them; author export from an
  author page includes all of that author's oracle posts with
  `complete: true`.

### 11.5 Docs and done

- Locale keys under `archive.*` (`heading`, `note`, `exportBrowser`,
  `exportAuthor`, `import`, `pickFile`, `reviewCounts`, `reviewNew`,
  `wrongContract`, `applied`, `exporting`, `walking`, `loadingBodies`).
- README: an "Archive" paragraph under Backup and restore, and the format
  summarised. Spec §9: replace the manual checklist's first two items with the
  archive bundle, keep the anchor and verification items, and document the
  format in a new §9.1; §10 row "Archive".
- Done when a bundle exported from one browser makes an author's posts readable
  in another browser with zero node reads for those posts.

---

## Phase 12 · The command-line tool

**Goal.** Publishing, fetching, exporting and verifying from a terminal, for
scripting and bulk work (ten documents in order, a nightly backup). The pure
modules are plain JavaScript already; only the wallet layer is browser-bound.

### 12.1 Shape

- New top-level package `cli/` (`package.json` name `xueni`, `"type": "module"`,
  `"bin": { "xueni": "./bin/xueni.js" }`, `"engines": { "node": ">=22" }`),
  dependencies: `viem` only (Node's `node:zlib` provides brotli, `node:util`
  `parseArgs` the argument parsing, `node:test` the tests). It imports shared
  code from `../webapp/src/lib/` directly (`payloadText.js`, `title.js`,
  `abi.js`, `chains.js`, `glyphRefs.js`'s `parsePostRef`, `base64.js`) exactly
  as `test/e2e/rpcServer.mjs` already does. Nothing under `webapp/src/lib`
  that the CLI imports may touch `import.meta.env`, `window` or React (Phase 0
  made the address Node-safe; keep it that way, and add a CLI test that imports
  each shared module in plain Node).
- Configuration: `--rpc <url>` (repeatable, ordered) overrides the chain's
  default endpoints from `chains.js`; `PRIVATE_KEY` from the environment (never
  an argument); `--chain <slug|id>` selects the chain (`ethereum`, `taiko`,
  or `all` where reading).

### 12.2 Commands

- `xueni publish <file.md> --chain <slug> [--title <text>] [--tags a,b] [--image key=path]… [--dry-run] [--json]`
  Reads the file with `parsePayloadText`; title from `--title`, else the
  file's `title:` front-matter, else the first heading, else the file name
  (same rules as Phase 5); refuses a title over 32 bytes. Images: Node has no
  canvas, so the CLI does not transcode. Each `--image imgN=path` must be a
  `.webp` file already (others are refused with a message pointing at the web
  app or a converter); the CLI checks it against the size ceiling
  (`MAX_CALLDATA_BYTES` from `limits.js`, Phase 0), sends each as a
  self-transaction, rewrites `upload:imgN` to `eth:0x…`. Then measures the
  payload against the ceiling, publishes, waits for the receipt, and prints the
  transaction hash and the canonical URL. `--dry-run` prints the payload text,
  its compressed size, the estimated gas, and sends nothing. `--json` prints a
  machine-readable result.
- `xueni fetch <slug> <txhash>[/<n>] [--raw] [--json] [--images <dir>]`
  Reads the receipt and transaction, decodes title and payload, prints the
  Markdown (default), the exact on-chain text (`--raw`), or a JSON record
  (`--json`, the same shape as an archive post); `--images` saves referenced
  images as `<txhash>.webp` into the directory and rewrites the references to
  those files in the printed Markdown.
- `xueni author <slug|all> <address> [--limit N] [--json]`
  Lists titles newest first by walking `latestBlock` and `prevBlock` (one
  `eth_getLogs` per block, single-block, exactly like the reader), for one or
  every chain.
- `xueni export <address> --out <dir> [--chain <slug|all>]`
  Walks the author completely on each chain, writes one `.md` per post named
  `<chain>/<yyyy-mm-dd>-<index>-<slug>.md` (exact text), images under
  `<chain>/images/`, and an `archive.xueni.json` in the Phase 11 format with
  `scope.kind = "author"` and `complete: true`, importable by the web app.
- `xueni verify <file.md> <slug> <txhash>[/<n>]`
  Fetches the post and compares the on-chain text with the file byte for byte
  (after normalising line endings to `\n`); exit code 0 on a match, 1 with a
  unified diff otherwise.

### 12.3 Implementation notes

- `cli/src/chain.js`: a viem public client per chain over the ordered endpoint
  list with a simple sequential failover (no cool-down needed in a one-shot
  tool); `cli/src/wallet.js`: `privateKeyToAccount` + `createWalletClient`.
- `cli/src/walk.js`: the author walk and `postsInTx`, mirroring `chainIO.js`
  and `scanner.authorRowsAt` without the store.
- Output is plain text by default and JSON with `--json`; errors go to stderr
  with exit code 1; `--help` for every command.
- The e2e mock node is the CLI's test node: `cli/test/*.test.js` (`node --test`)
  start `../webapp/test/e2e/rpcServer.mjs` on a free port, point the CLI at
  `http://127.0.0.1:<port>/rpc/default/<chainId>` and assert `fetch`,
  `author`, `export` and `verify` against the oracle. `publish` is tested with
  `--dry-run` (payload bytes equal `encodePayload`'s output for the same input,
  computed with `node:zlib` in the test) and, for the sending path, against a
  local Anvil node when `ANVIL=1` is set (optional locally, not in CI).
- CI: add a job `cli` to `.github/workflows/ci.yml` running `npm ci` in both
  `webapp` (the mock node needs its dependencies) and `cli`, then `npm test`
  in `cli`.

### 12.4 Docs and done

- `cli/README.md` with every command, and a "Command line" section in the root
  README pointing to it. Spec §11: dependencies and a paragraph on the CLI
  sharing the payload layer. `.codewhale/instructions.md`: the `cli/` path.
- Done when `xueni export` of a fixture author round-trips through the web
  app's archive import, and `xueni verify` confirms a downloaded `.md`.

---

## Phase 13 · The macOS desktop app

**Goal.** Ship Xueni as a downloadable macOS application built from the same
web app, with the build in CI, releases on GitHub, and a download link in the
README. The reader is a single-page app with no server, so a desktop version
is a thin shell around `webapp/dist`.

**Decision: Tauri 2, not Electron.** Tauri wraps the system WebKit view in a
small Rust shell: the download is around ten megabytes instead of the two
hundred an Electron app carries, there is no bundled browser to keep patched,
and `tauri-apps/tauri-action` builds, signs and publishes to GitHub Releases
from a macOS runner. The price is two WebKit gaps the shell has to fill, both
handled below: WebKit cannot encode WebP from a canvas, and a WKWebView does
not honour `<a download>`. Electron would avoid both but contradicts the
project's preference for small, long-lived things. Windows and Linux builds
are out of scope for this phase; with Tauri they are a CI matrix change later.

**Human checkpoints.**
- The desktop build needs `WALLETCONNECT_PROJECT_ID` as a repository secret
  (the same ID as Phase 2). Inside the app there is no browser extension, so
  WalletConnect is the only way to sign. Without the secret the app still
  builds and reads; the write tab says that this build cannot publish.
- Signing and notarisation need an Apple Developer ID and the secrets
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`. They are optional: without
  them the DMG is ad-hoc signed, Gatekeeper warns on first launch, and the
  README explains right-click → Open. Ask the owner whether they exist, and do
  not wait for them.
- The first release tag (`v0.1.0`) is pushed on `main` after this phase's PR
  is merged, so that the README link resolves. Push it if you have the rights;
  otherwise ask the owner to.

### 13.1 Behaviour

- A universal (Apple Silicon and Intel) `.dmg` for macOS 13 or later, app name
  "Xueni", the icon from `webapp/public/icon.svg`, a standard macOS menu, a
  1100×800 window that remembers its size and position, following the system
  appearance as the web app does.
- Everything the web app does works in the app: reading both chains, the
  caches (IndexedDB and localStorage persist in the app's WebKit data store),
  settings, import and export, and writing through WalletConnect, with the QR
  code scanned by a mobile wallet. Publishing images works because the shell
  transcodes to WebP natively (13.2).
- Links to other sites (explorers, ENS profile URLs) open in the default
  browser, never inside the app. Every download the web app offers (the
  Phase 5 `.md`, Phase 11 archives, the settings export) opens a native save
  dialog.
- Reloading (⌘R) on any route, and quitting on a post page and reopening, land
  on a working page: the shell serves `index.html` for every path that is not
  a bundled file, the rule `vercel.json` and `test/e2e/serve.mjs` implement.
- Once a day the app asks GitHub for the latest release
  (`https://api.github.com/repos/dantaik/glyph/releases/latest`) and, when it
  is newer than the running version, shows a quiet dismissible line in the
  footer: "Xueni <version> is available · Download". Best effort: a failure
  shows nothing. A dismissal is remembered per version
  (`glyph.desktop.updateSeen.v1`). This is the one desktop-only network call
  outside RPC, listed among the accepted exceptions in section 2.2.

### 13.2 Implementation

- New top-level directory `desktop/`:
  - `desktop/package.json` (private; scripts `dev`, `build`, `icon`; the only
    devDependency is `@tauri-apps/cli` 2.x). `desktop/src-tauri/` holds
    `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `icons/`
    (generated by `npm run icon` from `webapp/public/icon.svg`), and
    `src/main.rs` with `src/lib.rs`.
  - `tauri.conf.json`: `productName` "Xueni", `identifier` `xyz.xueni.app`,
    `build.beforeBuildCommand` `cd ../webapp && npm run build`,
    `build.frontendDist` `../webapp/dist`, `build.devUrl` the Vite dev server,
    `app.withGlobalTauri: true` so the web app reaches the shell through
    `window.__TAURI__` and adds no npm dependency, one window as above, and
    the macOS bundle settings (`minimumSystemVersion` "13.0", the DMG target).
  - Rust: plugins `tauri-plugin-opener` (external links), `tauri-plugin-dialog`
    and `tauri-plugin-fs` (save dialog and file write), `tauri-plugin-window-state`
    (window size and position); one command
    `transcode_image(bytes, max_edge, quality) -> Vec<u8>` that decodes and
    resizes with the `image` crate (longest edge to `max_edge`, Lanczos3) and
    encodes lossy WebP at `quality` (0 to 100) with the `webp` crate (libwebp);
    and a custom URI scheme protocol, or the equivalent asset-resolver hook,
    that answers `index.html` for any path that is not a bundled file.
    Capabilities grant only what these plugins and this command need.
- Web app changes, all feature-detected so the website is unaffected:
  - New `webapp/src/lib/platform.js`: `isDesktop()` (true when
    `window.__TAURI__` exists), `invoke(cmd, args)`, `openExternal(url)`,
    `saveFile(name, blob)` (dialog then fs), `desktopVersion()`; every one a
    no-op or null on the web.
  - `download.js` (Phase 5): `downloadText` and `downloadBlob` call `saveFile`
    when `isDesktop()`, else the anchor path.
  - `publish.js` `processImage`: after the canvas encode, check `blob.type`.
    A browser that cannot encode WebP returns PNG bytes under the type it was
    asked for, which today would be uploaded as if they were WebP: on the web,
    throw the existing `error.noWebp` when the type is not `image/webp`. On
    desktop, skip the canvas and call `invoke('transcode_image', …)` inside
    the same size loop (lower the quality until the bytes fit, stop at 30).
  - `App.jsx`: one delegated click handler that, when `isDesktop()`, sends
    any `http(s)` link to another origin through `openExternal`; in-app links
    keep going through the router.
  - `WalletPanel`: when `isDesktop()` and no provider is available, say that
    publishing from the app uses WalletConnect, and when the build carries no
    project ID, that this build cannot publish. Reading is unaffected.
  - `components/UpdateNotice.jsx` in the footer, desktop only (13.1), reading
    the running version through `desktopVersion()`.
- CI: new `.github/workflows/desktop.yml`:
  - Triggers: push of tags `v*` (a release); pushes to `main` and pull requests
    that touch `desktop/**` or the workflow file (build only, the DMG uploaded
    as a workflow artifact); `workflow_dispatch`.
  - One job on `macos-latest`: checkout; Node 22 with the npm cache keyed on
    `webapp/package-lock.json`; `npm ci` in `webapp` and in `desktop`; stable
    Rust with the targets `aarch64-apple-darwin` and `x86_64-apple-darwin`
    (`dtolnay/rust-toolchain`); `Swatinem/rust-cache` for `desktop/src-tauri`;
    `cargo test` in `desktop/src-tauri`; `tauri-apps/tauri-action@v0` with
    `projectPath: desktop` and `args: --target universal-apple-darwin`, the
    environment `VITE_WALLETCONNECT_PROJECT_ID: ${{ secrets.WALLETCONNECT_PROJECT_ID }}`
    and the Apple signing variables from secrets (empty when unset, which
    tauri-action treats as "do not sign"); on a tag, `tagName: ${{ github.ref_name }}`,
    `releaseName: Xueni ${{ github.ref_name }}`, release notes from the tag
    message, not a draft. A final tag-only step copies the built DMG to
    `Xueni-macOS.dmg` and uploads it to the same release
    (`gh release upload <tag> Xueni-macOS.dmg --clobber`), so the README link
    never changes between versions.
  - A guard step on tags: the tag equals `v` followed by the `version` in
    `tauri.conf.json` and in `desktop/package.json`, or the job fails before
    building.
  - `ci.yml` is unchanged: the fast checks stay fast.
- The release procedure, documented in `desktop/README.md`: bump the version
  in both files, commit, tag `v<version>`, push the tag; the workflow
  publishes the release in about fifteen minutes.

### 13.3 Tests

- Unit (`platform.test.js`, jsdom): the web no-ops; with a fake
  `window.__TAURI__`, `saveFile` opens the dialog and writes, `openExternal`
  calls the opener. `download.test.js` and `publish.test.js` cover the desktop
  branches and the new `blob.type` check (a PNG-typed blob throws
  `error.noWebp` on the web).
- Rust (`cargo test` in `desktop/src-tauri`, run by the workflow before the
  build): `transcode_image` turns a generated 3000×2000 PNG into WebP bytes
  (`RIFF….WEBP` header) no wider than `max_edge`, and a lower quality yields
  fewer bytes.
- Smoke test in the workflow after the build: mount the DMG (`hdiutil attach`),
  assert `Xueni.app` exists, `codesign -dv` succeeds, and `lipo -archs` on the
  binary lists both architectures. WebDriver-driven end-to-end testing of
  Tauri apps is not available on macOS; the web behaviour is covered by the
  existing Playwright suite.

### 13.4 Docs and done

- README: a "Download for macOS" paragraph near the top with the stable link
  `https://github.com/dantaik/glyph/releases/latest/download/Xueni-macOS.dmg`,
  the requirements (macOS 13 or later, Apple Silicon and Intel), how the
  current build is signed and what to do when Gatekeeper warns, and a pointer
  to `desktop/README.md` for building locally. Spec §9 gains a sentence: the
  desktop app carries the same permanent caches, so it is one more place a
  reader's copy lives; §10 row "Desktop app". `.codewhale/instructions.md`:
  the `desktop/` path and the workflow.
- Locale keys under `desktop.*` (`updateAvailable`, `download`, `dismiss`,
  `walletConnectOnly`, `noPublishInThisBuild`).
- Done when a tag push produces a GitHub Release with a universal DMG, the
  README link downloads it, the app reads both chains and publishes a post
  with an image through WalletConnect, and the web build is unchanged.

---

## Phase 14 · Closing sweep and deletion of this plan

**Goal.** Leave the repository consistent, documented, and free of this plan.

1. **Documentation sweep.** Read `README.md` and `glyph-spec.md` end to end
   against the app as it now is. Every feature added by phases 1 to 13 is
   described where a reader would look for it; the design decision record
   (§10) has one row per decision this plan made (drafts, wallet transport,
   cost history, image ledger, raw view and round trip, relations, local
   search, following, identity, archive, CLI, desktop app). The table of
   contents matches the headings. `.codewhale/instructions.md` lists every new
   module, the `cli/` package and the `desktop/` shell.
2. **Locale sweep.** `locales.test.js` is green; read both dictionaries once
   for wording consistency (English sentences in the style of the existing
   ones; Chinese that says the same thing).
3. **Dead code and stale comments.** Search for references to behaviour this
   plan replaced (for example `window.ethereum` outside `wallet.js`, the moved
   `copyToClipboard`, `splitFrontMatter` in `payload.js`) and remove them.
4. **Full verification.** `cd webapp && npm run check` and `cd cli && npm test`
   green; the last run of the desktop workflow green; a production build; a manual pass over every page in DEV fixtures
   mode (`npm run dev` then `/?fixtures=1`) in both languages and both themes,
   on a narrow viewport too.
5. **Delete this file.** Remove `IMPLEMENTATION_PLAN.md`. Grep the repository
   for `IMPLEMENTATION_PLAN` and remove any mention (the PR that added the
   plan may have left one in the README or `.codewhale/instructions.md`).
6. **The final PR** describes what the whole programme delivered, links the
   fourteen merged PRs, and states the test counts before and after.

---

## Appendix A · Locale key namespaces added by this plan

`draft.*` (1) · `wallet.*` additions (2) · `cost.*` additions (3) · `image.*`
additions (4) · `raw.*`, `export.*` (5) · `relations.*` (6) · `tag.*`,
`search.*` (7) · `following.*`, `settingsFile.following` (8) · `ens.*`,
`profile.*` (9) · `share.*`, `lightbox.*` (10) · `archive.*` (11) ·
`desktop.*` (13). The CLI has its own English-only messages in
`cli/src/messages.js`.

## Appendix B · New modules by phase

| Phase | `webapp/src/lib` | `webapp/src/components` | elsewhere |
|---|---|---|---|
| 0 | `payloadText.js`, `clipboard.js`, `limits.js` | | `test/unit/locales.test.js` |
| 1 | `drafts.js` | (inline in `Publisher`) | |
| 2 | (`wallet.js` extended) | `WalletChooser.jsx` | dependency `@walletconnect/ethereum-provider` |
| 3 | `gasHistory.js`, `async.js` | (`GasSparkline` inside `CostPanel`) | |
| 4 | `imageLedger.js`, `imageKeys.js` | | |
| 5 | `markdownImport.js`, `download.js` | `RawView.jsx`, `ImportMarkdown.jsx` | |
| 6 | `bodyIndex.js` (`glyphRefs.js`, `payloadText.js` extended) | `RelationsFields.jsx`, `RelationsPanel.jsx` | fixture relations |
| 7 | `search.js` | `TagPage.jsx`, `SearchPage.jsx` | |
| 8 | `following.js`, `followFeed.js` | `FollowingPage.jsx`, `FollowButton.jsx` | |
| 9 | `ens.js` | `AuthorResolver.jsx`, `AuthorProfile.jsx` | mock ENS resolver |
| 10 | | `Lightbox.jsx`, `ShareMenu.jsx` | print CSS |
| 11 | `archive.js`, `base64.js` | `ArchiveSection.jsx` | |
| 12 | | | `cli/` package, CI job |
| 13 | `platform.js` (`download.js`, `publish.js` extended) | `UpdateNotice.jsx` | `desktop/` Tauri shell, `.github/workflows/desktop.yml` |

## Appendix C · Things this plan deliberately leaves out

- Any change to `contracts/src/Blog.sol`, the CREATE2 salt, or the deployed
  address. The repository owner decided the contract stays as it is.
- A server, an indexer, a relay for content, or a PWA/offline build.
- Windows and Linux desktop builds, and the Tauri auto-updater (it needs
  signing keys and an update manifest); the macOS app only notices that a
  newer release exists.
- Automatic publishing when gas is cheap (a wallet must sign at send time; the
  cost history informs the writer instead).
- Image transcoding in the CLI (no canvas in Node; the web app transcodes).
- Migration of anything already on chain: the format is unchanged and every
  existing post reads exactly as before.
