import { describe, expect, it } from 'vitest';
import * as scanner from '../../src/lib/scanner';
import { AUTHORS, fakeChain, memoryStore, silentLog } from './helpers';

const [A, B] = AUTHORS;

const posts = [
  { author: A, index: 0, block: 100 },
  { author: B, index: 0, block: 250 },
  { author: A, index: 1, block: 400 },
  { author: B, index: 1, block: 400 },
  { author: A, index: 2, block: 900 },
];

function sweep(store, chain, opts) {
  return scanner.sweepFeed({
    store,
    log: silentLog(),
    windowSize: 100n,
    maxBlocks: 10_000n,
    fetchRange: (from, to) => chain.io.postsInRange(from, to),
    ...opts,
  });
}

describe('scanner.sweepFeed', () => {
  it('sweeps down in windows, records coverage and stops once it has n posts', async () => {
    const store = memoryStore(101);
    const chain = fakeChain({ chainId: 101, head: 1000, posts });
    const res = await sweep(store, chain, { cursor: 999n, n: 2, floor: 0n });
    // Block 400 holds two posts; the higher log index is the newer one.
    expect(res.rows.map((r) => [r.author, r.index])).toEqual([[A, 2n], [B, 1n]]);
    expect(res.reachedFloor).toBe(false);
    // 999..900 held one post; five more windows down to 400 found the second.
    expect(res.windows).toBe(6);
    expect(store.feedCoverage()).toEqual([[400n, 999n]]);
  });

  it('serves covered ground from the store instead of the node', async () => {
    const store = memoryStore(102);
    const chain = fakeChain({ chainId: 102, head: 1000, posts });
    await sweep(store, chain, { cursor: 999n, n: 2, floor: 0n });
    const before = chain.calls.filter((c) => c.method === 'eth_getLogs').length;
    const again = await sweep(store, chain, { cursor: 999n, n: 2, floor: 0n });
    expect(again.rows).toHaveLength(2);
    expect(again.windows).toBe(0);
    expect(chain.calls.filter((c) => c.method === 'eth_getLogs').length).toBe(before);
  });

  it('clips a window so it never re-reads a covered range below it', async () => {
    const store = memoryStore(103);
    const chain = fakeChain({ chainId: 103, head: 1000, posts });
    store.rememberFeedRange(300n, 450n); // an earlier visit read this
    store.rememberPosts(chain.rows.filter((r) => r.block >= 300n && r.block <= 450n));
    const res = await sweep(store, chain, { cursor: 500n, n: 10, floor: 0n });
    const windows = chain.calls.filter((c) => c.method === 'eth_getLogs').map((c) => c.args);
    // 500..451 is one clipped window; then 299 down.
    expect(windows[0]).toEqual([451n, 500n]);
    expect(windows.every(([from, to]) => to < 300n || from > 450n)).toBe(true);
    expect(res.rows.map((r) => r.index)).toEqual([1n, 1n, 0n, 0n]);
  });

  it('halves the window when the node refuses the range', async () => {
    const store = memoryStore(104);
    const chain = fakeChain({ chainId: 104, head: 1000, posts, rangeLimit: 30 });
    const res = await sweep(store, chain, { cursor: 999n, n: 1, floor: 0n });
    expect(res.rows).toHaveLength(1);
    const widths = chain.calls
      .filter((c) => c.method === 'eth_getLogs')
      .map((c) => Number(c.args[1] - c.args[0] + 1n));
    expect(widths.slice(0, 3)).toEqual([100, 50, 25]);
    expect(Math.max(...widths.slice(2))).toBeLessThanOrEqual(25);
  });

  it('gives up shrinking below the minimum window and rethrows', async () => {
    const store = memoryStore(105);
    const chain = fakeChain({ chainId: 105, head: 1000, posts, rangeLimit: 10 });
    await expect(sweep(store, chain, { cursor: 999n, n: 1, floor: 0n })).rejects.toThrow(/allowed/);
    expect(store.feedCoverage()).toEqual([]);
  });

  it('respects the block budget and reports what it fetched', async () => {
    const store = memoryStore(106);
    const chain = fakeChain({ chainId: 106, head: 1000, posts: [] });
    const res = await sweep(store, chain, { cursor: 999n, n: 5, floor: 0n, maxBlocks: 250n });
    expect(res.fetched).toBe(250n);
    expect(res.rows).toEqual([]);
    expect(store.feedCoverage()).toEqual([[750n, 999n]]);
  });

  it('stops at the floor and says so', async () => {
    const store = memoryStore(107);
    const chain = fakeChain({ chainId: 107, head: 1000, posts });
    const res = await sweep(store, chain, { cursor: 150n, n: 5, floor: 90n });
    expect(res.reachedFloor).toBe(true);
    expect(res.rows.map((r) => r.index)).toEqual([0n]);
    expect(store.feedCoverage()).toEqual([[90n, 150n]]);
  });

  it('honours olderThan so a page never repeats the row it starts from', async () => {
    const store = memoryStore(108);
    const chain = fakeChain({ chainId: 108, head: 1000, posts });
    const first = await sweep(store, chain, { cursor: 999n, n: 3, floor: 0n });
    const oldest = first.rows[first.rows.length - 1];
    const next = await sweep(store, chain, { cursor: oldest.block, n: 5, floor: 0n, olderThan: oldest });
    expect(next.rows.some((r) => r.author === oldest.author && r.index === oldest.index)).toBe(false);
  });

  it('claims coverage only for the shorter window a node actually served', async () => {
    const store = memoryStore(109);
    const chain = fakeChain({ chainId: 109, head: 1000, posts: [] });
    const fetchRange = async (from, to) => ({ rows: [], to: to - 5n });
    await scanner.sweepFeed({
      store, log: silentLog(), windowSize: 100n, maxBlocks: 100n, fetchRange,
      cursor: 999n, n: 1, floor: 0n,
    });
    expect(store.feedCoverage()).toEqual([[900n, 994n]]);
    void chain;
  });
});

