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
    expect(blocks(snap.rows)).toEqual([2650, 2600, 2550, 2500, 2450]);
    expect(snap.job).toBeNull();
    expect(snap.error).toBeNull();
    // HEAD_LAG: the first window tops out one below the reported head.
    expect(getLogs(chain)[0].args).toEqual([2500n, 2999n]);
    // 2500..2999 held 4 posts — one short — so a second window was read.
    expect(getLogs(chain)).toHaveLength(2);
    expect(snap.coverage).toEqual([[2000n, 2999n]]);
    expect(store.feedScanHead()).toBe('2999');
    expect(snap.total).toBe(14);
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

  it('loadMore widens the page when the store already holds the rows', async () => {
    const { feed, chain } = make();
    await feed.refresh(); // holds 14 rows
    const before = getLogs(chain).length;
    await feed.loadMore();
    expect(feed.getSnapshot().rows).toHaveLength(10);
    expect(getLogs(chain).length).toBe(before);
  });

  it('loadMore sweeps below the oldest shown row when the store runs out', async () => {
    const { feed, chain } = make();
    await feed.refresh();
    await feed.loadMore(); // 10 of 14 held rows
    await feed.loadMore(); // 15 wanted: sweep below 2000
    const snap = feed.getSnapshot();
    expect(snap.rows).toHaveLength(15);
    expect(snap.rows.at(-1).block).toBe(1950n);
    expect(getLogs(chain).at(-1).args).toEqual([1500n, 1999n]);
    expect(snap.done).toBe(false);
  });

  it('is done once everything held is shown and coverage reaches the floor', async () => {
    const { feed } = make({ posts: postsAt([2100, 2200, 2300, 2400, 2500, 2600]) });
    await feed.refresh();
    expect(feed.getSnapshot().done).toBe(false); // one held row still off the page
    await feed.loadMore(); // sweeps to the floor looking for more
    const snap = feed.getSnapshot();
    expect(snap.rows).toHaveLength(6);
    expect(snap.coverage).toEqual([[0n, 2999n]]);
    expect(snap.done).toBe(true);
    expect(snap.note).toBeNull();
  });

  it('notes a load-more that spent its budget and found nothing', async () => {
    const { feed } = make({ posts: postsAt([2600, 2100, 2000]), scanBlocks: 400 });
    await feed.refresh(); // 2600..2999: one post, budget spent
    expect(feed.getSnapshot().rows).toHaveLength(1);
    await feed.loadMore(); // 2200..2599: nothing there
    const snap = feed.getSnapshot();
    expect(snap.note).toEqual({ fetched: 400n });
    expect(snap.rows).toHaveLength(1);
    expect(snap.done).toBe(false);
  });

  it('reports gaps between rows that sit in different covered ranges, and fills them', async () => {
    const { feed, store } = make({ posts: postsAt([2500, 2600, 2700, 2800, 2900, 1000, 1100, 1200, 1300, 1400, 1500]) });
    // An earlier visit read 1000..1500 and holds its six posts.
    const chain = fakeChain({ chainId: 201, head: 3000, posts: postsAt([1000, 1100, 1200, 1300, 1400, 1500]) });
    store.rememberPosts(chain.rows);
    store.rememberFeedRange(1000n, 1500n);

    await feed.refresh(); // 2500..2999 holds a full page: the sweep stops there
    expect(feed.getSnapshot().coverage).toEqual([[1000n, 1500n], [2500n, 2999n]]);
    expect(feed.getSnapshot().gaps).toEqual([]);

    await feed.loadMore(); // widens onto the old rows: a gap now sits between the two ranges
    const snap = feed.getSnapshot();
    expect(snap.rows).toHaveLength(10);
    expect(snap.gaps).toEqual([{ after: 4, from: 1501n, to: 2499n }]);

    await feed.fillGap(snap.gaps[0]);
    expect(feed.getSnapshot().gaps).toEqual([]);
    expect(feed.getSnapshot().coverage).toEqual([[1000n, 2999n]]);
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
    expect(feed.getSnapshot().rows).toHaveLength(5);
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
