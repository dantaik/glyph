// reader.js — everything a page reads, on ONE chain.
//
// A reader bundles a chain's client-facing I/O (chainIO.js), its scan store
// (what has already been read), the feed and author-list controllers whose
// scans run to completion regardless of what the page is showing, and the
// one-shot reads — a post by deep link, a body, an image, an ENS name, the
// chain clock. Every cache in here belongs to this chain alone: nothing read
// on one chain is ever served for another.
//
// Readers are created by data.js, one per chain, and live for the page.

import { deployBlock, getChain, logWindow, scanBlocks } from './chains';
import { getRescanDelayMs, VOLATILE_TTL_MS } from './config';
import { addrKey, getScanStore } from './scanStore';
import * as scanner from './scanner';
import * as rpcLog from './rpcLog';
import { makeForeverCache, makeTtlCache } from './ttlCache';
import { createChainIO } from './chainIO';
import { FeedController } from './feed';
import { AuthorListController } from './authorList';
import { getCachedBody, setCachedBody, getCachedImage, setCachedImage } from './cache';
import { createRefResolver } from './glyphRefs';

/** Posts per page, on the feed and on author lists. */
export const PAGE_SIZE = 20;

/** Blocks between the two samples the chain clock measures block time over. */
const CLOCK_SAMPLE = 1000n;
const FALLBACK_SECONDS_PER_BLOCK = 12;

const short = (s) => `${String(s).slice(0, 10)}…`;

/**
 * Build the reader for `chainId`. `makeIO(chainId, log)` swaps the chain
 * I/O — fixtures.js uses it to run the reader on an in-memory chain — and
 * `store` swaps the chain's scan store (tests hand in a fresh one; the app
 * uses the page-wide store for the chain).
 */
