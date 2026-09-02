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

/** Load `author`'s most recent `n` post-metadata records (newest first). */
export async function loadTitleList(author, n) {
  return walkBack(author, await readHead(author), null, n);
}

/** Continue walking from the oldest title already shown. */
export async function loadMoreTitles(author, oldestShown, n) {
  if (!oldestShown) return [];
  return walkBack(author, oldestShown.block, oldestShown.index, n);
}

/**
 * Find the metadata for a single (author, index) — used for deep links.
 * Walks the per-author reverse chain backwards until we find it or pass it.
 */
export async function findTitleMeta(author, targetIndex) {
  // Guard against garbage from the URL (?i=abc): BigInt(NaN) throws, and
  // negative / fractional indexes can never match a real post.
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) return null;
  const target = BigInt(targetIndex);
  let block = await readHead(author);
  while (block > 0n) {
    const logs = await postsInBlock(author, block);
    if (logs.length === 0) return null;
    for (const log of logs) {
      if (log.args.index === target) return logToMeta(log, block);
    }
    const oldestIdxInBlock = logs[logs.length - 1].args.index;
    if (oldestIdxInBlock < target) return null; // walked past
    block = logs[logs.length - 1].args.prevBlock;
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
// NOTE: TTL caching for this scan lives in data.js (configurable in
// Settings) — this function always hits the chain.
export async function loadRecentAcrossAuthors(
  n,
  { windowSize = 800, maxWindows = 30 } = {},
) {
  const span = BigInt(windowSize);
  const head = await client.getBlockNumber();
  const out = [];

  const newestFirst = (logs) =>
    logs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
      return b.logIndex - a.logIndex;
    });

  // The first window ends at 'latest' instead of the captured head: public
  // RPC clusters (dRPC, etc.) can serve getBlockNumber and getLogs from
  // different nodes, and a numeric toBlock captured a moment earlier may
  // already exceed the answering node's head ("block range extends beyond
  // current head block"). Subsequent windows are far below the head, so
  // numeric bounds are safe there.
  let logs = await withRetry(() =>
    client.getLogs({
      address: GLYPH_ADDRESS,
      event: POST_EVENT,
      fromBlock: head >= span ? head - span + 1n : 0n,
      toBlock: 'latest',
    }),
  );
  newestFirst(logs);
  assignEventIndexes(logs);
  for (const log of logs) {
    out.push(logToMeta(log, log.blockNumber));
    if (out.length >= n) break;
  }

  let toBlock = head >= span ? head - span : 0n;
  for (let w = 1; w < maxWindows && out.length < n && toBlock > 0n; w++) {
    const fromBlock = toBlock >= span ? toBlock - span + 1n : 0n;
    logs = await withRetry(() =>
      client.getLogs({
        address: GLYPH_ADDRESS,
        event: POST_EVENT,
        fromBlock,
        toBlock,
      }),
    );
    newestFirst(logs);
    assignEventIndexes(logs);
    for (const log of logs) {
      out.push(logToMeta(log, log.blockNumber));
      if (out.length >= n) break;
    }
    if (fromBlock === 0n) break;
    toBlock = fromBlock - 1n;
  }
  return out.slice(0, n);
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
