// blogReader.js — Reader side for the shared, ownerless Glyph contract.
//
// Title list:   loadTitleList(author, n) / loadMoreTitles(author, oldest, n)
//   - Pulls Post events from the contract's reverse block-linked list.
//   - Each event only carries metadata (author, index, prevBlock, title).
//   - Body bytes are NOT in the event — they live in the publish() tx calldata.
//
// Home feed:    loadRecentAcrossAuthors(n) / loadMoreAcrossAuthors(oldest, n)
//   - Cross-author discovery has no on-chain head pointer, so it sweeps
//     block ranges backwards — skipping every range already read.
//
// Single post body:  loadPostBody(txHash)
//   - eth_getTransactionByHash → decode publish(bytes32, bytes) args from input
//   - brotli-decompress payload → { tags, markdown }
//
// Lookup by deep link:  findTitleMeta(author, targetIndex)
//   - Walks the chain backwards until it finds (or doesn't) the targeted index.
//
// What has already been read — this session and across sessions — lives in
// scanStore.js. Every path below asks it first, so a given post is fetched
// from the chain at most once per page session no matter which surface asks.

import {
  createPublicClient,
  http,
  parseAbi,
  hexToBytes,
  decodeFunctionData,
  decodeEventLog,
} from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { RPC_URL, GLYPH_ADDRESS, CHAIN_ID } from './config';
import { decodeTitle } from './title';
import { decodePayload } from './payload';
import { getCachedBody, setCachedBody, getCachedImage, setCachedImage } from './cache';
import * as seg from './segments';
import * as store from './scanStore';
import * as scanner from './scanner';

const chain = CHAIN_ID === 11155111 ? sepolia : mainnet;

export const client = createPublicClient({ chain, transport: http(RPC_URL) });

export const abi = parseAbi([
  'function latestBlock(address author) view returns (uint256)',
  'function count(address author) view returns (uint256)',
  'function publish(bytes32 title, bytes payload) external',
  'event Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)',
]);

const POST_EVENT = abi.find((x) => x.type === 'event' && x.name === 'Post');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff on transient public-RPC failures
 * (rate limits / timeouts). Throws the original error after the last attempt.
 */
