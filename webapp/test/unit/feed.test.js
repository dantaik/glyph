// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FeedController } from '../../src/lib/feed';
import { AUTHORS, fakeChain, freshStore, silentLog } from './helpers';

const [A, B] = AUTHORS;

/** Posts at the given blocks, alternating authors, indexes per author ascending. */
function postsAt(blocks) {
  const n = new Map();
  return [...blocks].sort((a, b) => a - b).map((block, i) => {
    const author = i % 2 ? B : A;
    const index = n.get(author) ?? 0;
    n.set(author, index + 1);
    return { author, index, block };
  });
}

// 52 posts, one every 50 blocks from 100 to 2650.
const DENSE = postsAt(Array.from({ length: 52 }, (_, i) => 100 + i * 50));

function make({ chainId = 201, ttl = 60_000, scanBlocks = 10_000, head = 3000, posts = DENSE } = {}) {
  const store = freshStore(chainId);
  const chain = fakeChain({ chainId, head, posts });
  const feed = new FeedController({
    chainId,
    store,
    io: chain.io,
    log: silentLog(),
    windowSize: 500,
    floor: 0n,
    scanBlocks,
    pageSize: 5,
    getTtlMs: () => ttl,
  });
  return { store, chain, feed };
}

const getLogs = (chain) => chain.calls.filter((c) => c.method === 'eth_getLogs');
const blocks = (rows) => rows.map((r) => Number(r.block));

describe('FeedController', () => {
  beforeEach(() => localStorage.clear());

  it('refresh sweeps from one below the head until a page is in hand', async () => {
    const { feed, chain, store } = make();
    await feed.refresh();
    const snap = feed.getSnapshot();
    expect(blocks(store.coveredPosts()).slice(0, 5)).toEqual([2650, 2600, 2550, 2500, 2450]);
    expect(snap.job).toBeNull();
    expect(snap.error).toBeNull();
    // HEAD_LAG: the first window tops out one below the reported head.
    expect(getLogs(chain)[0].args).toEqual([2500n, 2999n]);
    // 2500..2999 held 4 posts — one short — so a second window was read.
    expect(getLogs(chain)).toHaveLength(2);
    expect(snap.coverage).toEqual([[2000n, 2999n]]);
    expect(store.feedScanHead()).toBe('2999');
    expect(store.coveredPosts()).toHaveLength(14);
    expect(snap.refreshedAt).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('glyph.feedScan.v2.201')).rows).toHaveLength(14);
  });

  it('ensureFresh is a no-op while the last refresh is inside the rescan delay', async () => {
    const { feed, chain } = make();
    await feed.refresh();
    const n = chain.calls.length;
    feed.ensureFresh();
    await new Promise((r) => setTimeout(r, 10));
    expect(chain.calls.length).toBe(n);
  });

  it('a refresh with the head unchanged reads nothing from the node', async () => {
    const { feed, chain } = make({ ttl: 0 });
    await feed.refresh();
    const before = getLogs(chain).length;
    await feed.refresh();
    expect(getLogs(chain).length).toBe(before);
  });

  it('a refresh after new blocks only reads the new blocks', async () => {
    const { feed, chain, store } = make({ ttl: 0 });
    await feed.refresh();
    const grown = fakeChain({ chainId: 201, head: 3200, posts: [...DENSE, { author: A, index: 26, block: 3100 }] });
    Object.assign(chain.io, grown.io);
    await feed.refresh();
    expect(getLogs(grown).at(-1).args).toEqual([3000n, 3199n]);
    expect(store.coveredPosts()[0].block).toBe(3100n);
    expect(store.feedCoverage()).toEqual([[2000n, 3199n]]);
  });

  it('is exhausted once the head-contiguous range reaches the floor', async () => {
    const { feed } = make({ posts: postsAt([2100, 2200, 2300, 2400, 2500, 2600]) });
    await feed.refresh(); // 2000..2999 holds the six: the sweep stops there
    expect(feed.getSnapshot().coverage).toEqual([[2000n, 2999n]]);
    expect(feed.getSnapshot().exhausted).toBe(false);
    let res;
    do res = await feed.extend();
    while (!res.reachedFloor);
    expect(feed.getSnapshot().coverage).toEqual([[0n, 2999n]]);
    expect(feed.getSnapshot().exhausted).toBe(true);
  });

  it('fills the unswept blocks between two covered ranges', async () => {
    const { feed, store } = make({ posts: postsAt([2500, 2600, 2700, 2800, 2900, 1000, 1100, 1200, 1300, 1400, 1500]) });
    // An earlier visit read 1000..1500 and holds its six posts.
    const chain = fakeChain({ chainId: 201, head: 3000, posts: postsAt([1000, 1100, 1200, 1300, 1400, 1500]) });
    store.rememberPosts(chain.rows);
    store.rememberFeedRange(1000n, 1500n);

    await feed.refresh(); // 2500..2999 holds a full page: the sweep stops there
    expect(feed.getSnapshot().coverage).toEqual([[1000n, 1500n], [2500n, 2999n]]);
    expect(feed.getSnapshot().top).toEqual([2500n, 2999n]);

    await feed.fillGap({ from: 1501n, to: 2499n });
    expect(feed.getSnapshot().coverage).toEqual([[1000n, 2999n]]);
    expect(store.coveredPosts()).toHaveLength(11);
  });

  it('captures a node failure in the snapshot and clears it on retry', async () => {
    const { feed, chain } = make();
    let broken = true;
    chain.io.blockNumber = async () => {
      if (broken) throw new Error('node down');
      return 3000n;
    };
    await feed.refresh();
    expect(feed.getSnapshot().error).toMatch(/node down/);
    broken = false;
    await feed.retry();
    expect(feed.getSnapshot().error).toBeNull();
    expect(feed.getSnapshot().coverage).toEqual([[2000n, 2999n]]);
  });

  it('runs one job at a time and joins a running one', async () => {
    const { feed } = make();
    const p1 = feed.refresh();
    const p2 = feed.refresh();
    expect(p2).toBe(p1);
    expect(feed.getSnapshot().job).toBe('refresh');
    await p1;
    expect(feed.getSnapshot().job).toBeNull();
  });

  it('returns the same snapshot object while nothing changed', async () => {
    const { feed } = make();
    await feed.refresh();
    expect(feed.getSnapshot()).toBe(feed.getSnapshot());
  });
});

