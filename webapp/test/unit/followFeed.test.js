import { describe, expect, it } from 'vitest';
import { AUTHORS as WORLD_AUTHORS, buildWorlds } from '../../src/lib/fixtureWorld';
import { createView } from '../../src/lib/view';
import { AUTHORS, fakeChain, until } from './helpers';
import { NOW, ioReader, worldReader } from './mergedHelpers';

const [A0, A1, , A3] = WORLD_AUTHORS;

/** Nothing in flight: no jobs, and every shown row's time is exact. */
const settle = (feed, { timeout = 3000 } = {}) =>
  until(
    () => {
      const s = feed.getSnapshot();
      if (s.scanning) return false;
      if (s.rows.some((r) => !r.tsExact)) return false;
      return s;
    },
    { timeout },
  );

/** The posts of `authors` across the demo worlds, newest first. */
function expectedFor(authors, chainIds = [1, 167000]) {
  const worlds = buildWorlds(chainIds, { now: NOW });
  const wanted = new Set(authors.map((a) => a.toLowerCase()));
  const all = [];
  for (const world of worlds.values()) {
    for (const p of world.posts) if (wanted.has(p.author.toLowerCase())) all.push({ ...p, chainId: world.chainId });
  }
  all.sort((a, b) => (a.ts !== b.ts ? b.ts - a.ts : a.chainId - b.chainId));
  return all;
}

