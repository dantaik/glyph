// scanStore.js — everything the reader has already read, at two lifetimes.
//
// SESSION layer (module state, never expires). Every post this tab has seen,
// indexed by (author, index) and by (txHash, eventIndex), plus the block
// ranges the tab has genuinely fetched. Posts are immutable once mined, so a
// second fetch could only ever return the same bytes: once ANY surface — the
// home feed, an author list, a /tx deep link, prev/next navigation — has read
// a post, no other surface fetches it again for the life of the page.
//
// PERSISTED layer (localStorage). A bounded snapshot of the same thing, so a
// fresh session starts warm. The session layer is seeded from it on first
// use; writes flow back on every scan.
//
// Coverage is a SET of ranges, not one `[frontier, head]` window: blocks
// 1–100 read once and 200–300 read later are two segments, and a read that
// sweeps 200 down to 50 fetches only 199–101 — 100–1 come from the rows
// already held for that segment. See segments.js.

import * as seg from './segments';
import { CHAIN_ID } from './config';

// Block heights and post indexes mean nothing across chains, so every scan
// key is scoped to the chain it was read from. The v1 keys were mainnet-only.
const FEED_KEY = `glyph.feedScan.v2.${CHAIN_ID}`;
const FEED_KEY_LEGACY = CHAIN_ID === 1 ? 'glyph.feedScan.v1' : null;
const AUTHOR_KEY = `glyph.authorScan.v2.${CHAIN_ID}`;
const AUTHOR_KEY_LEGACY = CHAIN_ID === 1 ? 'glyph.authorScan.v1' : null;

export const FEED_SCAN_EVT = 'glyph:feedscan';
export const AUTHOR_SCAN_EVT = 'glyph:authorscan';

/** Persisted global rows (storage bound). The session keeps every row it saw. */
const FEED_ROW_CAP = 300;
/** Persisted rows per author (storage bound). */
const AUTHOR_ROW_CAP = 200;

export const addrKey = (a) => String(a || '').toLowerCase();
export const postId = (author, index) => `${addrKey(author)}:${index}`;
export const txId = (txHash, eventIndex = 0) =>
  `${String(txHash || '').toLowerCase()}:${Number(eventIndex ?? 0)}`;

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
});