describe('FeedController.extend', () => {
  beforeEach(() => localStorage.clear());

  it('sweeps from just below the head-contiguous range and reports what it found', async () => {
    const { feed, chain } = make();
    await feed.refresh(); // coverage 2000..2999
    const res = await feed.extend();
    expect(getLogs(chain).at(-1).args).toEqual([1500n, 1999n]);
    expect(res).toEqual({ fetched: 500n, found: 10, reachedFloor: false });
    const snap = feed.getSnapshot();
    expect(snap.top).toEqual([1500n, 2999n]);
    expect(snap.exhausted).toBe(false);
  });

  it('refreshes instead when nothing has been swept yet', async () => {
    const { feed, chain } = make();
    const res = await feed.extend();
    expect(res).toEqual({ fetched: 0n, found: 0, reachedFloor: false });
    expect(getLogs(chain)[0].args).toEqual([2500n, 2999n]);
    expect(feed.getSnapshot().top).toEqual([2000n, 2999n]);
  });

  it('answers at once once the floor is reached', async () => {
    const { feed, chain } = make({ posts: postsAt([2600]) });
    await feed.refresh(); // sweeps to the floor looking for a page
    expect(feed.getSnapshot().exhausted).toBe(true);
    const n = getLogs(chain).length;
    expect(await feed.extend()).toEqual({ fetched: 0n, found: 0, reachedFloor: true });
    expect(getLogs(chain).length).toBe(n);
  });

  it('a joined job resolves to that job\'s result', async () => {
    const { feed } = make();
    await feed.refresh();
    const p1 = feed.extend();
    const p2 = feed.extend();
    expect(p2).toBe(p1);
    expect((await p2).found).toBe(10);
  });
});

