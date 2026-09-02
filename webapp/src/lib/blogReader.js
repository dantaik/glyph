// blogReader.js — Reader side for the shared, ownerless Glyph contract.
//
// Title list:   loadTitleList(author, n) / loadMoreTitles(author, oldest, n)
//   - Pulls Post events from the contract's reverse block-linked list.
//   - Each event only carries metadata (author, index, prevBlock, title).
//   - Body bytes are NOT in the event — they live in the publish() tx calldata.
//
// Single post body:  loadPostBody(txHash)
//   - eth_getTransactionByHash → decode publish(bytes32, bytes) args from input
//   - brotli-decompress payload → { tags, markdown }
//
// Lookup by deep link:  findTitleMeta(author, targetIndex)
//   - Walks the chain backwards until it finds (or doesn't) the targeted index.

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
  const logs = await withRetry(() =>
    client.getLogs({
      address: GLYPH_ADDRESS,
      event: POST_EVENT,
      args: { author },
      fromBlock: block,
      toBlock: block,
    }),
  );
  assignEventIndexes(logs);
  logs.sort((a, b) => Number(b.args.index - a.args.index));
  return logs;
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
  };
}

async function walkBack(author, startBlock, beforeIndex, n) {
  let block = startBlock;
  let skipIndex = beforeIndex;
  const out = [];
  while (out.length < n && block > 0n) {
    const logs = await postsInBlock(author, block);
    if (logs.length === 0) break;
    for (const log of logs) {
      const meta = logToMeta(log, block);
      if (skipIndex !== null && meta.index >= skipIndex) continue;
      out.push(meta);
      if (out.length >= n) break;
    }
    skipIndex = null;
    block = logs[logs.length - 1].args.prevBlock;
  }
  return out;
}

async function readHead(author) {
  return client.readContract({
    address: GLYPH_ADDRESS,
    abi,
    functionName: 'latestBlock',
    args: [author],
  });
}

/**
 * Load `author`'s most recent `n` post-metadata records (newest first).
 * Incremental: an unchanged author head serves the persisted rows with
 * zero getLogs; blocks covered by the global feed scan or the author's
 * own persisted scan are reused without RPC.
 */
export async function loadTitleList(author, n) {
  const key = String(author).toLowerCase();
  const stored = readAuthorScans()[key];
  const head = await readHead(author);
  if (stored?.head != null && head <= BigInt(stored.head)) {
    return stored.rows.slice(0, n);
  }

  const out = await walkAuthorTitles(author, head, null, n);
  const seen = new Set(out.map((m) => String(m.index)));
  for (const m of stored?.rows ?? []) {
    if (seen.has(String(m.index))) continue;
    seen.add(String(m.index));
    out.push(m);
    if (out.length >= n) break;
  }
  writeAuthorScan(author, { head: head.toString(), rows: out.slice(0, 100) });
  return out.slice(0, n);
}

/** Continue walking from the oldest title already shown. */
export async function loadMoreTitles(author, oldestShown, n) {
  if (!oldestShown) return [];
  return walkAuthorTitles(author, oldestShown.block, oldestShown.index, n);
}

/**
 * Find the metadata for a single (author, index) — used for deep links.
 * Walks the per-author reverse chain backwards until we find it or pass it,
 * reusing cached rows (global + per-author) per block.
 */
export async function findTitleMeta(author, targetIndex) {
  // Guard against garbage from the URL (?i=abc): BigInt(NaN) throws, and
  // negative / fractional indexes can never match a real post.
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) return null;
  const target = BigInt(targetIndex);
  const fetchRows = makeRowLookup(author);
  let block = await readHead(author);
  while (block > 0n) {
    const rows = await fetchRows(block);
    if (rows.length === 0) return null;
    for (const m of rows) {
      if (m.index === target) return m;
    }
    const oldestIdxInBlock = rows[rows.length - 1].index;
    if (oldestIdxInBlock < target) return null; // walked past
    block = rows[rows.length - 1].prevBlock;
  }
  return null;
}

