import { describe, expect, it } from 'vitest';
import { AUTHORS as WORLD_AUTHORS, buildWorlds } from '../../src/lib/fixtureWorld';
import { createView } from '../../src/lib/view';
import { AUTHORS, fakeChain } from './helpers';
import { NOW, ioReader, settle, worldReader } from './mergedHelpers';

const [A0] = WORLD_AUTHORS;

describe('MergedAuthorList', () => {
  it('merges an author\'s lists from both chains, newest first', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const list = view.authorList(A0);
    await list.refresh();
    const snap = await settle(list);
    const worlds = buildWorlds([1, 167000], { now: NOW });
    const expected = [...worlds.get(1).byAuthor.get(A0.toLowerCase()), ...worlds.get(167000).byAuthor.get(A0.toLowerCase())]
      .sort((a, b) => b.ts - a.ts)
      .map((p) => p.txHash);
    expect(snap.rows.map((r) => r.txHash)).toEqual(expected);
    expect(snap.rows.map((r) => r.chainId).includes(167000)).toBe(true);
    // Both walks reached the author's first post: nothing more, no frontier.
    expect(snap.hasMore).toBe(false);
    expect(snap.frontier).toBeNull();
    expect(snap.chains.map((c) => [c.chainId, c.count, c.hasMore])).toEqual([[1, 5, false], [167000, 3, false]]);
  });

  it('an author who wrote on one chain only', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const list = view.authorList(WORLD_AUTHORS[3]);
    await list.refresh();
    const snap = await settle(list);
    expect(snap.rows.every((r) => r.chainId === 167000)).toBe(true);
    expect(snap.rows).toHaveLength(3);
    expect(snap.frontier).toBeNull();
    expect(snap.hasMore).toBe(false);
  });

  it('marks the frontier while one chain\'s walk is incomplete, and load-more walks it', async () => {
    // 25 posts on chain 1 (a walk shows 20), 3 on 167000, same author.
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
    const view = createView([ioReader(1, eth.io), ioReader(167000, taiko.io)]);
    const list = view.authorList(AUTHORS[0]);
    await list.refresh();
    let snap = await settle(list);
    expect(snap.chains.map((c) => [c.chainId, c.count, c.hasMore])).toEqual([[1, 20, true], [167000, 3, false]]);
    // Chain 1 is known down to its 20th-newest post; Taiko rows older than that sit below the marker.
    const oldestWalked = eth.tsOf(1000 + 5 * 1000);
    expect(snap.frontier).toMatchObject({ ts: oldestWalked, leaders: [{ chainId: 1, state: 'covered' }] });
    const below = snap.rows.slice(snap.frontier.after + 1);
    expect(below.every((r) => r.ts < oldestWalked)).toBe(true);
    expect(snap.hasMore).toBe(true);

    await list.loadMore();
    snap = await settle(list);
    expect(snap.chains[0]).toMatchObject({ count: 25, hasMore: false });
    expect(snap.frontier).toBeNull();
    expect(snap.hasMore).toBe(false);
    expect(snap.rows).toHaveLength(28);
    for (let i = 1; i < snap.rows.length; i++) expect(snap.rows[i].ts).toBeLessThanOrEqual(snap.rows[i - 1].ts);
  });

  it('reports a failing chain and keeps the other\'s rows', async () => {
    let broken = true;
    const view = createView([
      worldReader(1),
      worldReader(167000, {
        tweak: (io) => {
          const real = io.latestBlock.bind(io);
          io.latestBlock = async (a) => {
            if (broken) throw new Error('taiko down');
            return real(a);
          };
        },
      }),
    ]);
    const list = view.authorList(A0);
    await list.refresh();
    let snap = await settle(list);
    expect(snap.rows).toHaveLength(5);
    expect(snap.chains[1].error).toMatch(/taiko down/);
    expect(snap.frontier).toMatchObject({ after: -1, leaders: [{ chainId: 167000, state: 'error' }] });
    expect(snap.hasMore).toBe(true);
    broken = false;
    await list.retry();
    snap = await settle(list);
    expect(snap.rows).toHaveLength(8);
    expect(snap.frontier).toBeNull();
  });

  it('is nothing more than the single list on a single-chain view', async () => {
    const view = createView([worldReader(1)]);
    const list = view.authorList(A0);
    await list.refresh();
    const snap = await settle(list);
    expect(snap.rows).toHaveLength(5);
    expect(snap.frontier).toBeNull();
    expect(snap.rows.map((r) => Number(r.index))).toEqual([4, 3, 2, 1, 0]);
  });
});
