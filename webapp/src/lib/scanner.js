// scanner.js — how the reader decides what to fetch, with no chain I/O.
//
// Pure orchestration over a scan store (what has already been read) and
// segments.js (the range algebra). Every chain call is injected, so the
// traversal rules can be reasoned about — and exercised — on their own.
//
// The rule throughout: a block inside a covered range is answered from the
// store and never re-fetched. Coverage is a SET of ranges, so a deep read
// spends its budget only on ground no earlier read has touched.

import * as seg from './segments';
import { NODE_BEHIND_CODE } from './format';
import { addrKey, feedCompare, isOlder, postId } from './scanStore';

/** Never shrink a getLogs window below this — past it, give up instead. */
const MIN_WINDOW = 25n;

// --- Home feed: cross-author range sweeps ----------------------------

/**
 * Sweep backwards from `cursor` collecting up to `n` posts, newest first.
 *
 * Cross-author discovery has no on-chain head pointer, so it has to scan.
 * The sweep is bounded and best-effort: `windowSize` blocks per fetch (to
 * respect public-RPC range limits), AT MOST `maxBlocks` BLOCKS FETCHED FROM
 * THE NODE PER CALL (the chain's `scanBlocks`, see chains.js), and never
 * below `floor` — the block the contract was deployed in, below which no
 * Post event can exist.
 *
 * Ranges already read cost nothing — their posts come from the store and the
 * block budget is untouched — so a sweep from block 300 down to 50 across
 * coverage of 1–100 fetches only 299–101. Each fetch is clipped to stop right
 * above the next covered range rather than read through it a second time.
 *
 * Every window is recorded in the store as soon as it lands (and `onProgress`
 * is told), so whoever is watching the store sees posts as they are found,
 * and a sweep cut short keeps everything it had read.
 *
 * @param fetchRange async (from, to) => { rows: meta[], to?: bigint } — `to`
 *   when the node served a shorter window than asked (see chainIO.js)
 * @param onProgress ({ phase: 'fetching' | 'fetched', from, to, fetched, found })
 * @returns {{rows, reachedFloor, windows, fetched}} `reachedFloor` — nothing
 *   older is left to read; `fetched` — blocks read from the node.
 */
export async function sweepFeed({
  store,
  log,
  cursor,
  n,
  olderThan = null,
  floor = 0n,
  windowSize,
  maxBlocks,
  fetchRange,
  onProgress,
}) {
  let span = BigInt(windowSize);
  const budget = BigInt(maxBlocks);
  const out = [];
  const taken = new Set();
  const start = BigInt(cursor);
  const bottom = BigInt(floor);
  let at = start;
  let windows = 0;
  let fetched = 0n; // blocks pulled from the node
  let reused = 0n; // blocks answered from ranges already read
  let low = start + 1n; // lowest block the sweep reached
  let reachedFloor = false;

  const take = (rows) => {
    for (const row of rows) {
      if (olderThan && !isOlder(row, olderThan)) continue;
      const id = postId(row.author, row.index);
      if (taken.has(id)) continue;
      taken.add(id);
      out.push(row);
      if (out.length >= n) return true;
    }
    return false;
  };

  while (out.length < n && at >= bottom && fetched < budget) {
    const covered = seg.segmentAt(store.feedCoverage(), at);
    if (covered) {
      const from = covered[0] > bottom ? covered[0] : bottom;
      const held = store.postsInRange(from, at);
      reused += at - from + 1n;
      low = from;
      log.fromCache('feed', log.range(from, at), `${held.length} posts`, 'already scanned');
      const full = take(held);
      if (from <= bottom) {
        reachedFloor = true;
        break;
      }
      at = from - 1n;
      if (full) break;
      continue;
    }

    // Never read past the budget: the last window is cut to whatever is left.
    const width = span < budget - fetched ? span : budget - fetched;
    const windowFloor = at - width + 1n > bottom ? at - width + 1n : bottom;
    const below = seg.topBelow(store.feedCoverage(), at);
    const from = below != null && below + 1n > windowFloor ? below + 1n : windowFloor;
    onProgress?.({ phase: 'fetching', from, to: at, fetched, found: 0 });
    let res;
    try {
      res = await fetchRange(from, at);
    } catch (err) {
      // The node caps getLogs ranges below our window. Halve and retry the
      // same window top: coverage is only ever recorded for what was read,
      // so nothing is claimed on the way.
      if (err?.rangeTooLarge && span > MIN_WINDOW) {
        span = span / 2n > MIN_WINDOW ? span / 2n : MIN_WINDOW;
        log.windowShrunk(span);
        continue;
      }
      throw err;
    }
    // A node that hasn't seen the top of the window yet serves a shorter
    // one; coverage is claimed only for what was actually read, and the
    // blocks left over are picked up by the next sweep from the head.
    const to = res.to != null && BigInt(res.to) < at ? BigInt(res.to) : at;
    const rows = store.rememberPosts(res.rows);
    windows++;
    fetched += to - from + 1n;
    low = from;
    store.rememberFeedRange(from, to);
    onProgress?.({ phase: 'fetched', from, to, fetched, found: rows.length });
    const full = take([...rows].sort(feedCompare));
    if (from <= bottom) {
      reachedFloor = true;
      break;
    }
    at = from - 1n;
    if (full) break;
  }

  log.sweepDone({
    from: start,
    to: low,
    posts: out.length,
    windows,
    fetched,
    reused,
  });
  return { rows: out, reachedFloor, windows, fetched };
}