describe('FollowFeed', () => {
  it('merges the followed authors\' posts from every chain, newest first', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const feed = view.followFeed([A0, A3]);
    await feed.refresh();
    const snap = await settle(feed);

    expect(snap.rows.map((r) => r.txHash)).toEqual(expectedFor([A0, A3]).map((p) => p.txHash));
    // A3 writes on Taiko only, A0 on both: the merge covers all three walks.
    expect(new Set(snap.rows.map((r) => r.chainId))).toEqual(new Set([1, 167000]));
    expect(snap.rows.every((r) => [A0, A3].some((a) => a.toLowerCase() === r.author.toLowerCase()))).toBe(true);
    expect(snap.frontier).toBeNull();
    expect(snap.done).toBe(true);
    expect(snap.silent).toEqual([]);
  });

  it('reads head pointers and single blocks only — never a range scan', async () => {
    const seen = { latestBlock: 0, authorPostsInBlock: 0, ranges: 0 };
    const count = (io) => {
      for (const method of ['latestBlock', 'authorPostsInBlock']) {
        const real = io[method].bind(io);
        io[method] = (...args) => { seen[method] += 1; return real(...args); };
      }
      for (const method of ['postsInRange', 'scanRange', 'postsInRangeChunked']) {
        if (typeof io[method] !== 'function') continue;
        const real = io[method].bind(io);
        io[method] = (...args) => { seen.ranges += 1; return real(...args); };
      }
    };
    const view = createView([worldReader(1, { tweak: count }), worldReader(167000, { tweak: count })]);
    const feed = view.followFeed([A0, A1]);
    await feed.refresh();
    await settle(feed);

    expect(seen.ranges).toBe(0); // the whole point of the design
    expect(seen.latestBlock).toBeGreaterThan(0);
    expect(seen.authorPostsInBlock).toBeGreaterThan(0);
  });

  it('following nobody is an empty feed with nothing to load', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const feed = view.followFeed([]);
    await feed.refresh();
    const snap = feed.getSnapshot();
    expect(snap.rows).toEqual([]);
    expect(snap.frontier).toBeNull();
    expect(snap.done).toBe(true);
    expect(snap.chains).toEqual([]);
  });

  it('names an author who has answered and published nothing', async () => {
    const quiet = '0x0000000000000000000000000000000000000abc';
    const view = createView([worldReader(1), worldReader(167000)]);
    const feed = view.followFeed([A0, quiet]);
    await feed.refresh();
    const snap = await settle(feed);
    expect(snap.silent).toEqual([quiet]);
    expect(snap.rows.length).toBeGreaterThan(0);
  });

  it('marks the frontier while a walk is behind, and load-more deepens that walk', async () => {
    // One author with 25 posts on chain 1 (a walk shows 20) and 3 on Taiko.
    const eth = fakeChain({
      chainId: 1, head: 30_000, now: NOW,
      posts: Array.from({ length: 25 }, (_, i) => ({ author: AUTHORS[0], index: i, block: 1000 + i * 1000 })),
    });
    const taiko = fakeChain({
      chainId: 167000, head: 30_000, now: NOW, secondsPerBlock: 2,
      posts: [
        { author: AUTHORS[0], index: 0, block: 2000 },
        { author: AUTHORS[0], index: 1, block: 20_000 },
        { author: AUTHORS[0], index: 2, block: 29_000 },
      ],
    });
    const view = createView([ioReader(1, eth.io), ioReader(167000, taiko.io)], { pageSize: 20 });
    const feed = view.followFeed([AUTHORS[0]]);
    await feed.refresh();
    let snap = await settle(feed);

    const oldestWalked = eth.tsOf(1000 + 5 * 1000);
    expect(snap.frontier).toMatchObject({ ts: oldestWalked, leaders: [{ chainId: 1, author: AUTHORS[0], state: 'covered' }] });
    expect(snap.rows.slice(snap.frontier.after + 1).every((r) => r.ts < oldestWalked)).toBe(true);
    expect(snap.done).toBe(false);

    await feed.loadMore();
    snap = await settle(feed);
    expect(snap.frontier).toBeNull();
    expect(snap.rows).toHaveLength(28);
    expect(snap.done).toBe(true);
    for (let i = 1; i < snap.rows.length; i++) expect(snap.rows[i].ts).toBeLessThanOrEqual(snap.rows[i - 1].ts);
  });

  it('a failing chain is reported and retried, and the other chain still shows', async () => {
    let broken = true;
    const view = createView([
      worldReader(1),
      worldReader(167000, {
        tweak: (io) => {
          const real = io.latestBlock.bind(io);
          io.latestBlock = async (a) => {
            if (broken) throw new Error('node is down');
            return real(a);
          };
        },
      }),
    ]);
    const feed = view.followFeed([A0]);
    await feed.refresh();
    let snap = await settle(feed);
    expect(snap.anyError).toBe(true);
    expect(snap.allErrored).toBe(false);
    expect(snap.chains.find((c) => c.chainId === 167000).error).toBeTruthy();
    expect(snap.rows.length).toBeGreaterThan(0);
    expect(snap.rows.every((r) => r.chainId === 1)).toBe(true);

    broken = false;
    await feed.retry(167000);
    snap = await settle(feed);
    expect(snap.anyError).toBe(false);
    expect(snap.rows.some((r) => r.chainId === 167000)).toBe(true);
  });

  it('the same set of authors reuses one feed, in any order', () => {
    const view = createView([worldReader(1)]);
    expect(view.followFeed([A0, A1])).toBe(view.followFeed([A1, A0]));
    expect(view.followFeed([A0, A1])).not.toBe(view.followFeed([A0]));
  });

  it('shares the author walks with the author pages, so opening one costs nothing', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const feed = view.followFeed([A0]);
    await feed.refresh();
    await settle(feed);
    // The author page's controller is the same object, already populated.
    expect(view.authorList(A0).getSnapshot().rows.length).toBeGreaterThan(0);
  });

  it('notifies subscribers as rows arrive', async () => {
    const view = createView([worldReader(1)]);
    const feed = view.followFeed([A0]);
    let beats = 0;
    const off = feed.subscribe(() => { beats += 1; });
    await feed.refresh();
    await settle(feed);
    off();
    expect(beats).toBeGreaterThan(0);
    // A settled snapshot is stable, as useSyncExternalStore requires.
    expect(feed.getSnapshot()).toBe(feed.getSnapshot());
  });
});
