// scanStore.js — everything the reader has already read from ONE chain, at
// two lifetimes.
//
// SESSION layer (module state, never expires). Every post this tab has seen,
// indexed by (author, index, contract version) and by (txHash, eventIndex),
// plus the block ranges the tab has genuinely fetched. Posts are immutable
// once mined, so a second fetch could only ever return the same bytes: once
// ANY surface — the home feed, an author list, a /tx deep link, prev/next
// navigation — has read a post, no other surface fetches it again for the
// life of the page.
//
// PERSISTED layer (localStorage). A bounded snapshot of the same thing, so a
// fresh session starts warm. The session layer is seeded from it when the
// store is created; writes flow back after every fetched window or block,
// so an interrupted scan (a closed tab, a lost connection) keeps what it
// had read up to that point.
//
// ONE STORE PER CHAIN. Block heights, post indexes and transaction hashes
// mean nothing across chains, so nothing here is shared between them:
// getScanStore(chainId) hands out a chain's store and keeps it for the life
// of the page. A scan on one chain keeps writing to its own store no matter
// which chain the reader is showing.
//
// TWO CONTRACTS PER CHAIN. A chain is read on every contract version at
// once (v1 and v2, chains.js), and an author has an independent list —
// their own index sequence, their own reverse-linked walk — on each. So a
// post is identified by (author, index, version), and an author's walk head
// is kept per version. Coverage, on the other hand, is per chain: every
// fetch asks for every contract, so a block or range read once is read for
// all of them. Coverage recorded by an older build that read fewer contracts
// is not trusted: the persisted snapshot names the versions it was read
// under, and one read under a different set keeps its rows but drops its
// ranges and heads, so the blocks are read again for what was missed.
//
// Coverage is a SET of ranges, not one `[frontier, head]` window: blocks
// 1–100 read once and 200–300 read later are two segments, and a read that
// sweeps 200 down to 50 fetches only 199–101 — 100–1 come from the rows
// already held for that segment. See segments.js.

import * as seg from './segments';

/** Persisted global rows (storage bound). The session keeps every row it saw. */
export const FEED_ROW_CAP = 300;
/** Persisted rows per author (storage bound). */
export const AUTHOR_ROW_CAP = 200;

export const addrKey = (a) => String(a || '').toLowerCase();

/**
 * A post's identity within a chain. Version 1 keeps the key it always had,
 * so nothing that held one — a meta cache, a test — reads differently.
 */
export const postId = (author, index, version = 1) =>
  Number(version ?? 1) === 1 ? `${addrKey(author)}:${index}` : `${addrKey(author)}:${index}@${Number(version)}`;

export const txId = (txHash, eventIndex = 0) =>
  `${String(txHash || '').toLowerCase()}:${Number(eventIndex ?? 0)}`;

/** An author's walk head, per contract version. */
const headKey = (author, version = 1) =>
  Number(version ?? 1) === 1 ? addrKey(author) : `${addrKey(author)}@${Number(version)}`;

