import { describe, expect, it } from 'vitest';
import { AUTHORS as WORLD_AUTHORS, buildWorlds, expectedMergedOrder } from '../../src/lib/fixtureWorld';
import { createView } from '../../src/lib/view';
import { AUTHORS, fakeChain, until } from './helpers';
import { NOW, ioReader, settle, worldReader } from './mergedHelpers';

const worlds = () => buildWorlds([1, 167000], { now: NOW });
const hashes = (rows) => rows.map((r) => r.txHash);
const titles = (rows) => rows.map((r) => r.title);

describe('MergedFeed over the two demo chains', () => {
  it('merges both chains newest first, in the oracle\'s order', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    const snap = await settle(view.feed);
    const taiko = worlds().get(167000);
    const taikoBottom = taiko.head - taiko.scanBlocks; // 18,000: the first sweep's floor
    const expected = expectedMergedOrder(worlds()).filter((p) => p.chainId === 1 || p.block >= taikoBottom);
    expect(hashes(snap.rows)).toEqual(hashes(expected));
    expect(snap.rows).toHaveLength(16);
    expect(snap.rows.every((r) => r.tsExact)).toBe(true);
    // Both chains interleave from the top rather than one after the other.
    expect(snap.rows.map((r) => r.chainId)).toEqual(expected.map((p) => p.chainId));
    expect(new Set(snap.rows.slice(0, 4).map((r) => r.chainId)).size).toBe(2);
    expect(snap.total).toBe(16);
    expect(snap.done).toBe(false);
  });

  it('draws the frontier at the least-read chain\'s coverage bottom', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    const snap = await settle(view.feed);
    const taiko = worlds().get(167000);
    const tStar = taiko.tsOf(taiko.head - taiko.scanBlocks);
    expect(snap.frontier).toMatchObject({ ts: tStar, leaders: [{ chainId: 167000, state: 'covered', exact: true }] });
    // Ethereum is read to its floor; only its oldest letter is older than Taiko's coverage.
    expect(snap.chains.map((c) => [c.chainId, c.exhausted, c.bound])).toEqual([
      [1, true, -Infinity],
      [167000, false, tStar],
    ]);
    expect(snap.frontier.after).toBe(14);
    expect(titles(snap.rows.slice(15))).toEqual(['']);
  });

  it('加载更早的文章 deepens the chain at the frontier until everything is complete', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    await settle(view.feed);
    const taikoLogs = () => view.reader(167000).io.world && view.feed.getSnapshot().chains[1];
    // One explicit step first: Taiko extends by one budget, the frontier moves down.
    await view.reader(167000).feed.extend();
    let snap = await settle(view.feed);
    const taiko = worlds().get(167000);
    expect(snap.frontier.ts).toBe(taiko.tsOf(taiko.head - 2n * taiko.scanBlocks));
    expect(snap.rows).toHaveLength(19);
    // Everything known is newer than the new frontier; Taiko's oldest letter
    // is still below its coverage and not on the page at all yet.
    expect(titles(snap.rows.slice(snap.frontier.after + 1))).toEqual([]);
    expect(titles(snap.rows)).not.toContain('试试 Taiko');
    void taikoLogs;

    await view.feed.loadMore();
    snap = await settle(view.feed);
    expect(snap.frontier).toBeNull();
    expect(snap.done).toBe(true);
    expect(hashes(snap.rows)).toEqual(hashes(expectedMergedOrder(worlds())));
    expect(snap.rows).toHaveLength(20);
    expect(snap.chains.every((c) => c.exhausted)).toBe(true);
  });

  it('shows what one chain has while the other has no coverage yet', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const before = view.feed.getSnapshot();
    expect(before.rows).toEqual([]);
    expect(before.frontier).toMatchObject({ after: -1, ts: Infinity });
    expect(before.frontier.leaders.map((l) => [l.chainId, l.state])).toEqual([[1, 'idle'], [167000, 'idle']]);

    await view.reader(1).feed.refresh();
    const snap = await settle(view.feed);
    expect(snap.rows).toHaveLength(12);
    expect(snap.frontier).toMatchObject({ after: -1, ts: Infinity, leaders: [{ chainId: 167000, state: 'idle' }] });
  });

  it('keeps one chain\'s rows when the other chain\'s node fails, and recovers on retry', async () => {
    let broken = true;
    const view = createView([
      worldReader(1),
      worldReader(167000, {
        tweak: (io) => {
          const real = io.blockNumber.bind(io);
          io.blockNumber = async () => {
            if (broken) throw new Error('taiko down');
            return real();
          };
        },
      }),
    ]);
    await view.feed.refresh();
    let snap = await settle(view.feed);
    expect(snap.rows).toHaveLength(12);
    expect(snap.rows.every((r) => r.chainId === 1)).toBe(true);
    expect(snap.anyError).toBe(true);
    expect(snap.allErrored).toBe(false);
    expect(snap.chains[1].error).toMatch(/taiko down/);
    expect(snap.frontier).toMatchObject({ after: -1, leaders: [{ chainId: 167000, state: 'error' }] });

    broken = false;
    await view.feed.retry(167000);
    snap = await settle(view.feed);
    expect(snap.anyError).toBe(false);
    expect(snap.rows).toHaveLength(16);
  });

  it('a single-chain view has no frontier', async () => {
    const view = createView([worldReader(167000)]);
    await view.feed.refresh();
    const snap = await settle(view.feed);
    expect(snap.frontier).toBeNull();
    expect(snap.rows).toHaveLength(4);
    expect(snap.done).toBe(false);
    await view.feed.loadMore();
    const more = await settle(view.feed);
    expect(more.rows).toHaveLength(8);
    expect(more.done).toBe(true);
  });

  it('fills in timestamps on rows that came without them, then orders exactly', async () => {
    const view = createView([
      worldReader(1, { ioOpts: { legacyRows: true } }),
      worldReader(167000, { ioOpts: { legacyRows: true } }),
    ]);
    await view.feed.refresh();
    const snap = await settle(view.feed);
    expect(snap.rows.every((r) => r.tsExact)).toBe(true);
    const taiko = worlds().get(167000);
    const expected = expectedMergedOrder(worlds()).filter((p) => p.chainId === 1 || p.block >= taiko.head - taiko.scanBlocks);
    expect(hashes(snap.rows)).toEqual(hashes(expected));
    // …and the store persisted them: a new reader over the same rows has them at once.
    expect(view.reader(1).store.coveredPosts().every((r) => r.ts != null)).toBe(true);
  });

  it('marks a chain\'s own gaps and widens the page by what a fill finds', async () => {
    const world = worlds().get(1);
    const reader = worldReader(1, {
      tweak: (io) => {
        io.scanBlocks = 400n; // a refresh cannot reach an old range below
        io.windowSize = 500;
      },
    });
    // An earlier visit read 800..1200 and holds its two letters.
    reader.store.rememberPosts(world.posts.filter((p) => p.block >= 800n && p.block <= 1200n));
    reader.store.rememberFeedRange(800n, 1200n);
    const view = createView([reader], { pageSize: 3 });
    await view.feed.refresh();
    let snap = await settle(view.feed);
    expect(snap.chains[0].coverage).toEqual([[800n, 1200n], [2600n, 2999n]]);
    expect(titles(snap.rows)).toEqual(['冬至前的一封信', '山间来信', '桂花开的时候']);
    expect(snap.gaps).toEqual([{ chainId: 1, after: 1, from: 1201n, to: 2599n }]);

    await view.feed.fillGap(1, snap.gaps[0]); // one budget's worth: 2200..2599
    snap = await settle(view.feed);
    expect(snap.chains[0].coverage).toEqual([[800n, 1200n], [2200n, 2999n]]);
    expect(snap.shown).toBe(5); // widened by the two letters the fill found
    expect(titles(snap.rows)).toEqual(['冬至前的一封信', '山间来信', '海边的冬天', '春天的院子', '桂花开的时候']);
    expect(snap.gaps).toEqual([{ chainId: 1, after: 3, from: 1201n, to: 2199n }]);
  });

  it('notes a 加载更早 that read blocks on a chain and found nothing', async () => {
    const chain = fakeChain({ chainId: 1, head: 3000, posts: [{ author: AUTHORS[0], index: 0, block: 2600 }] });
    chain.io.scanBlocks = 400n;
    chain.io.floor = 0n;
    const view = createView([ioReader(1, chain.io)], { pageSize: 5 });
    await view.feed.refresh();
    await settle(view.feed);
    await view.feed.loadMore();
    const snap = await settle(view.feed);
    expect(snap.note).toEqual({ chainId: 1, fetched: 1200n }); // three sweeps of 400
    expect(snap.rows).toHaveLength(1);
    expect(snap.done).toBe(false);
  });

  it('exposes per-chain scanning state while a sweep runs', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const p = view.feed.refresh();
    const during = await until(() => {
      const s = view.feed.getSnapshot();
      return s.scanning ? s : null;
    });
    expect(during.chains.some((c) => c.job === 'refresh')).toBe(true);
    await p;
    await settle(view.feed);
    expect(view.feed.getSnapshot().scanning).toBe(false);
  });

  it('returns the same snapshot while nothing changed', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    await settle(view.feed);
    expect(view.feed.getSnapshot()).toBe(view.feed.getSnapshot());
  });
});