/**
 * Home feed: most recent `n` posts across ALL authors.
 *
 * NOTE: this is the one place we deliberately break the "never scan ranges"
 * rule — there is no global on-chain head pointer, so cross-author discovery
 * with no address requires scanning. It's bounded and best-effort: we sweep
 * backwards in windows of `windowSize` blocks (to respect public-RPC range
 * limits) for at most `maxWindows` windows, or until we have `n` posts.
 * Quiet stretches with no posts are simply skipped over.
 */
// The home-feed scan is incremental: the covered frontier (lowest block
// scanned), the head at that time and the discovered rows are persisted
// to localStorage, so a new scan only fetches blocks newer than the last
// covered head and never rescans already-covered ranges. Previously
// discovered rows are merged back so the feed stays full between scans.
const FEED_SCAN_KEY = 'glyph.feedScan.v1';
const MERGE_CAP = 300; // persisted global rows (storage bound)
const FEED_SCAN_EVT = 'glyph:feedscan';
const AUTHOR_SCAN_KEY = 'glyph.authorScan.v1';

/** Persisted feed-scan state: { head, frontier, rows } or null. */
export function readFeedScan() {
  try {
    const v = JSON.parse(localStorage.getItem(FEED_SCAN_KEY) || 'null');
    if (v && typeof v.head === 'string' && Array.isArray(v.rows)) return v;
  } catch {
    /* corrupted entry — treat as first scan */
  }
  return null;
}

function writeFeedScan(scan) {
  try {
    localStorage.setItem(FEED_SCAN_KEY, JSON.stringify(scan));
  } catch {
    /* quota / privacy mode — scan stays in-memory via the TTL layer */
  }
  // Let listeners (e.g. the footer) re-read the persisted range.
  try {
    window.dispatchEvent(new CustomEvent(FEED_SCAN_EVT));
  } catch {
    /* non-browser context */
  }
}

// --- Per-author persisted scans ({ address: { head, rows } }) ---
//
// Each visited author gets their own covered range, so revisiting an
// author with no new posts costs zero getLogs, and the global feed scan
// above is reused instead of re-walking blocks every address shares.