describe('scanner author reads', () => {
  it('authorRowsAt fetches a block once and serves it from coverage afterwards', async () => {
    const store = memoryStore(110);
    const chain = fakeChain({ chainId: 110, head: 1000, posts });
    const fetchBlock = (block) => chain.io.authorPostsInBlock(A, block);
    const args = { store, log: silentLog(), author: A, fetchBlock };
    const rows = await scanner.authorRowsAt({ ...args, block: 400n });
    expect(rows.map((r) => r.index)).toEqual([1n]);
    await scanner.authorRowsAt({ ...args, block: 400n });
    expect(chain.calls.filter((c) => c.method === 'eth_getLogs:author')).toHaveLength(1);
    expect(store.authorCoverage(A)).toEqual([[400n, 400n]]);
  });

  it('findAuthorPost walks prevBlock down to the target and gives up past it', async () => {
    const store = memoryStore(111);
    const chain = fakeChain({ chainId: 111, head: 1000, posts });
    const fetchBlock = (block) => chain.io.authorPostsInBlock(A, block);
    const args = { store, log: silentLog(), author: A, fetchBlock, startBlock: 900n };
    const hit = await scanner.findAuthorPost({ ...args, targetIndex: 0n });
    expect(hit.block).toBe(100n);
    expect(await scanner.findAuthorPost({ ...args, targetIndex: 7n })).toBeNull();
  });
});