export function createReader(chainId, { makeIO = null, store: ownStore = null } = {}) {
  const id = Number(chainId);
  const chain = getChain(id);
  const log = rpcLog.scoped(chain.name);
  const store = ownStore ?? getScanStore(id);
  const io = makeIO ? makeIO(id, log) : createChainIO(id, log);
  // Two caches, because there are two kinds of read.
  //
  // `forever` holds what the chain cannot change: a post's metadata is
  // fixed by the transaction carrying it, so once read it is never read
  // again. (Bodies and images are immutable too, and are cached harder
  // still — in IndexedDB, across visits.)
  //
  // `volatile` holds the two answers that really do move — the head block
  // and an author's post count — for a short fixed window.
  const forever = makeForeverCache();
  const volatile = makeTtlCache(() => VOLATILE_TTL_MS);

  const feed = new FeedController({
    chainId: id,
    store,
    io,
    log,
    windowSize: io.windowSize ?? logWindow(id),
    floor: io.floor ?? deployBlock(id),
    scanBlocks: io.scanBlocks ?? scanBlocks(id),
    pageSize: PAGE_SIZE,
    getTtlMs: getRescanDelayMs,
  });

  /**
   * When `block` was mined, in seconds — exact. A row already carrying it
   * answers at once; otherwise one header read, kept for the page (blocks
   * are immutable, so it can never go stale).
   */
  const blockTime = (block) =>
    forever(`ts:${block}`, async () => {
      const known = store.knownBlockTs(block);
      if (known != null) return known;
      return (await io.block(block)).timestamp;
    });

  const lists = new Map(); // addrKey -> AuthorListController
  function authorList(author) {
    const key = addrKey(author);
    let list = lists.get(key);
    if (!list) {
      list = new AuthorListController({
        author,
        store,
        io,
        log,
        pageSize: PAGE_SIZE,
        getTtlMs: getRescanDelayMs,
      });
      lists.set(key, list);
    }
    return list;
  }

  // --- Post metadata by deep link ----------------------------------------

  const metaKey = (author, index) => `meta:${addrKey(author)}:${index}`;
  const txMetaKey = (txHash, eventIndex) => `txmeta:${String(txHash).toLowerCase()}:${eventIndex}`;

  /**
   * Warm BOTH meta cache keys for a resolved post: resolving a neighbor via
   * findTitleMeta pre-warms its /tx/<hash> entry (and vice versa), so
   * prev/next navigation hits the cache instantly.
   */
  function cacheMetaBoth(meta) {
    if (!meta) return meta;
    forever(metaKey(meta.author, meta.index), () => Promise.resolve(meta));
    forever(txMetaKey(meta.txHash, meta.eventIndex ?? 0), () => Promise.resolve(meta));
    return meta;
  }

  /**
   * Find the metadata for a single (author, index) — deep links and
   * prev/next navigation. Answered outright when the post has already been
   * read this session; otherwise walks the reverse chain, reusing covered
   * blocks.
   */
  function findTitleMeta(author, targetIndex) {
    // Guard against garbage from the URL (?i=abc): BigInt(NaN) throws, and
    // negative / fractional indexes can never match a real post.
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) return Promise.resolve(null);
    return forever(metaKey(author, targetIndex), async () => {
      const known = store.knownPost(author, BigInt(targetIndex));
      if (known) {
        log.fromCache('post', `#${targetIndex} of ${short(author)}`, 'already loaded');
        return cacheMetaBoth(known);
      }
      const head = await io.latestBlock(author);
      const found = await scanner.findAuthorPost({
        store,
        log,
        author,
        targetIndex,
        startBlock: head,
        fetchBlock: (block) => io.authorPostsInBlock(author, block),
      });
      store.persistAuthorScan(author);
      return cacheMetaBoth(found);
    });
  }

  /**
   * Resolve post metadata from a publish transaction hash + the 0-based
   * ordinal of the Post event within that transaction (one tx can publish
   * several posts). One receipt read, no scanning. Null when there is no
   * such event.
   */
  function findMetaByTx(txHash, eventIndex = 0) {
    return forever(txMetaKey(txHash, eventIndex), async () => {
      const known = store.knownPostByTx(txHash, eventIndex);
      if (known) {
        log.fromCache('post', `${short(txHash)}/${eventIndex}`, 'already loaded');
        return cacheMetaBoth(known);
      }
      // Remember every post in the transaction, not just the one asked for:
      // a sibling opened later in the session is then already resolved.
      const rows = store.rememberPosts(await io.postsInTx(txHash));
      return cacheMetaBoth(rows[eventIndex] ?? null);
    });
  }

  const count = (author) => volatile(`count:${addrKey(author)}`, () => io.count(author));

  /** Rewrite `0x<txhash>/<n>` article refs to in-app links (glyphRefs.js). */
  const resolveGlyphRefs = createRefResolver(findMetaByTx, id);

  /**
   * `{ block, ts, secondsPerBlock }` — the chain's newest block and how
   * fast blocks have been coming, measured over the last CLOCK_SAMPLE
   * blocks. Every chain keeps its own pace (Ethereum 12s, Taiko ~2s), so
   * the pace is read, not assumed.
   */
  const clock = () =>
    volatile('clock', async () => {
      const latest = await io.block('latest');
      const sampleAt = latest.number > CLOCK_SAMPLE ? latest.number - CLOCK_SAMPLE : 0n;
      let secondsPerBlock = FALLBACK_SECONDS_PER_BLOCK;
      if (sampleAt < latest.number) {
        const older = await io.block(sampleAt);
        const blocks = Number(latest.number - older.number);
        const seconds = latest.timestamp - older.timestamp;
        if (blocks > 0 && seconds > 0) secondsPerBlock = seconds / blocks;
      }
      return { block: latest.number, ts: latest.timestamp, secondsPerBlock };
    });

  // --- ENS names — cached; null when the address has none, or when the
  //     chain doesn't host ENS (only Ethereum mainnet does). -------------

  const ens = new Map(); // address (lowercase) -> Promise<string | null>

  function ensName(address) {
    const key = addrKey(address);
    if (ens.has(key)) return ens.get(key);
    const promise = io.ensName(address).catch(() => null); // RPC hiccup → no name
    ens.set(key, promise);
    return promise;
  }

  // --- Post body (tags + markdown) — fetched on demand from tx calldata,
  //     with IndexedDB permanent cache (posts are immutable on-chain). ---

  const bodies = new Map(); // txHash -> Promise<{ body, fromCache }>

  /**
   * Load a post body ({ tags, markdown }) plus whether it came from the
   * local IndexedDB cache, so the UI can label 来自本地缓存.
   */
  function loadPostBody(txHash) {
    if (bodies.has(txHash)) return bodies.get(txHash);
    const promise = (async () => {
      // Posts are immutable, so a cached copy is always fresh. Demo data
      // (fixtures) is never written to the real cache.
      const cached = io.ephemeral ? null : await getCachedBody(id, txHash);
      if (cached) {
        log.fromCache('body', short(txHash), 'IndexedDB hit');
        return { body: cached, fromCache: true };
      }
      const body = await io.postBody(txHash);
      if (!io.ephemeral) setCachedBody(id, txHash, body).catch(() => {});
      return { body, fromCache: false };
    })();
    promise.catch(() => bodies.delete(txHash));
    bodies.set(txHash, promise);
    return promise;
  }

  // --- Image resolution — with permanent IndexedDB cache ---------------
  //
  // We cache Blobs (not object URLs): each caller mints fresh URLs from the
  // shared Blob and revokes them when done, so long sessions don't leak.

  const images = new Map(); // hash -> Promise<Blob>

  function loadImageBlob(hash, mime = 'image/webp') {
    if (images.has(hash)) return images.get(hash);
    const promise = (async () => {
      const cached = io.ephemeral ? null : await getCachedImage(id, hash);
      if (cached) {
        log.fromCache('image', short(hash), 'IndexedDB hit');
        return cached;
      }
      const bytes = await io.imageBytes(hash);
      if (!io.ephemeral) setCachedImage(id, hash, bytes.buffer).catch(() => {});
      return new Blob([bytes], { type: mime });
    })();
    promise.catch(() => images.delete(hash));
    images.set(hash, promise);
    return promise;
  }

  /**
   * Resolve `eth:0x<txhash>` image refs to blob URLs.
   * @returns {Promise<{ markdown: string, urls: string[] }>} rewritten
   *   markdown plus the fresh object URLs — the caller must revoke them.
   */
  async function resolveImages(markdown) {
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

  return {
    chainId: id,
    chain,
    store,
    io,
    log,
    feed,
    authorList,
    findTitleMeta,
    findMetaByTx,
    count,
    clock,
    blockTime,
    ensName,
    loadPostBody,
    resolveGlyphRefs,
    resolveImages,
  };
}