async function withRetry(fn, { retries = 2, baseDelayMs = 1200 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err?.message || err);
      const retriable =
        err?.status === 429 ||
        /rate limit|429|too many requests|timeout|underlying network|can'?t route|suitable provider/i.test(msg);
      if (!retriable || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * One transaction can publish several posts (e.g. a multicall), so a
 * txHash is not a unique post id. Tag each Post log with its 0-based
 * ordinal among the Post events of its transaction (by logIndex order).
 */
function assignEventIndexes(logs) {
  const byTx = new Map();
  for (const log of logs) {
    const list = byTx.get(log.transactionHash) ?? [];
    list.push(log);
    byTx.set(log.transactionHash, list);
  }
  for (const list of byTx.values()) {
    list.sort((a, b) => a.logIndex - b.logIndex);
    list.forEach((log, i) => {
      log.__eventIndex = i;
    });
  }
  return logs;
}

async function postsInBlock(author, block) {
  // Block heights must reach viem as bigints — it hex-encodes bigints and
  // passes anything else through verbatim, so a plain number would go out
  // as a JSON number and every node rejects that.
  const at = BigInt(block);
  const logs = await withRetry(() =>
    client.getLogs({
      address: GLYPH_ADDRESS,
      event: POST_EVENT,
      fromBlock: at,
      toBlock: at,
    }),
  );
  // Event indexes have to count EVERY Post event in the transaction, not
  // just this author's: /tx/<hash>/<i> is resolved by findMetaByTx(), which
  // decodes the receipt without an author filter. Number them first, then
  // narrow to the author (one tx can carry posts from several senders).
  assignEventIndexes(logs);
  const key = String(author).toLowerCase();
  return logs.filter((log) => String(log.args.author).toLowerCase() === key);
}

function logToMeta(log, block) {
  return {
    author: log.args.author,
    index: log.args.index,
    block,
    prevBlock: log.args.prevBlock,
    title: decodeTitle(log.args.title),
    txHash: log.transactionHash,
    eventIndex: log.__eventIndex ?? 0,
    // Orders posts published in the same block — the feed's page cursor.
    logIndex: log.logIndex,
  };
}

async function readHead(author) {
  return client.readContract({
    address: GLYPH_ADDRESS,
    abi,
    functionName: 'latestBlock',
    args: [author],
  });
}

// --- Per-author reads (reverse block-linked list) ---------------------

/** That author's Post logs in one block, as metas. */
const authorBlockFetcher = (author) => async (block) =>
  (await postsInBlock(author, block)).map((log) => logToMeta(log, block));

/**
 * Load `author`'s most recent `n` post-metadata records (newest first).
 * Incremental: an unchanged author head serves the stored rows with zero
 * getLogs; blocks covered by a global feed sweep or by the author's own
 * earlier reads are reused without RPC.
 */
export async function loadTitleList(author, n) {
  store.seedFromStorage();
  const head = await readHead(author);
  const known = store.authorScanHead(author);
  if (known != null && head <= BigInt(known)) {
    return store.authorPosts(author).slice(0, n);
  }
  await scanner.walkAuthorTitles(author, head, null, n, authorBlockFetcher(author));
  store.setAuthorScanHead(author, head);
  store.persistAuthorScan(author);
  // The store may already hold older rows from an earlier, deeper read — the
  // walk stops at n, the list shows the newest n of everything known.
  return store.authorPosts(author).slice(0, n);
}

/** Continue walking from the oldest title already shown. */
export async function loadMoreTitles(author, oldestShown, n) {
  if (!oldestShown) return [];
  store.seedFromStorage();
  const out = await scanner.walkAuthorTitles(
    author,
    oldestShown.block,
    oldestShown.index,
    n,
    authorBlockFetcher(author),
  );
  store.persistAuthorScan(author);
  return out;
}

/**
 * Find the metadata for a single (author, index) — deep links and prev/next
 * navigation. Answered outright when the post has already been read this
 * session; otherwise walks the reverse chain, reusing covered blocks.
 */
export async function findTitleMeta(author, targetIndex) {
  // Guard against garbage from the URL (?i=abc): BigInt(NaN) throws, and
  // negative / fractional indexes can never match a real post.
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) return null;
  store.seedFromStorage();
  const known = store.knownPost(author, BigInt(targetIndex));
  if (known) return known;

  const head = await readHead(author);
  const found = await scanner.findAuthorPost(
    author,
    targetIndex,
    head,
    authorBlockFetcher(author),
  );
  store.persistAuthorScan(author);
  return found;
}

// --- Home feed (cross-author range sweeps) ---------------------------

/** One getLogs window, as metas. */
async function fetchFeedRange(from, to, endsAtHead) {
  const logs = await withRetry(() =>
    client.getLogs({
      address: GLYPH_ADDRESS,
      event: POST_EVENT,
      fromBlock: from,
      // The window ending at the chain head asks for 'latest': public RPC
      // clusters (dRPC, etc.) can serve getBlockNumber and getLogs from
      // different nodes, and a numeric toBlock captured a moment earlier may
      // already exceed the answering node's head.
      toBlock: endsAtHead ? 'latest' : to,
    }),
  );
  assignEventIndexes(logs);
  return logs.map((log) => logToMeta(log, log.blockNumber));
}

/** Home feed: most recent `n` posts across ALL authors. */
export async function loadRecentAcrossAuthors(n, { windowSize = 800, maxWindows = 30 } = {}) {
  store.seedFromStorage();
  const head = await client.getBlockNumber();
  const known = store.feedScanHead();

  // No new blocks since the last sweep — serve what we hold, zero getLogs.
  if (known != null && head <= BigInt(known)) return scanner.feedRows().slice(0, n);

  await scanner.sweepFeed({
    cursor: head,
    head,
    n,
    windowSize,
    maxWindows,
    fetchRange: fetchFeedRange,
  });
  store.setFeedScanHead(head);
  store.persistFeedScan();
  return scanner.feedRows().slice(0, n);
}

/**
 * Page the home feed towards older posts, continuing from `oldestShown`.
 * Bounded per call: covered ranges are free, at most `maxWindows` fetches of
 * new ground. `done` is true only once the sweep reaches block 0.
 */
export async function loadMoreAcrossAuthors(
  oldestShown,
  n,
  { windowSize = 800, maxWindows = 30 } = {},
) {
  store.seedFromStorage();
  let cursor;
  if (oldestShown) {
    // Start AT the cursor's own block, not below it: posts published in the
    // same block but earlier within it are still unread, and that block is
    // already covered so revisiting it costs nothing.
    cursor = BigInt(oldestShown.block);
  } else {
    const low = seg.lowest(store.feedCoverage());
    if (low == null) return { rows: [], done: false }; // nothing swept yet
    cursor = low - 1n;
  }
  if (cursor < 0n) return { rows: [], done: true };

  const head = store.feedScanHead();
  const swept = await scanner.sweepFeed({
    cursor,
    head: head != null ? BigInt(head) : null,
    n,
    olderThan: oldestShown ? store.rememberPosts([oldestShown])[0] : null,
    windowSize,
    maxWindows,
    fetchRange: fetchFeedRange,
  });
  store.persistFeedScan();
  return { rows: swept.rows, done: swept.reachedGenesis };
}

// --- ENS names — cached; null when the address has none, or when the
//     chain doesn't host ENS (only Ethereum mainnet does). ---

const ensCache = new Map(); // address (lowercase) -> Promise<string | null>

export function resolveEnsName(address) {
  const key = String(address).toLowerCase();
  if (ensCache.has(key)) return ensCache.get(key);
  const promise = (async () => {
    try {
      const name = await client.getEnsName({ address });
      return name ?? null;
    } catch {
      return null; // ENS absent on this chain or RPC hiccup
    }
  })();
  promise.catch(() => ensCache.delete(key));
  ensCache.set(key, promise);
  return promise;
}

/**
 * Resolve post metadata from a publish transaction hash + the 0-based
 * ordinal of the Post event within that transaction (one tx can publish
 * several posts). Reads the receipt and decodes every Post log in it —
 * one RPC call, no scanning. Returns null when there is no such event.
 */
export async function findMetaByTx(txHash, eventIndex = 0) {
  store.seedFromStorage();
  const known = store.knownPostByTx(txHash, eventIndex);
  if (known) return known;

  const receipt = await withRetry(() => client.getTransactionReceipt({ hash: txHash }));
  const posts = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== GLYPH_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, eventName: 'Post', data: log.data, topics: log.topics });
      posts.push({ log, args: decoded.args });
    } catch {
      continue; // some other event from the same contract
    }
  }
  posts.sort((a, b) => a.log.logIndex - b.log.logIndex);
  // Remember every post in the transaction, not just the one asked for: a
  // sibling opened later in the session is then already resolved.
  const rows = store.rememberPosts(
    posts.map(({ log, args }, i) => ({
      author: args.author,
      index: args.index,
      block: receipt.blockNumber,
      prevBlock: args.prevBlock,
      title: decodeTitle(args.title),
      txHash,
      eventIndex: i,
      logIndex: log.logIndex,
    })),
  );
  return rows[eventIndex] ?? null;
}