describe('FeedController — holes, failures and heads', () => {
  it('is not exhausted while a hole sits below the head range, and is once it closes', async () => {
    // An earlier visit read the whole chain when it was 100 blocks tall.
    const { store, feed, chain } = make({ chainId: 202, head: 3000, posts: postsAt([50]), scanBlocks: 500 });
    store.rememberPosts(chain.rows);
    store.rememberFeedRange(0n, 100n);
    await feed.refresh();
    let snap = feed.getSnapshot();
    expect(snap.coverage).toEqual([[0n, 100n], [2500n, 2999n]]);
    expect(blocks(store.coveredPosts())).toEqual([50]);
    expect(snap.exhausted).toBe(false); // the hole may hold posts
    // Reading on merges the ranges; only then is there nothing older to read.
    for (let i = 0; i < 5; i++) await feed.extend();
    snap = feed.getSnapshot();
    expect(snap.coverage).toEqual([[0n, 2999n]]);
    expect(snap.exhausted).toBe(true);
  });

  it('a sweep that fails part-way keeps its coverage but not the head; the next refresh re-reads from the head', async () => {
    let n = 0;
    const store = freshStore(203);
    const chain = fakeChain({
      chainId: 203,
      head: 3000,
      posts: postsAt([100, 600, 1100, 1600, 2100, 2600]),
      fail: (c) => c.method === 'eth_getLogs' && ++n === 2,
    });
    const feed = new FeedController({
      chainId: 203, store, io: chain.io, log: silentLog(), windowSize: 500, floor: 0n, scanBlocks: 10_000, pageSize: 5, getTtlMs: () => 0,
    });
    await feed.refresh();
    let snap = feed.getSnapshot();
    expect(snap.error).toMatch(/eth_getLogs failed/);
    expect(snap.coverage).toEqual([[2500n, 2999n]]);
    expect(snap.head).toBeNull();
    expect(blocks(store.coveredPosts())).toEqual([2600]);
    await feed.refresh();
    snap = feed.getSnapshot();
    expect(snap.error).toBeNull();
    expect(blocks(store.coveredPosts())).toEqual([2600, 2100, 1600, 1100, 600]);
    expect(snap.coverage).toEqual([[500n, 2999n]]);
    expect(snap.head).toBe('2999');
    // The window read before the failure was not read again.
    expect(getLogs(chain).map((c) => String(c.args[1]))).toEqual(['2999', '2499', '2499', '1999', '1499', '999']);
  });

  it('records the head a node actually served, so the next refresh reads the rest', async () => {
    const { feed, chain } = make({ chainId: 204 });
    const real = chain.io.postsInRange.bind(chain.io);
    let short = true;
    chain.io.postsInRange = async (from, to) => {
      if (!short) return real(from, to);
      short = false; // the node is two blocks behind the head it reported
      const res = await real(from, to - 2n);
      return { rows: res.rows, to: to - 2n };
    };
    await feed.refresh();
    let snap = feed.getSnapshot();
    expect(snap.head).toBe('2997');
    expect(snap.coverage[snap.coverage.length - 1][1]).toBe(2997n);
    await feed.refresh();
    snap = feed.getSnapshot();
    expect(snap.head).toBe('2999');
    expect(getLogs(chain).at(-1).args.map(String)).toEqual(['2998', '2999']);
  });

  it('ensureFresh refreshes when stale, never while a job runs', async () => {
    const { feed, chain } = make({ chainId: 205, ttl: 0 });
    feed.ensureFresh();
    feed.ensureFresh(); // joins nothing: a job is running
    await feed.refresh();
    expect(chain.calls.filter((c) => c.method === 'eth_blockNumber')).toHaveLength(1);
    feed.ensureFresh(); // stale at once with a zero delay
    await feed.refresh();
    expect(chain.calls.filter((c) => c.method === 'eth_blockNumber')).toHaveLength(2);
  });

  it('with a delay in force, ensureFresh is a no-op after a refresh', async () => {
    const { feed, chain } = make({ chainId: 206, ttl: 60_000 });
    await feed.refresh();
    feed.ensureFresh();
    await feed.refresh(); // joins nothing either: returns at once, no head read
    expect(chain.calls.filter((c) => c.method === 'eth_blockNumber')).toHaveLength(2);
  });
});