function readAuthorScans() {
  try {
    const v = JSON.parse(localStorage.getItem(AUTHOR_SCAN_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeAuthorScan(author, scan) {
  try {
    const all = readAuthorScans();
    all[String(author).toLowerCase()] = scan;
    localStorage.setItem(AUTHOR_SCAN_KEY, JSON.stringify(all));
  } catch {
    /* quota / privacy mode — falls back to the TTL layer */
  }
}

/**
 * Row lookup for one author that consults the GLOBAL feed scan and the
 * author's own persisted scan first (no RPC), falling back to a single-
 * block getLogs for uncovered blocks. Blocks already covered by either
 * layer are never re-fetched.
 */
function makeRowLookup(author) {
  const key = String(author).toLowerCase();
  const stored = readAuthorScans()[key];
  const global = readFeedScan();
  const byBlock = new Map();
  const seen = new Set();
  const push = (rows) => {
    for (const r of rows) {
      const id = `${r.block}:${r.index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const list = byBlock.get(String(r.block)) ?? [];
      list.push(r);
      byBlock.set(String(r.block), list);
    }
  };
  push((global?.rows ?? []).filter((r) => String(r.author).toLowerCase() === key));
  push(stored?.rows ?? []);

  return async (block) => {
    const cached = byBlock.get(String(block));
    if (cached) return cached;
    const logs = await postsInBlock(author, block);
    const rows = logs.map((log) => logToMeta(log, block));
    push(rows);
    return byBlock.get(String(block));
  };
}

/** Walk the author's reverse block chain, reusing cached rows per block. */
async function walkAuthorTitles(author, startBlock, skipIndex, n) {
  const fetchRows = makeRowLookup(author);
  let block = startBlock;
  let skip = skipIndex;
  const out = [];
  while (out.length < n && block > 0n) {
    const rows = await fetchRows(block);
    if (rows.length === 0) break;
    rows.sort((a, b) => Number(b.index - a.index));
    for (const m of rows) {
      if (skip != null && m.index >= skip) continue;
      out.push(m);
      if (out.length >= n) break;
    }
    skip = null;
    block = rows[rows.length - 1].prevBlock;
  }
  return out;
}

// NOTE: a TTL cache for this scan also lives in data.js (configurable in
// Settings); this function handles the persistent incremental layer.
export async function loadRecentAcrossAuthors(
  n,
  { windowSize = 800, maxWindows = 30 } = {},
) {
  const span = BigInt(windowSize);
  const head = await client.getBlockNumber();
  const stored = readFeedScan();
  const cachedRows = stored?.rows ?? [];
  const out = [];

  const newestFirst = (logs) =>
    logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
      return b.logIndex - a.logIndex;
    });

  // No new blocks since the last scan — serve the persisted result
  // without touching getLogs at all.
  if (stored?.head != null && head <= BigInt(stored.head)) {
    return cachedRows.slice(0, n);
  }

  // Scan the newest blocks down to the previously covered frontier (or
  // maxWindows windows on the first visit), stopping early once n posts
  // are collected. The first window ends at 'latest': public RPC clusters
  // (dRPC, etc.) can serve getBlockNumber and getLogs from different
  // nodes, and a numeric toBlock captured a moment earlier may already
  // exceed the answering node's head.
  const storedFrontier = stored?.frontier != null ? BigInt(stored.frontier) : null;
  let coveredFrontier = storedFrontier;
  let toBlock = head;
  let logs;
  for (let w = 0; w < maxWindows && out.length < n && toBlock > 0n; w++) {
    if (storedFrontier != null && toBlock <= storedFrontier) break; // already covered
    const fromBlock = toBlock >= span ? toBlock - span + 1n : 0n;
    logs = await withRetry(() =>
      client.getLogs({
        address: GLYPH_ADDRESS,
        event: POST_EVENT,
        fromBlock,
        toBlock: w === 0 ? 'latest' : toBlock,
      }),
    );
    newestFirst(logs);
    assignEventIndexes(logs);
    for (const log of logs) {
      out.push(logToMeta(log, log.blockNumber));
      if (out.length >= n) break;
    }
    // The frontier only ever moves DOWN (first scan): later scans cover
    // ranges above it, so it must never be raised again.
    if (coveredFrontier == null || fromBlock < coveredFrontier) {
      coveredFrontier = fromBlock;
    }
    if (fromBlock === 0n) break;
    toBlock = fromBlock - 1n;
  }

  // Merge with previously discovered rows (newest first), dedupe by
  // txHash + eventIndex. Persist up to MERGE_CAP rows so per-author
  // scans can reuse the global coverage; the feed itself returns n.
  const seen = new Set();
  const merged = [];
  for (const row of [...out, ...cachedRows]) {
    const key = `${row.txHash}:${row.eventIndex ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
    if (merged.length >= MERGE_CAP) break;
  }

  if (coveredFrontier != null) {
    writeFeedScan({
      head: head.toString(),
      frontier: coveredFrontier.toString(),
      rows: merged,
    });
  }
  return merged.slice(0, n);
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
 * several posts). Reads the receipt and decodes the chosen Post log —
 * one RPC call, no scanning. Returns null when there is no such event.
 */
export async function findMetaByTx(txHash, eventIndex = 0) {
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
  const chosen = posts[eventIndex];
  if (!chosen) return null;
  return {
    author: chosen.args.author,
    index: chosen.args.index,
    block: receipt.blockNumber,
    prevBlock: chosen.args.prevBlock,
    title: decodeTitle(chosen.args.title),
    txHash,
    eventIndex,
  };
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
  const blobs = await Promise.all(matches.map((m) => loadImageBlob(m[2])));
  const urls = blobs.map((blob) => URL.createObjectURL(blob));
  let out = markdown;
  matches.forEach((m, i) => {
    out = out.split(m[0]).join('![' + m[1] + '](' + urls[i] + ')');
  });
  return { markdown: out, urls };
}
