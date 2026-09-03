// scanner.js — how the reader decides what to fetch, with no chain I/O.
//
// Pure orchestration over scanStore.js (what has already been read) and
// segments.js (the range algebra). Every chain call is injected, so the
// traversal rules can be reasoned about — and exercised — on their own.
//
// The rule throughout: a block inside a covered range is answered from the
// store and never re-fetched. Coverage is a SET of ranges, so a deep read
// spends its budget only on ground no earlier read has touched.

import * as seg from './segments';
import * as store from './scanStore';
import * as rpcLog from './rpcLog';

/** Never shrink a getLogs window below this — past it, give up instead. */
const MIN_WINDOW = 25n;

// --- Home feed: cross-author range sweeps ----------------------------

/**
 * Home feed rows: every post inside a covered range, newest first.
 *
 * Deliberately NOT "every post the store knows": a post found by an author
 * walk sits in an unswept range, and listing it would put a hole in the feed
 * — and hand load-more a cursor below blocks nobody has read. A range shows
 * up once it has actually been swept.
 */
export function feedRows() {
  const out = [];
  for (const [from, to] of store.feedCoverage()) {
    out.push(...store.postsInRange(from, to));
  }
  return out.sort(store.feedCompare);
}

/**
 * Sweep backwards from `cursor` collecting up to `n` posts, newest first.
 *
 * Cross-author discovery has no on-chain head pointer, so it has to scan.
 * The sweep is bounded and best-effort: `windowSize` blocks per fetch (to
 * respect public-RPC range limits), at most `maxWindows` fetches per call.
 *
 * Ranges already read cost nothing — their posts come from the store and the
 * window budget is untouched — so a sweep from block 300 down to 50 across
 * coverage of 1–100 fetches only 299–101. Each fetch is clipped to stop right
 * above the next covered range rather than read through it a second time.
 *
 * @param fetchRange async (from, to, endsAtHead) => meta[]
 * @returns {{rows, reachedGenesis, windows}} `reachedGenesis` — block 0 read.
 */
export async function sweepFeed({
  cursor,
  head = null,
  n,
  olderThan = null,
  windowSize,
  maxWindows,
  fetchRange,
}) {
  let span = BigInt(windowSize);
  const out = [];
  const taken = new Set();
  const start = BigInt(cursor);
  let at = start;
  let windows = 0;
  let fetched = 0n; // blocks pulled from the node
  let reused = 0n; // blocks answered from ranges already read
  let floor = start; // lowest block the sweep reached
  let reachedGenesis = false;

  const take = (rows) => {
    for (const row of rows) {
      if (olderThan && !store.isOlder(row, olderThan)) continue;
      const id = store.postId(row.author, row.index);
      if (taken.has(id)) continue;
      taken.add(id);
      out.push(row);
      if (out.length >= n) return true;
    }
    return false;
  };

  while (out.length < n && at >= 0n && windows < maxWindows) {
    const covered = seg.segmentAt(store.feedCoverage(), at);
    if (covered) {
      const held = store.postsInRange(covered[0], at);
      reused += at - covered[0] + 1n;
      floor = covered[0];
      rpcLog.fromCache('feed', rpcLog.range(covered[0], at), `${held.length} posts`, 'already scanned');
      const full = take(held);
      if (covered[0] === 0n) {
        reachedGenesis = true;
        break;
      }
      at = covered[0] - 1n;
      if (full) break;
      continue;
    }

    const windowFloor = at >= span ? at - span + 1n : 0n;
    const below = seg.topBelow(store.feedCoverage(), at);
    const from = below != null && below + 1n > windowFloor ? below + 1n : windowFloor;
    let fresh;
    try {
      fresh = await fetchRange(from, at, head != null && at === head);
    } catch (err) {
      // The node caps getLogs ranges below our window. Halve and retry the
      // same window top: coverage is only ever recorded for what was read,
      // so nothing is claimed on the way.
      if (err?.rangeTooLarge && span > MIN_WINDOW) {
        span = span / 2n > MIN_WINDOW ? span / 2n : MIN_WINDOW;
        rpcLog.windowShrunk(span);
        continue;
      }
      throw err;
    }
    const rows = store.rememberPosts(fresh);
    windows++;
    fetched += at - from + 1n;
    floor = from;
    store.rememberFeedRange(from, at);
    const full = take(rows.sort(store.feedCompare));
    if (from === 0n) {
      reachedGenesis = true;
      break;
    }
    at = from - 1n;
    if (full) break;
  }

  rpcLog.sweepDone({
    from: start,
    to: floor,
    posts: out.length,
    windows,
    fetched,
    reused,
  });
  return { rows: out, reachedGenesis, windows };
}

// --- Per-author reads: the contract's reverse block-linked list -------

/**
 * Rows for one block of `author`'s chain, newest (highest index) first — so
 * the last entry is the block's oldest post, the one whose prevBlock
 * continues the chain. Covered blocks never reach `fetchBlock`.
 *
 * @param fetchBlock async (block) => meta[]  (that author's posts only)
 */
export async function authorRowsAt(author, block, fetchBlock) {
  const at = BigInt(block);
  if (seg.segmentAt(store.authorCoverage(author), at)) {
    const held = store.authorPostsInBlock(author, at);
    rpcLog.fromCache('author', `block ${rpcLog.b(at)}`, `${held.length} posts`, 'already scanned');
    return held;
  }
  await store.once(`author:${store.addrKey(author)}:${at}`, async () => {
    // A parallel walk may have covered it while we waited our turn.
    if (seg.segmentAt(store.authorCoverage(author), at)) return;
    store.rememberPosts(await fetchBlock(at));
    store.rememberAuthorBlock(author, at);
  });
  return store.authorPostsInBlock(author, at);
}

/**
 * Walk the author's chain from `startBlock`, skipping posts at or newer than
 * `skipIndex`, until `n` rows are collected or the chain runs out.
 */
export async function walkAuthorTitles(author, startBlock, skipIndex, n, fetchBlock, onStep) {
  let block = BigInt(startBlock);
  let skip = skipIndex == null ? null : BigInt(skipIndex);
  const out = [];
  while (out.length < n && block > 0n) {
    const rows = await authorRowsAt(author, block, fetchBlock);
    if (rows.length === 0) break;
    for (const m of rows) {
      if (skip != null && m.index >= skip) continue;
      out.push(m);
      if (out.length >= n) break;
    }
    skip = null;
    onStep?.({ block, collected: out.length, target: n });
    // The chain must strictly descend; anything else (a truncated cache, a
    // reorg, an inconsistent node) would loop forever.
    const next = rows[rows.length - 1].prevBlock;
    if (next >= block) break;
    block = next;
  }
  return out;
}

/**
 * Find one (author, index) by walking back from `startBlock`. Returns the
 * row, or null when the chain descends past the target without holding it.
 */
export async function findAuthorPost(author, targetIndex, startBlock, fetchBlock) {
  const target = BigInt(targetIndex);
  let block = BigInt(startBlock);
  while (block > 0n) {
    const rows = await authorRowsAt(author, block, fetchBlock);
    if (rows.length === 0) return null;
    const hit = rows.find((m) => m.index === target);
    if (hit) return hit;
    const oldest = rows[rows.length - 1];
    if (oldest.index < target) return null; // walked past
    const next = oldest.prevBlock;
    if (next >= block) return null; // chain doesn't descend — give up
    block = next;
  }
  return null;
}