// --- Per-author reads: the contract's reverse block-linked list -------

/**
 * A node answering for a block it hasn't seen — the walk fails, and can be
 * retried. The message is a code rather than a sentence: it travels to the
 * UI as a bare string (feed.js keeps `err.message`), and only there does
 * friendlyError turn it into the reader's language.
 */
const nodeBehind = (block) =>
  Object.assign(new Error(`${NODE_BEHIND_CODE} ${block}`), { nodeBehind: true, block });

/**
 * Rows for one block of `author`'s chain, newest (highest index) first — so
 * the last entry is the block's oldest post, the one whose prevBlock
 * continues the chain. Covered blocks never reach `fetchBlock`.
 *
 * Every block asked for here is one the chain points at — the author's
 * latestBlock() or a prevBlock — so it holds at least one of their posts.
 * An empty answer is a node that hasn't caught up (public gateways answer
 * eth_call and eth_getLogs from different nodes), never the truth: it is
 * not recorded as coverage, and the walk fails so it can be retried.
 * Coverage that claims the block yet holds none of the author's posts is
 * the same thing, left behind by an earlier read, and the block is read
 * again.
 *
 * @param fetchBlock async (block) => meta[]  (that author's posts only)
 */
export async function authorRowsAt({ store, log, author, block, fetchBlock }) {
  const at = BigInt(block);
  if (seg.segmentAt(store.authorCoverage(author), at)) {
    const held = store.authorPostsInBlock(author, at);
    if (held.length > 0) {
      log.fromCache('author', `block ${log.b(at)}`, `${held.length} posts`, 'already scanned');
      return held;
    }
  }
  await store.once(`author:${addrKey(author)}:${at}`, async () => {
    // A parallel walk may have read it while we waited our turn.
    if (store.authorPostsInBlock(author, at).length > 0) return;
    const rows = await fetchBlock(at);
    if (rows.length === 0) throw nodeBehind(at);
    store.rememberPosts(rows);
    store.rememberAuthorBlock(author, at);
  });
  return store.authorPostsInBlock(author, at);
}

/**
 * Find one (author, index) by walking back from `startBlock`. Returns the
 * row, or null when the chain descends past the target without holding it.
 */
export async function findAuthorPost({ store, log, author, targetIndex, startBlock, fetchBlock }) {
  const target = BigInt(targetIndex);
  let block = BigInt(startBlock);
  while (block > 0n) {
    const rows = await authorRowsAt({ store, log, author, block, fetchBlock });
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