// --- Post body (tags + markdown) — fetched on demand from tx calldata,
//     with IndexedDB permanent cache (posts are immutable on-chain). ---

const bodyCache = new Map(); // txHash -> Promise<{ body, fromCache }>

/**
 * Load a post body ({ tags, markdown }) plus whether it came from the
 * local IndexedDB cache, so the UI can label 来自本地缓存.
 * @returns {Promise<{ body: { tags: string[], markdown: string }, fromCache: boolean }>}
 */
export function loadPostBody(txHash) {
  if (bodyCache.has(txHash)) return bodyCache.get(txHash);
  const promise = (async () => {
    // Check IndexedDB cache first — posts are immutable, so cached copy is always fresh.
    const cached = await getCachedBody(txHash);
    if (cached) return { body: cached, fromCache: true };

    const tx = await client.getTransaction({ hash: txHash });
    const decoded = decodeFunctionData({ abi, data: tx.input });
    const payloadHex = decoded.args[1];
    const body = await decodePayload(hexToBytes(payloadHex));

    // Persist to IndexedDB for future sessions (fire-and-forget).
    setCachedBody(txHash, body).catch(() => {});

    return { body, fromCache: false };
  })();
  promise.catch(() => bodyCache.delete(txHash));
  bodyCache.set(txHash, promise);
  return promise;
}

// --- Image resolution — with permanent IndexedDB cache ---
//
// We cache Blobs (not object URLs): each caller mints fresh URLs from the
// shared Blob and revokes them when done, so long sessions don't leak.

const imgCache = new Map(); // hash -> Promise<Blob>

export function loadImageBlob(hash, mime = 'image/webp') {
  if (imgCache.has(hash)) return imgCache.get(hash);
  const promise = (async () => {
    // Check IndexedDB cache first.
    const cached = await getCachedImage(hash);
    if (cached) return cached;

    const tx = await client.getTransaction({ hash });
    const bytes = hexToBytes(tx.input);
    const blob = new Blob([bytes], { type: mime });

    // Persist raw bytes to IndexedDB (fire-and-forget).
    setCachedImage(hash, bytes.buffer).catch(() => {});

    return blob;
  })();
  promise.catch(() => imgCache.delete(hash));
  imgCache.set(hash, promise);
  return promise;
}

/**
 * Resolve `eth:0x<txhash>` image refs to blob URLs.
 * @returns {Promise<{ markdown: string, urls: string[] }>} rewritten
 *   markdown plus the fresh object URLs — the caller must revoke them.
 */
export async function resolveImages(markdown) {
  const re = /!\[([^\]]*)\]\(eth:(0x[0-9a-fA-F]{64})[^)]*\)/g;
  const matches = [...markdown.matchAll(re)];
  // Settled, not all: an image the node can't serve must not take the whole
  // article down with it — its ref is left alone and renders as alt text.
  const results = await Promise.allSettled(matches.map((m) => loadImageBlob(m[2])));
  const urls = [];
  let out = markdown;
  matches.forEach((m, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') return;
    const url = URL.createObjectURL(r.value);
    urls.push(url);
    out = out.split(m[0]).join('![' + m[1] + '](' + url + ')');
  });
  return { markdown: out, urls };
}