describe('scanner.sweepFeed — budget and coverage', () => {
  it('spends the budget only on uncovered ground and merges what it reads into one range', async () => {
    const store = memoryStore(102);
    const chain = fakeChain({
      chainId: 102,
      head: 3000,
      posts: [
        { author: A, index: 0, block: 800 },
        { author: A, index: 1, block: 1500 },
        { author: A, index: 2, block: 2500 },
      ],
    });
    // An earlier read covered 1000..2000 and holds the post at 1500.
    store.rememberPosts(chain.rows.filter((r) => r.block === 1500n));
    store.rememberFeedRange(1000n, 2000n);
    const res = await sweep(store, chain, { cursor: 2999n, n: 10, floor: 0n, windowSize: 1000n, maxBlocks: 1500n });
    expect(chain.calls.map((c) => [String(c.args[0]), String(c.args[1])])).toEqual([
      ['2001', '2999'],
      ['499', '999'],
    ]);
    expect(res.fetched).toBe(1500n);
    expect(res.reachedFloor).toBe(false);
    expect(res.rows.map((r) => Number(r.block))).toEqual([2500, 1500, 800]);
    expect(store.feedCoverage()).toEqual([[499n, 2999n]]);
  });

  it('stops at once when the cursor is below the floor', async () => {
    const store = memoryStore(103);
    const chain = fakeChain({ chainId: 103, head: 1000, posts });
    const res = await sweep(store, chain, { cursor: 50n, n: 5, floor: 100n });
    expect(chain.calls).toEqual([]);
    expect(res).toMatchObject({ rows: [], fetched: 0n, windows: 0, reachedFloor: false });
  });
});

describe('scanner.authorRowsAt — a block the chain points at holds a post', () => {
  const fetcher = (chain, author) => (block) => chain.io.authorPostsInBlock(author, block);

  it('an empty answer for such a block is a lagging node: no coverage, and the read fails', async () => {
    const store = memoryStore(104);
    const chain = fakeChain({ chainId: 104, head: 1000, posts });
    let behind = true;
    const fetchBlock = async (block) => (behind ? [] : fetcher(chain, A)(block));
    await expect(
      scanner.authorRowsAt({ store, log: silentLog(), author: A, block: 900n, fetchBlock }),
    ).rejects.toThrow(/glyph:node-behind 900/);
    expect(store.authorCoverage(A)).toEqual([]);
    behind = false;
    const rows = await scanner.authorRowsAt({ store, log: silentLog(), author: A, block: 900n, fetchBlock });
    expect(rows.map((r) => Number(r.index))).toEqual([2]);
    expect(store.authorCoverage(A)).toEqual([[900n, 900n]]);
  });

  it('coverage that claims the block yet holds none of the author\'s posts is read again', async () => {
    const store = memoryStore(105);
    const chain = fakeChain({ chainId: 105, head: 1000, posts });
    store.rememberFeedRange(900n, 900n); // a sweep served by a lagging node saw nothing there
    const rows = await scanner.authorRowsAt({ store, log: silentLog(), author: A, block: 900n, fetchBlock: fetcher(chain, A) });
    expect(rows).toHaveLength(1);
    expect(chain.calls.map((c) => c.method)).toEqual(['eth_getLogs:author']);
    // …and now it is genuinely known.
    await scanner.authorRowsAt({ store, log: silentLog(), author: A, block: 900n, fetchBlock: fetcher(chain, A) });
    expect(chain.calls).toHaveLength(1);
  });

  it('two walks wanting the same block share one read', async () => {
    const store = memoryStore(106);
    const chain = fakeChain({ chainId: 106, head: 1000, posts });
    const args = { store, log: silentLog(), author: A, block: 400n, fetchBlock: fetcher(chain, A) };
    const [x, y] = await Promise.all([scanner.authorRowsAt(args), scanner.authorRowsAt(args)]);
    expect(x).toEqual(y);
    expect(chain.calls).toHaveLength(1);
  });
});

describe('scanner.findAuthorPost — a chain that does not descend', () => {
  it('gives up instead of looping', async () => {
    const store = memoryStore(107);
    const fetchBlock = async (block) => [
      { author: A, index: 5, block, prevBlock: block, title: 'loop', txHash: '0x5', eventIndex: 0, logIndex: 0 },
    ];
    const found = await scanner.findAuthorPost({ store, log: silentLog(), author: A, targetIndex: 1, startBlock: 900n, fetchBlock });
    expect(found).toBeNull();
  });
});
