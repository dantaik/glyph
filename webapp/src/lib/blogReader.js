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
  parseAbi,
  hexToBytes,
  decodeFunctionData,
  decodeEventLog,
} from 'viem';
import { CHAIN, LOG_WINDOW, RPC_URLS, GLYPH_ADDRESS } from './config';
import { decodeTitle } from './title';
import { decodePayload } from './payload';
import { getCachedBody, setCachedBody, getCachedImage, setCachedImage } from './cache';
import * as seg from './segments';
import * as store from './scanStore';
import * as scanner from './scanner';
import * as rpcLog from './rpcLog';
import { orderedFallback } from './transport';

/**
 * One client for the whole app, over the configured endpoints in order —
 * see transport.js for how failover and cool-down work. withRetry() below
 * still backs off on top of it, for when EVERY endpoint is rate-limiting.
 */
export const client = createPublicClient({
  chain: CHAIN.viem,
  transport: orderedFallback(RPC_URLS, CHAIN.viem),
});

rpcLog.endpoints(CHAIN.name, RPC_URLS);

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
  const logs = await rpcLog.fromNode(
    'eth_getLogs',
    `block ${rpcLog.b(at)} · author ${String(author).slice(0, 8)}…`,
    () =>
      withRetry(() =>
        client.getLogs({
          address: GLYPH_ADDRESS,
          event: POST_EVENT,
          fromBlock: at,
          toBlock: at,
        }),
      ),
    (out) => `${out.length} event${out.length === 1 ? '' : 's'}`,
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
  return rpcLog.fromNode(
    'latestBlock()',
    `author ${String(author).slice(0, 8)}…`,
    () =>
      client.readContract({
        address: GLYPH_ADDRESS,
        abi,
        functionName: 'latestBlock',
        args: [author],
      }),
    (head) => `block ${rpcLog.b(head)}`,
  );
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
  const emitStep = ({ block, collected, target }) => {
    try {
      window.dispatchEvent(
        new CustomEvent('glyph:scanprogress', {
          detail: {
            fromBlock: block,
            toBlock: block,
            fraction: Math.min(1, Math.max(0, collected / Math.max(1, target))),
            posts: collected,
            target,
          },
        }),
      );
    } catch {
      /* non-browser context */
    }
  };
  const out = await scanner.walkAuthorTitles(
    author,
    oldestShown.block,
    oldestShown.index,
    n,
    authorBlockFetcher(author),
    emitStep,
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
  if (known) {
    rpcLog.fromCache('post', `#${targetIndex} of ${String(author).slice(0, 8)}…`, 'already loaded');
    return known;
  }

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

/**
 * Public nodes cap getLogs ranges anywhere from 25 blocks to 10,000. Tag the
 * refusal so the sweep can shrink its window and carry on instead of giving
 * up — but never confuse it with a rate limit, which backing off fixes.
 */
function tagRangeError(err) {
  const msg = String(err?.details || err?.shortMessage || err?.message || err);
  if (/rate limit|429|too many requests/i.test(msg)) return err;
  if (/\brange\b|too large|exceed|limited to|must not exceed/i.test(msg)) {
    err.rangeTooLarge = true;
  }
  return err;
}

/** One getLogs window, as metas. */
async function fetchFeedRange(from, to, endsAtHead) {
  const logs = await rpcLog.fromNode(
    'eth_getLogs',
    rpcLog.range(from, to),
    () =>
      withRetry(() =>
        client.getLogs({
          address: GLYPH_ADDRESS,
          event: POST_EVENT,
          fromBlock: from,
          // The window ending at the chain head asks for 'latest': public RPC
          // clusters (dRPC, etc.) can serve getBlockNumber and getLogs from
          // different nodes, and a numeric toBlock captured a moment earlier
          // may already exceed the answering node's head.
          toBlock: endsAtHead ? 'latest' : to,
        }),
      ),
    (out) => `${out.length} post${out.length === 1 ? '' : 's'}`,
  ).catch((err) => {
    throw tagRangeError(err);
  });
  assignEventIndexes(logs);
  return logs.map((log) => logToMeta(log, log.blockNumber));
}

/**
 * Wrap a feed-range fetcher to pulse `glyph:scanprogress` before each fresh
 * window: the range about to be fetched plus the overall fraction, anchored
 * on the span from `cursor` down to `targetBottom`.
 */
function withFeedProgress(cursor, targetBottom, fetchRange) {
  return async (from, to, endsAtHead) => {
    try {
      const scanSpan = cursor - targetBottom + 1n;
      const fraction =
        scanSpan <= 0n
          ? 1
          : Math.min(
              1,
              Math.max(0, Number(((cursor - from + 1n) * 1000n) / scanSpan) / 1000),
            );
      window.dispatchEvent(
        new CustomEvent('glyph:scanprogress', {
          detail: { fromBlock: from, toBlock: to, targetBottom, fraction },
        }),
      );
    } catch {
      /* non-browser context */
    }
    return fetchRange(from, to, endsAtHead);
  };
}

/** Home feed: most recent `n` posts across ALL authors. */
export async function loadRecentAcrossAuthors(
  n,
  { windowSize = LOG_WINDOW, maxWindows = 30 } = {},
) {
  store.seedFromStorage();
  const head = await rpcLog.fromNode(
    'eth_blockNumber',
    'chain head',
    () => client.getBlockNumber(),
    (h) => `block ${rpcLog.b(h)}`,
  );
  const known = store.feedScanHead();

  // No new blocks since the last sweep — serve what we hold, zero getLogs.
  if (known != null && head <= BigInt(known)) {
    const rows = scanner.feedRows().slice(0, n);
    rpcLog.fromCache('feed', `head unchanged at ${rpcLog.b(known)}`, `${rows.length} posts`);
    return rows;
  }

  // Walk backwards from the head, skipping every range already read. The
  // UI gets a glyph:scanprogress pulse per fresh window (current range +
  // overall fraction), anchored on the ground this sweep can actually
  // cover: down to the top of the nearest already-covered range, or a
  // bounded maxWindows floor on the first visit.
  const span = BigInt(windowSize);
  const below = seg.topBelow(store.feedCoverage(), head);
  const targetBottom =
    below != null
      ? below + 1n
      : head > span * BigInt(maxWindows)
        ? head - span * BigInt(maxWindows) + 1n
        : 0n;
  await scanner.sweepFeed({
    cursor: head,
    head,
    n,
    windowSize,
    maxWindows,
    fetchRange: withFeedProgress(head, targetBottom, fetchFeedRange),
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
  { windowSize = LOG_WINDOW, maxWindows = 30 } = {},
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
  // Progress anchor: this call can walk at most maxWindows below the cursor.
  const span = BigInt(windowSize);
  const targetBottom =
    cursor > span * BigInt(maxWindows) ? cursor - span * BigInt(maxWindows) + 1n : 0n;
  const swept = await scanner.sweepFeed({
    cursor,
    head: head != null ? BigInt(head) : null,
    n,
    olderThan: oldestShown ? store.rememberPosts([oldestShown])[0] : null,
    windowSize,
    maxWindows,
    fetchRange: withFeedProgress(cursor, targetBottom, fetchFeedRange),
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
      const name = await rpcLog.fromNode(
        'ens_getName',
        `${String(address).slice(0, 8)}…`,
        () => client.getEnsName({ address }),
        (v) => v ?? 'no name',
      );
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
  if (known) {
    rpcLog.fromCache('post', `${String(txHash).slice(0, 10)}…/${eventIndex}`, 'already loaded');
    return known;
  }

  const receipt = await rpcLog.fromNode(
    'eth_getTransactionReceipt',
    `${String(txHash).slice(0, 10)}…`,
    () => withRetry(() => client.getTransactionReceipt({ hash: txHash })),
    (r) => `${r.logs.length} logs in block ${rpcLog.b(r.blockNumber)}`,
  );
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
    if (cached) {
      rpcLog.fromCache('body', `${String(txHash).slice(0, 10)}…`, 'IndexedDB hit');
      return { body: cached, fromCache: true };
    }

    const tx = await rpcLog.fromNode(
      'eth_getTransactionByHash',
      `body ${String(txHash).slice(0, 10)}…`,
      () => client.getTransaction({ hash: txHash }),
      (t) => `${rpcLog.b((t.input.length - 2) / 2)} bytes calldata`,
    );
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
    if (cached) {
      rpcLog.fromCache('image', `${String(hash).slice(0, 10)}…`, 'IndexedDB hit');
      return cached;
    }

    const tx = await rpcLog.fromNode(
      'eth_getTransactionByHash',
      `image ${String(hash).slice(0, 10)}…`,
      () => client.getTransaction({ hash }),
      (t) => `${rpcLog.b((t.input.length - 2) / 2)} bytes`,
    );
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