/** Feed order: newest first — higher block, then higher log index. */
export function feedCompare(a, b) {
  if (a.block !== b.block) return b.block > a.block ? 1 : -1;
  return (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

/**
 * True when `row` sits strictly older than `cursor` in feed order. Rows
 * cached without a log index fall back to block granularity.
 */
export function isOlder(row, cursor) {
  if (row.block !== cursor.block) return row.block < cursor.block;
  if (row.logIndex == null || cursor.logIndex == null) return false;
  return row.logIndex < cursor.logIndex;
}

// --- Session state ----------------------------------------------------

const posts = new Map(); // postId -> row
const idByTx = new Map(); // txId -> postId
const idsByBlock = new Map(); // block (string) -> Set<postId>
/** Ranges read in full for EVERY author (home-feed window fetches). */
let feedSegments = [];
/** addrKey -> ranges read in full for that one author (single-block fetches). */
const authorSegments = new Map();
/** Chain head at the last completed feed scan, as a decimal string. */
let feedHead = null;
/** addrKey -> the author's `latestBlock` at their last completed walk. */
const authorHeads = new Map();

function indexRow(row) {
  const id = postId(row.author, row.index);
  const prev = posts.get(id);
  // A row that carries a log index supersedes a legacy one that doesn't.
  if (prev && (row.logIndex == null || prev.logIndex != null)) return prev;
  posts.set(id, row);
  idByTx.set(txId(row.txHash, row.eventIndex), id);
  const key = String(row.block);
  const set = idsByBlock.get(key) ?? new Set();
  set.add(id);
  idsByBlock.set(key, set);
  return row;
}

/** Record posts the session has read. Returns the canonical row objects. */
export function rememberPosts(rows) {
  return (rows ?? []).map((r) => indexRow(normalizeRow(r)));
}

/** Record that `[from, to]` was read in full, for every author. */
export function rememberFeedRange(from, to) {
  feedSegments = seg.add(feedSegments, from, to);
}

/** Record that `block` was read in full for one author. */
export function rememberAuthorBlock(author, block) {
  const key = addrKey(author);
  authorSegments.set(key, seg.add(authorSegments.get(key) ?? [], block, block));
}

/** A post already read this session, or null — no RPC needed either way. */
export const knownPost = (author, index) => posts.get(postId(author, index)) ?? null;

/** Same, addressed by publish transaction + event ordinal. */
export function knownPostByTx(txHash, eventIndex = 0) {
  const id = idByTx.get(txId(txHash, eventIndex));
  return id ? (posts.get(id) ?? null) : null;
}

/** Every post the session holds, newest first. */
export const allPosts = () => [...posts.values()].sort(feedCompare);

/** Posts the session holds inside `[from, to]`, newest first. */
export function postsInRange(from, to) {
  const out = [];
  for (const row of posts.values()) {
    if (row.block >= from && row.block <= to) out.push(row);
  }
  return out.sort(feedCompare);
}

/** One author's posts inside a block, newest (highest index) first. */
export function authorPostsInBlock(author, block) {
  const ids = idsByBlock.get(String(block));
  if (!ids) return [];
  const key = addrKey(author);
  const out = [];
  for (const id of ids) {
    const row = posts.get(id);
    if (row && addrKey(row.author) === key) out.push(row);
  }
  return out.sort((a, b) => (a.index < b.index ? 1 : -1));
}

/** One author's posts, newest (highest index) first. */
export function authorPosts(author) {
  const key = addrKey(author);
  const out = [];
  for (const row of posts.values()) {
    if (addrKey(row.author) === key) out.push(row);
  }
  return out.sort((a, b) => (a.index < b.index ? 1 : -1));
}

/** Ranges proven complete for every author. */
export const feedCoverage = () => feedSegments;

/**
 * Ranges proven complete for `author` — their own single-block reads plus
 * the global feed sweeps, which record every Post event in the range.
 */
export const authorCoverage = (author) =>
  seg.normalize([...(authorSegments.get(addrKey(author)) ?? []), ...feedSegments]);

export const feedScanHead = () => feedHead;
export const authorScanHead = (author) => authorHeads.get(addrKey(author)) ?? null;
export function setFeedScanHead(head) {
  feedHead = String(head);
}
export function setAuthorScanHead(author, head) {
  authorHeads.set(addrKey(author), String(head));
}

// --- localStorage snapshot -------------------------------------------

function lsRead(key) {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null; // corrupted entry — treat as a first scan
  }
}

function emit(name) {
  try {
    window.dispatchEvent(new CustomEvent(name));
  } catch {
    /* non-browser context */
  }
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

/** Snapshot the session's global view to localStorage (bounded). */
export function persistFeedScan() {
  const { kept, floor } = trimRows(allPosts(), FEED_ROW_CAP);
  const segments = floor == null ? feedSegments : seg.clipBelow(feedSegments, floor);
  try {
    localStorage.setItem(
      FEED_KEY,
      JSON.stringify({
        head: feedHead,
        segments: seg.toPlain(segments),
        rows: kept.map(plainRow),
      }),
    );
    if (FEED_KEY_LEGACY) localStorage.removeItem(FEED_KEY_LEGACY);
  } catch {
    /* quota / privacy mode — the session layer still holds everything */
  }
  emit(FEED_SCAN_EVT); // the footer and /scan re-read the persisted ranges
}

/** Snapshot one author's view to localStorage (bounded). */
export function persistAuthorScan(author) {
  const key = addrKey(author);
  const { kept, floor } = trimRows(authorPosts(author), AUTHOR_ROW_CAP);
  const own = authorSegments.get(key) ?? [];
  const segments = floor == null ? own : seg.clipBelow(own, floor);
  try {
    const all = lsRead(AUTHOR_KEY) ?? {};
    all[key] = {
      head: authorHeads.get(key) ?? null,
      segments: seg.toPlain(segments),
      rows: kept.map(plainRow),
    };
    localStorage.setItem(AUTHOR_KEY, JSON.stringify(all));
  } catch {
    /* quota / privacy mode — the session layer still holds everything */
  }
  emit(AUTHOR_SCAN_EVT);
}

// --- Seeding ----------------------------------------------------------

let seeded = false;

/**
 * Fold the persisted snapshot into the session layer, once. v1 stored a
 * single `[frontier, head]` window; that is simply the first segment.
 */
export function seedFromStorage() {
  if (seeded) return;
  seeded = true;

  const feed = lsRead(FEED_KEY);
  if (feed && Array.isArray(feed.rows)) {
    rememberPosts(feed.rows);
    feedSegments = seg.normalize([...feedSegments, ...seg.fromPlain(feed.segments)]);
    if (typeof feed.head === 'string') feedHead = feed.head;
  } else {
    const legacy = lsRead(FEED_KEY_LEGACY);
    if (legacy && Array.isArray(legacy.rows)) {
      rememberPosts(legacy.rows);
      if (legacy.frontier != null && legacy.head != null) {
        feedSegments = seg.add(feedSegments, legacy.frontier, legacy.head);
      }
      if (typeof legacy.head === 'string') feedHead = legacy.head;
    }
  }

  const authors = lsRead(AUTHOR_KEY) ?? {};
  for (const [address, scan] of Object.entries(authors)) {
    if (!scan || typeof scan !== 'object') continue;
    rememberPosts(Array.isArray(scan.rows) ? scan.rows : []);
    authorSegments.set(addrKey(address), seg.fromPlain(scan.segments));
    if (typeof scan.head === 'string') authorHeads.set(addrKey(address), scan.head);
  }

  // v1 per-author state has rows but no ranges: the rows are still worth
  // keeping (they answer post lookups), the coverage claim simply starts empty.
  const legacyAuthors = lsRead(AUTHOR_KEY_LEGACY);
  if (legacyAuthors && typeof legacyAuthors === 'object' && !lsRead(AUTHOR_KEY)) {
    for (const [address, scan] of Object.entries(legacyAuthors)) {
      if (!scan || typeof scan !== 'object') continue;
      rememberPosts(Array.isArray(scan.rows) ? scan.rows : []);
      if (typeof scan.head === 'string') authorHeads.set(addrKey(address), scan.head);
    }
  }
}

// --- Read-only views for the UI (/scan, footer) -----------------------

/** Global coverage as `{ head, segments, rows }`, or null before any scan. */
export function readFeedScan() {
  seedFromStorage();
  if (feedHead == null && feedSegments.length === 0) return null;
  return { head: feedHead, segments: feedSegments, rows: allPosts() };
}

/** Per-author coverage: `{ address, head, segments, count }`, newest head first. */
export function readAuthorScanEntries() {
  seedFromStorage();
  const out = [];
  for (const [address, segments] of authorSegments.entries()) {
    out.push({
      address,
      head: authorHeads.get(address) ?? null,
      segments,
      count: authorPosts(address).length,
    });
  }
  for (const [address, head] of authorHeads.entries()) {
    if (authorSegments.has(address)) continue;
    out.push({ address, head, segments: [], count: authorPosts(address).length });
  }
  out.sort((a, b) => {
    if (a.head == null || b.head == null) return a.head == null ? 1 : -1;
    const ha = BigInt(a.head);
    const hb = BigInt(b.head);
    return hb > ha ? 1 : hb < ha ? -1 : 0;
  });
  return out;
}

// --- In-flight fetches -----------------------------------------------
//
// Two surfaces can want the same block at the same moment — resolving a
// post's prev and next neighbors runs both walks in parallel. Sharing the
// promise keeps "fetched at most once per session" true under concurrency,
// not just in sequence.

const inflight = new Map(); // key -> Promise

export function once(key, fn) {
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
export function resetSessionStore() {
  inflight.clear();
  posts.clear();
  idByTx.clear();
  idsByBlock.clear();
  authorSegments.clear();
  authorHeads.clear();
  feedSegments = [];
  feedHead = null;
  seeded = false;
}