const sameVersions = (a, b) => {
  const x = [...new Set((a ?? []).map(Number))].sort((p, q) => p - q);
  const y = [...new Set((b ?? []).map(Number))].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * One canonical in-memory row shape. Chain reads hand us BigInt heights,
 * localStorage hands back plain numbers; normalizing on the way in keeps
 * every comparison downstream honest.
 */
function normalizeRow(row) {
  return {
    author: row.author,
    index: BigInt(row.index),
    block: BigInt(row.block),
    prevBlock: BigInt(row.prevBlock ?? 0),
    title: row.title,
    txHash: row.txHash,
    eventIndex: Number(row.eventIndex ?? 0),
    // Absent on rows persisted before ordering-within-a-block was tracked.
    logIndex: row.logIndex == null ? null : Number(row.logIndex),
    // The block's timestamp in seconds. Absent on rows persisted before it
    // was read; filled in later by rememberBlockTs().
    ts: row.ts == null ? null : Number(row.ts),
    // Which contract the post is on. Rows persisted before v2 are v1's.
    version: row.version == null ? 1 : Number(row.version),
    // The hook a v2 post went through (lowercase), or null.
    hook: row.hook ? String(row.hook).toLowerCase() : null,
  };
}

/** JSON-safe row: localStorage is JSON-only and JSON.stringify throws on BigInt. */
const plainRow = (r) => ({
  author: r.author,
  index: Number(r.index),
  block: Number(r.block),
  prevBlock: Number(r.prevBlock),
  title: r.title,
  txHash: r.txHash,
  eventIndex: r.eventIndex ?? 0,
  logIndex: r.logIndex ?? null,
  ts: r.ts ?? null,
  version: r.version ?? 1,
  hook: r.hook ?? null,
});

/** Feed order: newest first — higher block, then higher log index. */
export function feedCompare(a, b) {
  if (a.block !== b.block) return b.block > a.block ? 1 : -1;
  return (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

/** Author order within one contract: newest (highest index) first. */
export const indexCompare = (a, b) => (a.index < b.index ? 1 : a.index > b.index ? -1 : 0);

/**
 * True when `row` sits strictly older than `cursor` in feed order. Rows
 * cached without a log index fall back to block granularity.
 */
export function isOlder(row, cursor) {
  if (row.block !== cursor.block) return row.block < cursor.block;
  if (row.logIndex == null || cursor.logIndex == null) return false;
  return row.logIndex < cursor.logIndex;
}

/**
 * Keep the newest `cap` rows and report the lowest block whose coverage may
 * still be claimed. Coverage may only be claimed for ranges whose rows are
 * retained IN FULL — otherwise a later read would skip a block believing it
 * already holds every post in it.
 */
function trimRows(rows, cap) {
  if (rows.length <= cap) return { kept: rows, floor: null };
  const kept = rows.slice(0, cap);
  const edge = kept[kept.length - 1].block;
  // A clean cut at a block boundary keeps that block's coverage intact.
  if (rows[cap].block !== edge) return { kept, floor: edge };
  let i = kept.length;
  while (i > 0 && kept[i - 1].block === edge) i--;
  // Degenerate case — a single block holds more rows than the cap: keep what
  // fits, but stop claiming that block.
  return { kept: i > 0 ? kept.slice(0, i) : kept, floor: edge + 1n };
}

function lsRead(key) {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null; // corrupted entry — treat as a first scan
  }
}

/**
 * Build the store for one chain. Prefer getScanStore(), which memoizes.
 * `versions` names the contracts this build reads the chain on; coverage
 * persisted under a different set is not trusted (see the header).
 */
export function createScanStore(chainId, { versions = [1] } = {}) {
  const id = Number(chainId);
  const contracts = [...new Set(versions.map(Number))].sort((a, b) => a - b);
  // Block heights and post indexes mean nothing across chains, so every
  // persisted key is scoped to the chain. The v1 keys were mainnet-only.
  const FEED_KEY = `glyph.feedScan.v2.${id}`;
  const FEED_KEY_LEGACY = id === 1 ? 'glyph.feedScan.v1' : null;
  const AUTHOR_KEY = `glyph.authorScan.v2.${id}`;
  const AUTHOR_KEY_LEGACY = id === 1 ? 'glyph.authorScan.v1' : null;

  // --- Session state --------------------------------------------------

  const posts = new Map(); // postId -> row
  const idByTx = new Map(); // txId -> postId
  const idsByBlock = new Map(); // block (string) -> Set<postId>
  /** Ranges read in full for EVERY author (home-feed window fetches). */
  let feedSegments = [];
  /** addrKey -> ranges read in full for that one author (single-block fetches). */
  const authorSegments = new Map();
  /** Chain head at the last completed feed scan, as a decimal string. */
  let feedHead = null;
  /** headKey -> the author's `latestBlock` on that contract at their last completed walk. */
  const authorHeads = new Map();

  // --- Change notification ------------------------------------------
  //
  // Anything that shows rows subscribes here and re-derives its view after
  // every mutation, so a sweep's findings reach the page window by window.

  const listeners = new Set();
  let version = 0;
  function notify() {
    version += 1;
    for (const fn of listeners) fn();
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * File one row. A post already held stays the canonical row, but a
   * newcomer fills in what the held one lacks — the log index (rows
   * persisted before in-block ordering was tracked) or the timestamp — as a
   * fresh object, so anything holding the old one sees a change.
   */
  function indexRow(row) {
    const key = postId(row.author, row.index, row.version);
    const prev = posts.get(key);
    if (prev) {
      const fills = {};
      if (prev.logIndex == null && row.logIndex != null) fills.logIndex = row.logIndex;
      if (prev.ts == null && row.ts != null) fills.ts = row.ts;
      if (prev.hook == null && row.hook != null) fills.hook = row.hook;
      if (Object.keys(fills).length === 0) return { row: prev, changed: false };
      const merged = { ...prev, ...fills };
      posts.set(key, merged);
      return { row: merged, changed: true };
    }
    posts.set(key, row);
    idByTx.set(txId(row.txHash, row.eventIndex), key);
    const b = String(row.block);
    const set = idsByBlock.get(b) ?? new Set();
    set.add(key);
    idsByBlock.set(b, set);
    return { row, changed: true };
  }

  /** Record posts the session has read. Returns the canonical row objects. */
  function rememberPosts(rows) {
    let changed = false;
    const out = (rows ?? []).map((r) => {
      const res = indexRow(normalizeRow(r));
      changed = changed || res.changed;
      return res.row;
    });
    if (changed) notify();
    return out;
  }

  /**
   * A block's timestamp arrived: give it to every row in that block still
   * without one. Returns whether anything changed.
   */
  function rememberBlockTs(block, ts) {
    if (ts == null) return false;
    const ids = idsByBlock.get(String(block));
    if (!ids) return false;
    let changed = false;
    for (const pid of ids) {
      const row = posts.get(pid);
      if (row && row.ts == null) {
        posts.set(pid, { ...row, ts: Number(ts) });
        changed = true;
      }
    }
    if (changed) notify();
    return changed;
  }

  /** The timestamp of `block` if any row in it carries one, else null. */
  function knownBlockTs(block) {
    const ids = idsByBlock.get(String(block));
    if (!ids) return null;
    for (const pid of ids) {
      const ts = posts.get(pid)?.ts;
      if (ts != null) return ts;
    }
    return null;
  }

  /** Record that `[from, to]` was read in full, for every author. */
  function rememberFeedRange(from, to) {
    feedSegments = seg.add(feedSegments, from, to);
    notify();
  }

  /** Record that `block` was read in full for one author. */
  function rememberAuthorBlock(author, block) {
    const key = addrKey(author);
    authorSegments.set(key, seg.add(authorSegments.get(key) ?? [], block, block));
    notify();
  }

  /** A post already read this session, or null — no RPC needed either way. */
  const knownPost = (author, index, version = 1) => posts.get(postId(author, index, version)) ?? null;

  /** Same, addressed by publish transaction + event ordinal. */
  function knownPostByTx(txHash, eventIndex = 0) {
    const key = idByTx.get(txId(txHash, eventIndex));
    return key ? (posts.get(key) ?? null) : null;
  }

  /** Every post the session holds, newest first. */
  const allPosts = () => [...posts.values()].sort(feedCompare);

  /** Posts the session holds inside `[from, to]`, newest first. */
  function postsInRange(from, to) {
    const out = [];
    for (const row of posts.values()) {
      if (row.block >= from && row.block <= to) out.push(row);
    }
    return out.sort(feedCompare);
  }

  /**
   * Posts inside ranges swept for every author, newest first.
   *
   * Deliberately NOT "every post the store knows": a post found by an author
   * walk sits in an unswept range, and listing it would put a hole in the
   * feed — and hand load-more a cursor below blocks nobody has read. A range
   * shows up once it has actually been swept.
   */
  function coveredPosts() {
    const out = [];
    for (const [from, to] of feedSegments) out.push(...postsInRange(from, to));
    return out.sort(feedCompare);
  }

  /**
   * One author's posts inside a block: on one contract (newest index
   * first), or on every contract (newest in the block first) when `version`
   * is null.
   */
  function authorPostsInBlock(author, block, version = null) {
    const ids = idsByBlock.get(String(block));
    if (!ids) return [];
    const key = addrKey(author);
    const wanted = version == null ? null : Number(version);
    const out = [];
    for (const pid of ids) {
      const row = posts.get(pid);
      if (row && addrKey(row.author) === key && (wanted == null || row.version === wanted)) out.push(row);
    }
    return out.sort(wanted == null ? feedCompare : indexCompare);
  }

  /** One author's posts, on one contract or all, newest first. */
  function authorPosts(author, version = null) {
    const key = addrKey(author);
    const wanted = version == null ? null : Number(version);
    const out = [];
    for (const row of posts.values()) {
      if (addrKey(row.author) === key && (wanted == null || row.version === wanted)) out.push(row);
    }
    return out.sort(wanted == null ? feedCompare : indexCompare);
  }

  /** Ranges proven complete for every author. */
  const feedCoverage = () => feedSegments;

  /**
   * Ranges proven complete for `author` — their own single-block reads plus
   * the global feed sweeps, which record every Post event in the range.
   */
  const authorCoverage = (author) =>
    seg.normalize([...(authorSegments.get(addrKey(author)) ?? []), ...feedSegments]);

  /**
   * The author's chain on one contract from `fromBlock` down, as far as
   * covered blocks reach — the rows a completed walk left behind, without
   * any I/O. Stops at the first block that would have to be fetched.
   */
  function knownChain(author, fromBlock, version = 1) {
    const out = [];
    const coverage = authorCoverage(author);
    let block = BigInt(fromBlock);
    while (block > 0n && seg.segmentAt(coverage, block)) {
      const rows = authorPostsInBlock(author, block, version);
      if (rows.length === 0) break;
      out.push(...rows);
      const next = rows[rows.length - 1].prevBlock;
      if (next >= block) break;
      block = next;
    }
    return out;
  }

  const feedScanHead = () => feedHead;
  const authorScanHead = (author, version = 1) => authorHeads.get(headKey(author, version)) ?? null;
  function setFeedScanHead(head) {
    feedHead = String(head);
    notify();
  }
  function setAuthorScanHead(author, head, version = 1) {
    authorHeads.set(headKey(author, version), String(head));
    notify();
  }

  // --- localStorage snapshot -----------------------------------------

  /** Snapshot the session's global view to localStorage (bounded). */
  function persistFeedScan() {
    const { kept, floor } = trimRows(allPosts(), FEED_ROW_CAP);
    const segments = floor == null ? feedSegments : seg.clipBelow(feedSegments, floor);
    try {
      localStorage.setItem(
        FEED_KEY,
        JSON.stringify({
          contracts,
          head: feedHead,
          segments: seg.toPlain(segments),
          rows: kept.map(plainRow),
        }),
      );
      if (FEED_KEY_LEGACY) localStorage.removeItem(FEED_KEY_LEGACY);
    } catch {
      /* quota / privacy mode — the session layer still holds everything */
    }
  }

  /** Snapshot one author's view to localStorage (bounded). */
  function persistAuthorScan(author) {
    const key = addrKey(author);
    const { kept, floor } = trimRows(authorPosts(author), AUTHOR_ROW_CAP);
    const own = authorSegments.get(key) ?? [];
    const segments = floor == null ? own : seg.clipBelow(own, floor);
    const heads = {};
    for (const v of contracts) {
      const head = authorHeads.get(headKey(author, v));
      if (head != null) heads[v] = head;
    }
    try {
      const all = lsRead(AUTHOR_KEY) ?? {};
      all[key] = {
        contracts,
        // `head` is v1's, the field older builds read; `heads` has every contract's.
        head: heads[1] ?? null,
        heads,
        segments: seg.toPlain(segments),
        rows: kept.map(plainRow),
      };
      localStorage.setItem(AUTHOR_KEY, JSON.stringify(all));
    } catch {
      /* quota / privacy mode — the session layer still holds everything */
    }
  }

  // --- Seeding --------------------------------------------------------

  /**
   * Fold the persisted snapshot into the session layer. v1 stored a single
   * `[frontier, head]` window; that is simply the first segment. A snapshot
   * read under another set of contracts keeps its rows and nothing else.
   */
  function seedFromStorage() {
    const feed = lsRead(FEED_KEY);
    if (feed && Array.isArray(feed.rows)) {
      rememberPosts(feed.rows);
      if (sameVersions(feed.contracts ?? [1], contracts)) {
        feedSegments = seg.normalize([...feedSegments, ...seg.fromPlain(feed.segments)]);
        if (typeof feed.head === 'string') feedHead = feed.head;
      }
    } else {
      const legacy = lsRead(FEED_KEY_LEGACY);
      if (legacy && Array.isArray(legacy.rows)) {
        rememberPosts(legacy.rows);
        if (sameVersions([1], contracts)) {
          if (legacy.frontier != null && legacy.head != null) {
            feedSegments = seg.add(feedSegments, legacy.frontier, legacy.head);
          }
          if (typeof legacy.head === 'string') feedHead = legacy.head;
        }
      }
    }

    const authors = lsRead(AUTHOR_KEY) ?? {};
    for (const [address, scan] of Object.entries(authors)) {
      if (!scan || typeof scan !== 'object') continue;
      rememberPosts(Array.isArray(scan.rows) ? scan.rows : []);
      if (!sameVersions(scan.contracts ?? [1], contracts)) continue;
      authorSegments.set(addrKey(address), seg.fromPlain(scan.segments));
      const heads = scan.heads && typeof scan.heads === 'object' ? scan.heads : {};
      if (typeof scan.head === 'string' && heads[1] == null) heads[1] = scan.head;
      for (const [v, head] of Object.entries(heads)) {
        if (typeof head === 'string') authorHeads.set(headKey(address, v), head);
      }
    }

    // v1 per-author state has rows but no ranges: the rows are still worth
    // keeping (they answer post lookups), the coverage claim simply starts empty.
    const legacyAuthors = lsRead(AUTHOR_KEY_LEGACY);
    if (legacyAuthors && typeof legacyAuthors === 'object' && !lsRead(AUTHOR_KEY)) {
      for (const [address, scan] of Object.entries(legacyAuthors)) {
        if (!scan || typeof scan !== 'object') continue;
        rememberPosts(Array.isArray(scan.rows) ? scan.rows : []);
        if (typeof scan.head === 'string' && sameVersions([1], contracts)) {
          authorHeads.set(headKey(address, 1), scan.head);
        }
      }
    }
    notify();
  }

  // --- Read-only views for the UI (/scan) ------------------------------

  /** Per-author coverage: `{ address, head, segments, count }`, newest head first. */
  function readAuthorScanEntries() {
    const out = [];
    const seen = new Set();
    const headOf = (address) => {
      // The newest head on any contract, so the entry says how far the
      // author has been read whichever contract they wrote on last.
      let best = null;
      for (const v of contracts) {
        const h = authorHeads.get(headKey(address, v));
        if (h != null && (best == null || BigInt(h) > BigInt(best))) best = h;
      }
      return best;
    };
    for (const [address, segments] of authorSegments.entries()) {
      seen.add(address);
      out.push({ address, head: headOf(address), segments, count: authorPosts(address).length });
    }
    for (const key of authorHeads.keys()) {
      const address = key.split('@')[0];
      if (seen.has(address)) continue;
      seen.add(address);
      out.push({ address, head: headOf(address), segments: [], count: authorPosts(address).length });
    }
    out.sort((a, b) => {
      if (a.head == null || b.head == null) return a.head == null ? 1 : -1;
      const ha = BigInt(a.head);
      const hb = BigInt(b.head);
      return hb > ha ? 1 : hb < ha ? -1 : 0;
    });
    return out;
  }

  // --- In-flight fetches ---------------------------------------------
  //
  // Two surfaces can want the same block at the same moment — resolving a
  // post's prev and next neighbors runs both walks in parallel. Sharing the
  // promise keeps "fetched at most once per session" true under concurrency,
  // not just in sequence.

  const inflight = new Map(); // key -> Promise

  function once(key, fn) {
    const hit = inflight.get(key);
    if (hit) return hit;
    const promise = Promise.resolve()
      .then(fn)
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  /** Test / QA hook: forget everything the session has cached. */
  function reset() {
    inflight.clear();
    posts.clear();
    idByTx.clear();
    idsByBlock.clear();
    authorSegments.clear();
    authorHeads.clear();
    feedSegments = [];
    feedHead = null;
    notify();
  }

  seedFromStorage();

  return {
    chainId: id,
    /** The contract versions this store's coverage is read under. */
    versions: contracts,
    subscribe,
    getVersion: () => version,
    rememberPosts,
    rememberBlockTs,
    knownBlockTs,
    rememberFeedRange,
    rememberAuthorBlock,
    knownPost,
    knownPostByTx,
    allPosts,
    postsInRange,
    coveredPosts,
    authorPostsInBlock,
    authorPosts,
    knownChain,
    feedCoverage,
    authorCoverage,
    feedScanHead,
    authorScanHead,
    setFeedScanHead,
    setAuthorScanHead,
    persistFeedScan,
    persistAuthorScan,
    readAuthorScanEntries,
    once,
    reset,
  };
}

const stores = new Map(); // chainId -> store

/**
 * The store for `chainId`, created (and seeded from localStorage) on first
 * use. `versions` is honoured on that first use — the reader passes the
 * contracts its I/O reads.
 */
export function getScanStore(chainId, versions = undefined) {
  const id = Number(chainId);
  let store = stores.get(id);
  if (!store) {
    store = createScanStore(id, versions ? { versions } : {});
    stores.set(id, store);
  }
  return store;
}
