# Xueni — a writing system that lives entirely on Ethereum

> Technical design and reference implementation · 2026-06
>
> A multi-author blog that keeps all of its content — text and images — in
> Ethereum L1 calldata. No off-chain dependencies, designed to outlive its
> authors and still be readable by their children decades from now.
> Product name: **雪泥**, written **Xueni** in English (from the idiom 雪泥鸿爪 —
> the prints a wild goose leaves in the snow). The Solidity contract keeps its
> original name, `Glyph` — renaming it would move its deterministic address.

---

## Table of contents

1. [Core principles](#1-core-principles)
2. [Architecture](#2-architecture)
3. [Cost](#3-cost)
4. [The contract, `Blog.sol`](#4-the-contract-blogsol) (contract name `Glyph`)
5. [Payload encoding (`payload.js`)](#5-payload-encoding-payloadjs)
6. [The publish pipeline, `publish.js`](#6-the-publish-pipeline-publishjs)
7. [The reader, `blogReader.js`](#7-the-reader-blogreaderjs)
8. [The Markdown subset, and rendering](#8-the-markdown-subset-and-rendering)
9. [Permanence and self-hosting](#9-permanence-and-self-hosting)
10. [Design decision record](#10-design-decision-record)
11. [Appendix: constants, dependencies, deployment](#11-appendix-constants-dependencies-deployment)

---

## 1. Core principles

- **Trust Ethereum and nothing else.** Text, titles, tags and image bytes all go into calldata. No IPFS, no Arweave, no server of any kind.
- **One contract, any number of authors.** The contract is **non-upgradeable and ownerless**; every `msg.sender` is its own author, and one author's stream never touches another's. Authorship is the wallet address — no registration, no permission.
- **Store plain Markdown (a subset).** Open, human-readable, and openable in any editor forever.
- **Compress the body with brotli q11**, no custom dictionary; the decoder needs no side data.
- **An image is published once.** The processed bytes are hashed and the transaction that carried them is remembered per chain, so reusing a photograph costs a reference rather than a second transaction (`imageLedger.js`). Local and best-effort: another browser pays once itself, and clearing site data costs one duplicate, never correctness.
- **Images: WebP at q60, each one its own plain-calldata transaction**, with the 32-byte tx hash written into the Markdown (`eth:0x...`).
- **O(1) "latest post" per author, plus a reverse block-linked list**: a read only ever queries a single block, never a block range.
- **Title, tags and body live at different layers**:
  - Title = `bytes32` (its own calldata argument, and in the event, so a "list of titles" query costs nothing to decompress)
  - Body + tags = a brotli-compressed **Markdown document (with an optional YAML front-matter block of tags)**, kept **only in the publish() transaction's calldata**, never in the event.
  - The reader calls `getLogs` for a batch of titles (no bodies), then `getTransactionByHash` for a body when one is opened.
- **The home feed (no address) = the most recent N posts across authors**: a bounded client-side scan (see §7). This is the one deliberate range scan in the whole design, used only for discovery when no address is given; the single-author path stays O(1).
- **Permanence = an on-chain anchor plus your own backup as a fallback** (see §9), **plus a permanent local cache in the browser's IndexedDB** (see §7).

---

## 2. Architecture

```
Author side (publish.js)                        On chain (Ethereum L1)
────────────────────────                        ──────────────────────
draft = { title, tags[], markdown, files[] }    each image = one plain-calldata tx
  │                                               to=self, data=WebP bytes  → txhash
  ▼
1. each image → WebP q60 → calldata self-send → txhash
2. rewrite upload:KEY into eth:0x<txhash>
3. payload = brotli( [optional ---\ntags: a, b\n---] + markdown utf8 )
4. title32 = utf8(title) right-padded with zeros to 32 bytes
5. publish(title32, payload)                    the Glyph contract (shared, ownerless):
      │                                           emit Post(msg.sender, index, prevBlock, title32)
      ▼                                           state[msg.sender] = {latestBlock=now, count+=1}
                                                  *payload bytes stay in the tx calldata; the event carries none*
Reader side (blogReader.js)
───────────────────────────
A. the title list (no bodies)
  1. eth_call latestBlock(author)     ← O(1) head pointer
  2. eth_getLogs(one block, author=…) ← title + index + prevBlock
  3. walk back along prevBlock, rendering titles (no body decompressed)

B. opening one post
  4. eth_getTransactionByHash(log.txHash).input
  5. decodeFunctionData → take the payload bytes
  6. brotli decompress → { tags, markdown }
  7. resolve eth:0x<hash> image refs → eth_getTransactionByHash(hash).input → Blob
  8. render the Markdown subset
```

**Three kinds of data, three places to keep them:**

| Content | Encoding | How it goes on chain | Where it lives |
|---|---|---|---|
| Title | UTF-8 → right-padded to 32 bytes | publish() bytes32 argument + a non-indexed event field | event log data |
| Body + tags | brotli q11 of Markdown (+ front-matter) | publish() bytes argument | the publish transaction's calldata |
| Images | WebP q60 | a separate plain-calldata self-send | transaction history, referenced by txhash |

> **Why isn't the body in the event?** One `eth_getLogs` pulls all of `log.data` back to the client. For "show a page of 20 titles" to be cheap, the body must not be in the event — this was the key architectural change in v2. Putting the body in the publish transaction's calldata (which the contract never reads) both saves the ~20% extra gas that LOG data costs and gives the title-list query a fixed bandwidth.

**Author discovery is out-of-band.** The front end takes the author's address from the URL (`?author=0x…`); the contract keeps no "author directory" at all, and stays minimal. **When the home page is opened with no address**, the front end falls back to one bounded scan of recent blocks to list the newest N posts network-wide (best-effort, see §7) — without changing the contract.

---

## 3. Cost

Basis: plain calldata is priced at the **EIP-7623 floor**: `tokens = zero bytes + 4 × non-zero bytes`, floor cost `= 10 gas/token`, i.e. **40 gas per non-zero byte, 10 per zero byte**. Compressed data is almost entirely non-zero bytes.

**The general formulas**
```
one plain-calldata tx:      gas ≈ 21,000 + 40 × bytes
one article tx (v2):        gas ≈ 21,000
                                + 40 × (4 + 32 + payload bytes)  ← selector + title + payload
                                + 64 × 10                        ← ABI offset/length (mostly zero bytes)
                                + ~1,893                         ← LOG: signature + author topics, 96B of data (EIP-2929)
                                + 200                            ← warm SLOAD + warm SSTORE (packed slot, EIP-2929)
                                + (first post +~24,000)          ← cold SLOAD + cold slot initialisation
```

**Body (one post of ~1,000 Chinese characters, with 2 tags)**
About 1,400–1,600 bytes after brotli; the whole publish transaction is around **~85,000 gas** (about 15% less than v1, which put the body in the event).
At ~0.23 gwei and ETH ≈ $1,690: **≈ $0.033 per post, ≈ $33 for a thousand**.

**Images (measured on this repository's sample image, 1310×772)** — by encoding:

| Version | Bytes | Gas | ≈USD @ 0.23 gwei |
|---|---|---|---|
| Original PNG | 135,979 | 5.42M | $2.11 |
| WebP q82 | 71,466 | 2.87M | $1.12 |
| **WebP q60 (what this design uses)** | **43,264** | **1.75M** | **$0.68** |
| WebP q40 | 33,404 | 1.35M | $0.53 |
| Thumbnail q60 @400px | 9,270 | 0.39M | $0.15 |

**When you publish is the biggest lever on cost** (a factor of 100). Schedule images for a gas trough.

> **When to publish, seen from the chain.** `gasHistory.js` samples one block header an hour for the
> last day (`eth_getBlockByNumber`, at most four in flight, held ten minutes) and reads `baseFeePerGas`
> off each. That is the whole source: no gas oracle, no price feed, nothing to be blocked beyond the
> node the reader already uses. Each chain is sampled at its own measured pace, so an hour is ~300
> blocks on Ethereum and ~1,800 on Taiko. A header the node refuses is dropped, not fatal.
>
> Live cost estimate in the front end (`price.js`): it pulls `eth_gasPrice` from the node and ETH/USD from CoinGecko's public API (cached 60s), estimates the payload at brotli ≈ 0.45× the raw size, and shows a live "≈$X.XX body + $Y.YY per image" panel. CoinGecko is the one off-chain HTTP dependency; when it is blocked, rate-limited or offline the panel degrades to `ethUsd=null` and shows ETH only.

---

## 4. The contract, `Blog.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Blog {
    struct AuthorState {
        uint96 latestBlock; // 0 = author has never posted
        uint48 count;       // total posts by this author (== next post's index)
    }
    mapping(address => AuthorState) private _authors;

    event Post(
        address indexed author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title
    );

    function latestBlock(address author) external view returns (uint256) {
        return _authors[author].latestBlock;
    }

    function count(address author) external view returns (uint256) {
        return _authors[author].count;
    }

    /// @notice Publish one article.
    ///         `payload` rides in the tx calldata only — the contract never
    ///         reads it. Off-chain schema: brotli(Markdown + optional YAML front-matter tags).
    function publish(bytes32 title, bytes calldata payload) external {
        payload; // silence "unused parameter" warning
        AuthorState memory s = _authors[msg.sender];
        emit Post(msg.sender, s.count, s.latestBlock, title);
        _authors[msg.sender] = AuthorState({
            latestBlock: uint96(block.number),
            count: s.count + 1
        });
    }
}
```

**The points that matter**

- **No owner, no constructor arguments.** Any address can `publish()`, and the deployer has no privilege of any kind.
- **`payload` never enters contract logic; it only sits in the tx calldata.** The reader gets it back with `eth_getTransactionByHash(log.transactionHash).input` and then `decodeFunctionData` to recover `(bytes32, bytes)`. This keeps the event data tiny — a title-list query only ever downloads ~96 bytes per post.
- **`author` is indexed**, so the reader can use `eth_getLogs({ args: { author } })` to pick that author's logs precisely out of a single block. It costs +375 gas per post.
- **A packed slot**: `uint96 + uint48 = 144 bits < 256`, so the whole `AuthorState` occupies one slot and each publish is one warm SSTORE. The first post pays the cold-slot fee once (~22k gas).

---

## 5. Payload encoding (`payload.js`)

Decompressed, the payload is simply **a human-readable Markdown document**, with the tags in an optional **YAML-style front-matter** block:

```
---
tags: family, travel, mountains
---

# A weekend in the hills
The body…
```

**With no tags, the payload is pure Markdown** — no wrapper at all, maximising "any editor, decades later, opens it directly". The payload finally published is `brotli(q11)(utf8(text))`.

The text layer — building that document and taking it apart — lives in
`payloadText.js`, which imports nothing, so plain Node shares it: the e2e mock
node builds bodies with it and the command-line tool encodes with it.
`payload.js` is only the brotli boundary on top, and what it hands back
includes `text`, the exact document the chain holds, so the raw view, a `.md`
download and an archive bundle can all carry it byte for byte.

### 5.1 Front-matter keys

All optional. A reader that does not know a key ignores it, and a key it does not know survives a
decode/encode round trip untouched — which is what makes this an extension point rather than a fixed
list.

A **post reference** is `[<chainSlug>:]0x<64 hex>[/<eventIndex>]`: the publish transaction, an optional
0-based ordinal for the Post event inside it (default 0), and an optional chain prefix (`taiko:`,
`ethereum:`). With no prefix the reference means the chain the referring post is on.

| Key | Value | Meaning |
|---|---|---|
| `tags` | `a, b` | free-form labels |
| `lang` | BCP 47, e.g. `zh` | the language the post is written in; becomes the article's `lang` |
| `re` | post reference | this post replies to that one |
| `supersedes` | post reference | this post replaces that one — the only honest edit on an immutable chain |
| `prev` | post reference | this post continues that one |
| `series` | text, ≤ 64 chars | the name of a series, belonging to its author |
| `part` | positive integer | this post's number within `series` |

Forward relations are read from the post itself and are as durable as it is. The reverse — replies,
continuations, a newer version — cannot be asked of a node, because it would mean filtering on the
inside of compressed calldata. They come instead from `bodyIndex.js`, a per-chain index of the bodies
THIS BROWSER has read (warmed from the IndexedDB cache on first use), and every surface built on it
says so rather than implying completeness. An index that fetched more would be a crawler; one that
claimed more would be lying.

**Why front-matter rather than a custom binary format?**
- It has been a stable, universal convention for 15 years (Jekyll, Hugo, Obsidian and every static-site generator understand it), and does not depend on this app.
- Decompressed, it is directly readable by a person — which is the core principle.
- Front-matter is itself the extensibility mechanism: new keys can be added later and older readers simply ignore what they do not recognise. No version byte needed.
- Tags and body share one brotli stream, and so share its learned dictionary (`travel` compresses tighter when it appears both as a tag and in the body).

The parser is deliberately conservative: front-matter is only recognised when the first line is exactly `---`, a closing `---` exists, and every line between them is `key: value`; otherwise the whole thing is treated as pure Markdown (so a `---` rule at the top of a body is not mistaken for a header).

```js
import { getBrotli } from './brotli';
const enc = new TextEncoder(), dec = new TextDecoder();

export async function encodePayload({ tags = [], markdown }) {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  const text = clean.length
    ? `---\ntags: ${clean.join(', ')}\n---\n\n${markdown || ''}`
    : (markdown || '');
  return (await getBrotli()).compress(enc.encode(text), { quality: 11 });
}

export async function decodePayload(compressed) {
  const text = dec.decode((await getBrotli()).decompress(compressed));
  const { meta, body } = splitFrontMatter(text);   // tiny hand-rolled parser, no YAML lib
  const tags = meta.tags
    ? meta.tags.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return { tags, markdown: body };
}
```

**Title encoding (`title.js`)**: the UTF-8 bytes right-padded with zeros to 32. Reading back, trailing zero bytes are trimmed and the rest goes through `TextDecoder`. `titleByteLength()` lets the UI show "X / 32 bytes" — an ASCII character is 1 byte, a Chinese character 3, an emoji 4, so **the editor must limit by bytes, not characters**.

---

## 6. The publish pipeline, `publish.js`

A browser module. Authorship is the connected wallet's address; the contract performs no identity check at all.

Which wallet signs is `wallet.js`'s business, not this module's: it lists whatever announced itself
through EIP-6963 (and WalletConnect where the build carries a project id), remembers the choice, and
hands the chosen EIP-1193 provider to viem's `custom()` transport here.

```js
import { createWalletClient, custom, toHex } from "viem";
import { mainnet } from "viem/chains";
import { encodeTitle } from "./title";
import { encodePayload } from "./payload";

const GLYPH = "0xYourGlyphContractAddress";
const abi  = parseAbi(["function publish(bytes32 title, bytes payload) external"]);

const wallet = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
const [account] = await wallet.getAddresses();

// 1. Image: downscale to <=1600px long edge, encode WebP q60, return bytes.
async function processImage(file, { maxEdge = 1600, quality = 0.6, maxBytes = 200_000 } = {}) {
  /* ... see the repository for the real thing ... */
}

// 2. Store image bytes as the calldata of a plain self-tx; return its 32-byte tx hash.
async function storeImage(bytes) {
  return wallet.sendTransaction({
    account, to: account, data: toHex(bytes), value: 0n,
  });
}

// 3. Replace `upload:KEY` refs with `eth:0x<txhash>` after uploading.
async function embedImages(markdown, files) { /* ... regex-replace the image refs ... */ }

// 4. Encode payload + title, publish().
export async function publishPost({ title, tags = [], markdown, files = {} }) {
  const finalMd = await embedImages(markdown, files);
  const payload = await encodePayload({ tags, markdown: finalMd });
  return wallet.writeContract({
    account, address: GLYPH, abi, functionName: "publish",
    args: [encodeTitle(title), toHex(payload)],
  });
}
```

---

## 7. The reader, `blogReader.js`

Every read needs an author address, which the front end takes from the URL: `/author/0x…` for an author's list, `/tx/0x…/<event index>` for a single post (one transaction may hold several Post events). **Loading is in two stages**: the title list carries no bodies, and a body is only fetched when a post is opened.

**Local cache**: every body and image is cached permanently in IndexedDB (`glyph-cache`). The content is immutable (it is on-chain calldata), so the cache never expires. A cache hit costs zero network requests.

```js
import {
  createPublicClient, http, parseAbi, hexToBytes, decodeFunctionData,
} from "viem";
import { mainnet } from "viem/chains";
import { decodeTitle } from "./title";
import { decodePayload } from "./payload";

const abi = parseAbi([
  "function latestBlock(address author) view returns (uint256)",
  "function count(address author) view returns (uint256)",
  "function publish(bytes32 title, bytes payload) external",
  "event Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)",
]);

const client = createPublicClient({ chain: mainnet, transport: http("https://YOUR_RPC") });
const POST_EVENT = abi.find((x) => x.type === "event" && x.name === "Post");

async function postsInBlock(author, block) {
  const logs = await client.getLogs({
    address: GLYPH, event: POST_EVENT, args: { author },
    fromBlock: block, toBlock: block,
  });
  logs.sort((a, b) => Number(b.args.index - a.args.index));
  return logs;
}

const toMeta = (log, block) => ({
  author: log.args.author, index: log.args.index, block,
  prevBlock: log.args.prevBlock, txHash: log.transactionHash,
  title: decodeTitle(log.args.title),
});

// A. Title list — no body bytes downloaded.
export async function loadTitleList(author, n) {
  let block = await client.readContract({
    address: GLYPH, abi, functionName: "latestBlock", args: [author],
  });
  const out = [];
  while (out.length < n && block > 0n) {
    const logs = await postsInBlock(author, block);
    if (logs.length === 0) break;
    for (const log of logs) { out.push(toMeta(log, block)); if (out.length >= n) break; }
    block = logs[logs.length - 1].args.prevBlock;
  }
  return out;
}

// B. Body — cache-first: IndexedDB → RPC; persists on first fetch.
export async function loadPostBody(txHash) {
  const cached = await getCachedBody(txHash);
  if (cached) return cached;
  const tx = await client.getTransaction({ hash: txHash });
  const decoded = decodeFunctionData({ abi, data: tx.input });
  const body = await decodePayload(hexToBytes(decoded.args[1]));
  setCachedBody(txHash, body).catch(() => {});
  return body;
}
```

**Rendering one post**:
```js
const titles = await loadTitleList(author, 20);
// user clicks titles[k]
const body = await loadPostBody(titles[k].txHash);
const md   = await resolveImages(body.markdown);  // eth:0x... -> blob:...
container.innerHTML = renderMarkdown(md);
// show body.tags as the tags
```

> Reading N titles is N serial single-block queries, each downloading a few hundred bytes of log. N=20 takes ~0.5–1s; on a cache hit the body appears instantly.
> Clicking a post → one `getTransactionByHash` → one brotli decompress → render. After the first visit everything is cached in IndexedDB and later visits make no RPC calls at all.

**Local search.** Finding by tag or by word is answered from `bodyIndex.js` plus the bodies this
browser holds — never from the node, which cannot filter inside compressed calldata, and never from a
server, which would be the off-chain dependency the design refuses. Matching is a case-folded
SUBSTRING rather than tokens: a tokeniser has to know where words begin, and Chinese does not put
spaces between them, so the posts this app was written for are exactly the ones a tokeniser would
fail on. Every such surface states its scope ("among the N posts this browser has read") and offers
the ordinary paging control as the way to widen it.

**Identity through ENS.** The contract knows addresses and nothing else — an author IS a wallet, there
is no registration, and adding one would be a field somebody has to maintain and a privilege somebody
has to hold. But `0x8a1f…f4a5` is not a name, and a journal whose authors cannot be named is one nobody
can recommend. ENS answers it without adding a dependency: a registry with no owner, on the same L1,
read with the same client. `ens.js` resolves names forward (`/author/xiaoman.eth`), reverses addresses
to names for bylines, and reads the `avatar`, `description`, `url`, `com.twitter` and `com.github`
records into a small profile. A reverse record is a CLAIM, not evidence — anyone may point theirs at
any name — so a reversed name is resolved forward again and trusted only when it comes back to the same
address. Only Ethereum mainnet hosts ENS and an address is the same on every chain, so a Taiko-only
view still asks mainnet, and every other chain is never asked at all. All of it is best effort, cached
for ten minutes, and never blocks a render: a failed lookup leaves the address showing.

**The following feed: the cheap path, used as designed.** A reader who follows authors rather than
browsing needs no range scan at all. The contract keeps a head pointer per author (`latestBlock`) and
every post names the block of that author's previous one, so a followed author's list is one head read
plus a walk down single blocks. `followFeed.js` merges one such walk per (author, chain) by time, using
the very same `AuthorListController` the author pages use — so following somebody and then opening them
costs nothing more — and marks the frontier where the merge stops being complete, naming the author and
chain whose walk sits there. `loadMore()` deepens whichever walk is furthest behind, at most three per
click. The followed list lives in this browser (`glyph.following.v1`), costs no gas and is invisible to
the author: following is a decision about what you read, not a fact about them.

**The home feed (no address): the newest N across authors** — the one deliberate range scan in the whole design, used **only for address-less discovery**; the single-author path is unaffected:

```js
// There is no global head pointer, so cross-author discovery has to scan.
// Bounded and best-effort: walk back from the chain head, windowSize blocks
// at a time (to suit public RPC range limits), for at most maxWindows
// windows or until n posts are collected; empty stretches are skipped.
export async function loadRecentAcrossAuthors(n, { windowSize = 800, maxWindows = 30 } = {}) {
  const head = await client.getBlockNumber();
  let toBlock = head;
  const out = [];
  for (let w = 0; w < maxWindows && out.length < n && toBlock > 0n; w++) {
    const fromBlock = toBlock >= BigInt(windowSize) ? toBlock - BigInt(windowSize) + 1n : 0n;
    const logs = await client.getLogs({ address: GLYPH, event: POST_EVENT, fromBlock, toBlock });
    logs.sort((a, b) => a.blockNumber !== b.blockNumber
      ? Number(b.blockNumber - a.blockNumber) : b.logIndex - a.logIndex); // newest first
    for (const log of logs) { out.push(toMeta(log, log.blockNumber)); if (out.length >= n) break; }
    if (fromBlock === 0n) break;
    toBlock = fromBlock - 1n;
  }
  return out.slice(0, n);
}
```

---

## 8. The Markdown subset, and rendering

What is stored is Markdown, but only a **small, safe subset** — what is cut down is the feature set, not the characters. (Do not minify: brotli already squeezes whitespace to almost nothing, and minifying would destroy the core value that anyone can read the stored text directly.)

**Supported**: headings `# ## ###` · `**bold**` `*italic*` · links `[text](url)` (including cross-article references `[text](0x<txhash>/<n>)`, see §8.1) · images `![alt](eth:0x<txhash>)` · lists, `-` and `1.` · blockquotes `>` · inline and fenced code · tables (GFM pipe syntax) · paragraphs separated by blank lines.

**Cut**: raw HTML (which also removes XSS), footnotes, reference-style links, definition lists.

The reader can always see the bytes rather than take them on trust: "Raw" on a post page shows the
decompressed document as stored, with its compressed and decompressed sizes, and "Download .md" saves
exactly those bytes. The write tab reads one back with `markdownImport.js`. That round trip is what
makes "any editor, decades from now" a fact rather than an intention.

**Render order**: `loadTitleList` → the user clicks → `loadPostBody` (cache-first) → `resolveGlyphRefs` (0x… → a /tx/ path, taking the target's title when the link text is empty) → `resolveImages` (eth: → blob) → the restricted parser renders → sanitize.

### 8.1 Cross-article references

To reference another article from a body, the link target is written as the target article's publish transaction hash:

```markdown
[link text](0x<transaction hash>/<event index>)
```

- **Transaction hash**: the target article's `publish()` transaction, 64 hex characters.
- **Event index**: the 0-based ordinal of the `Post` event inside that transaction (one transaction can publish several posts). It may be omitted — `[text](0x<hash>)` and `[text](0x<hash>/0)` are exactly equivalent.
- **Empty link text**: `[](0x…/0)` resolves the target article's title at read time and uses it as the link text; when that lookup fails, the short transaction hash is shown instead.
- **Rendering**: a reference is rewritten to the app's own canonical path, `/tx/<hash>/<n>`, and clicking it navigates within the app; an invalid target lands on the "no such post" page.
- Example: `[Grandmother's camphorwood chest](0x41663fee6dd678632e23c8365076b466603b0d0694925e13b0d0d2007bec7844)` (equivalent to the same with `/0`).

---

## 9. Permanence and self-hosting

- **Calldata is cryptographically anchored to Ethereum forever** — it is part of the canonical chain, and its integrity can always be verified against the block hashes.
- **What is evolving is who still keeps a retrievable copy**:
  - **EIP-4444 (history expiry)**: every execution client now supports **partial history expiry** and may drop block data from before the Merge (2022-09); **full rolling history expiry is still in development**.
  - Once rolling expiry ships, an ordinary full node may drop history older than roughly a year, and fetching old calldata will then mean going to an **archive node, the Portal Network, or ERA files**.
  - The data itself does not disappear — archive nodes and decentralised data providers keep it — but no arbitrary node is guaranteed to serve it instantly.
- **A three-layer backup strategy**:
  1. **The IndexedDB local cache**: every body and image you have visited is cached permanently in the browser, at zero network latency.
  2. **Your own backup**: keep the original images and the original drafts yourself. When you need to, verify them against the on-chain txhash / block hash.
  3. **The on-chain anchor**: the bytes are anchored to Ethereum, and you hold a copy you can verify.
  - The simplest way to take a copy is "Download .md" on any post page: it saves the exact document the
    chain holds, which "Import .md…" reads back.
- **If you want every full node to keep it**: **SSTORE2** (storing the bytes as contract code, in **state**) would do it, at roughly 5× the cost of calldata and under the 24KB contract limit (EIP-170). The conclusion: **calldata + local cache + your own backup** is the more practical answer.

---

## 10. Design decision record

| Decision | Choice | Why |
|---|---|---|
| Storage medium | Ethereum L1 calldata | Trust Ethereum, trust nothing off-chain |
| Contract shape | **shared, ownerless, non-upgradeable** | One contract serves any number of writers |
| Authorship | `msg.sender` | No registration; the wallet address is the identity |
| Content format | a Markdown subset + tags + title | App-independent, readable in any editor decades from now |
| Title | `bytes32` (its own calldata argument) | UTF-8 right-padded with zeros; the UI limits by bytes; putting it in the event makes a title-list query decompression-free |
| Tags | embedded in Markdown front-matter (YAML-style `tags:`) | A universal convention, human-readable, sharing the body's brotli dictionary; front-matter brings its own forward compatibility |
| Body compression | brotli q11, no dictionary | The stream is self-describing; the decoder needs nothing extra |
| Where body / tags live | **the publish transaction's calldata, not the event** | Gives the title-list query a fixed bandwidth, and saves the ~20% extra that LOG bytes cost |
| Payload schema | optional YAML front-matter + a Markdown body | With no tags it is pure Markdown; readable in any editor decades from now |
| Image encoding | WebP q60 | The balance of size and quality, ~$0.68 an image at current gas |
| Images on chain | one plain-calldata self-send each, referenced by txhash | Keeps the article transaction small; decouples images from the author |
| Fetching the latest | the `latestBlock(author)` head pointer (O(1)) | No block scanning; each author has their own head pointer |
| Fetching the previous N | the reverse linked list through the event's `prevBlock` | Each step is a single-block query, answered instantly |
| `author` indexed | yes | The topic a multi-author read needs to filter by author |
| Storage packing | `(uint96 latestBlock, uint48 count)` in one slot | One SSTORE per published post |
| Author discovery | out-of-band (front end `?author=0x…`); a bounded client-side scan of recent blocks when no address is given | Keeps the contract minimal; discovery on the home page changes nothing on chain (best-effort, not O(1)) |
| Endpoint configuration | the `/settings` page, an **ordered** set of endpoints per chain, localStorage overriding the env defaults | Used in order, falling back to the next on failure; a failed endpoint is set aside briefly rather than retried on every request |
| Multiple chains | Ethereum mainnet + Taiko mainnet (the same CREATE2 address), read together by default: the feed and author pages merge by block time, and the URL's first segment (`/taiko`) narrows to one chain; an article URL always names its chain | One contract, one journal; each chain scans and caches on its own, the merge layer decides which chain to deepen by the "time frontier", and the publish chain is picked separately in the write tab |
| getLogs window | a default per chain, halved and retried automatically when a node refuses the range | Public nodes cap ranges anywhere from 25 to 10,000; adapt rather than fail |
| Request logging | one console line per node request and per cache hit | Which blocks were skipped, which endpoint was fallen back to — visible at a glance |
| ETH price source | CoinGecko's public API (degrading to ETH-only offline) | Simple and automatic; the one off-chain HTTP dependency, and not fatal when it fails |
| Editor | CodeMirror source editing plus a live preview | Markdown syntax highlighting and see-as-you-write; the preview reuses the renderer |
| Permanence fallback | on-chain anchor + IndexedDB cache + your own backup | Three layers of redundancy, against future rolling history expiry |
| Finding by tag or word | Local, over the bodies already read; case-folded substring matching | The node cannot filter inside calldata and a server is out of the question; substrings work in Chinese, where tokens do not |
| Relations between posts | Front-matter keys (`re`, `supersedes`, `prev`, `series`/`part`), with the reverse direction indexed locally from bodies already read | The contract indexes only authors, and indexing the inside of calldata is exactly the off-chain dependency this design refuses; forward relations are durable, reverse ones are honest about their scope |
| The language of a post | A `lang` front-matter key, applied to the article element | Better CJK line breaking and a screen reader that pronounces it correctly, without guessing from the characters |
| Getting a post out and back | "Raw" and "Download .md" hand over the exact stored document; "Import .md…" reads one into a draft | The design's central claim is that the bytes are plain readable Markdown; this is where the claim can be checked, and the simplest personal backup there is |
| Publishing an image twice | The processed bytes are hashed (SHA-256) and the transaction remembered per chain in `localStorage`; a match is referenced, not re-sent | An image is its own transaction and the dearest part of a post; nothing in the protocol stopped paying for the same bytes twice |
| When and where to publish | A day of base fees sampled from block headers, and the same draft priced on every read chain | Timing is a factor of ~100 on cost and the chain is another; both answers come from the nodes already in use, so neither adds an off-chain dependency |
| Wallet transport | EIP-6963 discovery of installed wallets; WalletConnect optional, behind a build-time project id | `window.ethereum` is a race between extensions with no way to say which you meant; WalletConnect is the only way to sign where there is no extension, and is the wallet transport only — never content |
| The draft being written | IndexedDB (`drafts`), one record, written half a second after the last change | A reload, a wallet leaving and returning, or a closed tab used to lose the letter — including image transactions already paid for |
| Identity | ENS, read from mainnet: forward for `/author/<name>.eth`, reverse for bylines, text records for a profile | The contract deliberately knows only addresses; ENS is a registry with no owner on the same chain, so naming authors costs no server and no new trust. A reverse record is verified forward before it is believed |
| Following | A list of addresses in this browser; `/following` merges one author-list walk per (author, chain) and needs no range scan | Following is a decision about what you read, not a fact about the author, so it costs no gas and tells them nothing; and it is the path the head pointer and the reverse linked list were put in the contract for |
| Local cache | IndexedDB, never expiring | The content is immutable; a cache hit costs no RPC; ten thousand posts is ~20 MB |
| Scan coverage | localStorage records **a set of ranges** already scanned, rather than one frontier | Paging back only fills unread gaps; a range already scanned is never scanned again |
| Request de-duplication | indexed within a session by (author, index) / (txHash, event index) | One post is requested from the node at most once per session, whichever page it is reached from |
| Interface language | English by default, switchable to Chinese; the choice is stored in `localStorage` (`glyph.lang.v1`) and applied without a reload | The interface is a presentation layer over on-chain content; a post stays in the language it was written in |

---

## 11. Appendix: constants, dependencies, deployment

**Protocol constants (as of 2026-06)**
- **EIP-7623 (Pectra)** calldata floor pricing: `tokens = zero bytes + 4 × non-zero bytes`, floor `10 gas/token` → 40 for non-zero, 10 for zero.
- **EIP-7825 (Fusaka, 2025-12)** per-transaction gas cap: `2²⁴ = 16,777,216`. → at most about `(16,777,216 − 21,000) / 40 ≈ 418,905` bytes ≈ **~409 KB** of image in one transaction.
- **Transaction-pool size limit (not a consensus rule)**: geth's `txMaxSize = 4 × 32 KiB = 131,072` bytes; anything larger is rejected as `oversized data`. Public nodes all run that default, so **the practical ceiling is ~128 KiB per transaction** — reached long before the gas cap above, which makes the ~409 KB figure theoretical. The front end works to the practical limit (`MAX_TX_BYTES` / `MAX_CALLDATA_BYTES` in `publish.js`): images are compressed to fit that budget, and the body is measured once before any image is uploaded.
- **EIP-170** contract code limit, 24,576 bytes (relevant only when using SSTORE2).

**Dependencies**
```bash
npm i viem brotli-wasm
```

The command-line tool (`cli/`) needs `viem` alone: Node has brotli, argument parsing and a test
runner of its own. It does not reimplement the format — `cli/src/shared.js` imports
`payloadText.js`, `title.js`, `abi.js`, `chains.js` and `limits.js` straight out of
`webapp/src/lib/`, which is why those modules are kept free of any import that plain Node cannot
follow. A post published from a terminal is therefore byte for byte the post the browser would have
written, and that is checked rather than assumed: the CLI's tests run against the same mock node the
browser tests use, and compare its bytes with `encodePayload`'s.

**Deployment (Foundry)**
```bash
forge create src/Blog.sol:Glyph \
  --rpc-url $ETH_RPC --private-key $PK \
  --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY
# The deployer holds no privilege. Anyone's wallet can deploy this contract,
# and every writer shares the one deployment.
```

**Front-end configuration**

The contract address is determined by CREATE2 and is the same on every chain, so it is
built in as a constant in `webapp/src/lib/config.js` (`DEFAULT_GLYPH_ADDRESS`) and needs no
configuration. The variables below are inlined by Vite **at build time**, and are only
useful when pointing the app at your own deployment:

```bash
# webapp/.env.local (optional)
VITE_GLYPH_ADDRESS=0x...          # override the built-in contract address
VITE_RPC_URL=https://...          # the default RPC (overridable in the UI settings)
VITE_CHAIN_ID=1                   # 1=mainnet, 11155111=sepolia
```

To read, visit `https://your-site/?author=0xAUTHOR_ADDRESS` for that author's title list;
**with no author parameter you get the newest N posts network-wide (a scan of recent blocks)**.
To write, connect a wallet; the wallet address is the authorship; the title is at most 32 bytes, and the tags are free-form.

**Self-hosted backup checklist**
1. Keep the original Markdown of every post (front-matter included) and every original image.
2. Record each image's `txhash`, and each post's publish transaction hash and block number.
3. Optional, for the long term: run an archive node, or export ERA files for the relevant blocks periodically.
4. At any time you can verify the copy in your hands against the on-chain hashes.
5. **The IndexedDB cache does this automatically**: bodies and images are stored in the browser database on first visit, and later visits make no network requests.

---

*This file is itself plain Markdown — like the system it describes, any editor will open it decades from now.*