describe('createView', () => {
  it('names its chains and answers counts per chain', async () => {
    const view = createView([worldReader(167000), worldReader(1)]);
    expect(view.chainIds).toEqual([1, 167000]);
    expect(view.key).toBe('1,167000');
    expect(view.reader(167000).chainId).toBe(167000);
    expect(view.reader(11155111)).toBeNull();
    expect(await view.counts(WORLD_AUTHORS[0])).toEqual({ total: 8n, byChain: { 1: 5n, 167000: 3n } });
    expect(await view.counts(WORLD_AUTHORS[3])).toEqual({ total: 3n, byChain: { 1: 0n, 167000: 3n } });
  });

  it('finds a post on whichever chain holds it', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const taiko = worlds().get(167000);
    const post = taiko.posts.find((p) => p.title === '鼓声');
    const hit = await view.findPostAnywhere(post.txHash, 0);
    expect(hit.chainId).toBe(167000);
    expect(hit.meta.title).toBe('鼓声');
    expect(await view.findPostAnywhere(`0x${'ee'.repeat(32)}`, 0)).toBeNull();
    expect((await view.loadPostBody({ chainId: 167000, txHash: post.txHash })).body.markdown).toContain('鼓楼');
  });

  it('a total is null until every chain has answered', async () => {
    const view = createView([
      worldReader(1),
      worldReader(167000, {
        tweak: (io) => {
          io.count = async () => {
            throw new Error('down');
          };
        },
      }),
    ]);
    expect(await view.counts(WORLD_AUTHORS[0])).toEqual({ total: null, byChain: { 1: 5n, 167000: null } });
  });
});
