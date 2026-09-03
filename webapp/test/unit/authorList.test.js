// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthorListController } from '../../src/lib/authorList';
import { AUTHORS, fakeChain, freshStore, silentLog } from './helpers';

const [A, B] = AUTHORS;

// A has 12 posts, one per 100 blocks from 100; B has one post in between.
const posts = [
  ...Array.from({ length: 12 }, (_, i) => ({ author: A, index: i, block: 100 + i * 100 })),
  { author: B, index: 0, block: 650 },
];

function make({ chainId = 301, ttl = 60_000 } = {}) {
  const store = freshStore(chainId);
  const chain = fakeChain({ chainId, head: 2000, posts });
  const list = new AuthorListController({
    author: A,
    store,
    io: chain.io,
    log: silentLog(),
    pageSize: 5,
    getTtlMs: () => ttl,
  });
  return { store, chain, list };
}

const walks = (chain) => chain.calls.filter((c) => c.method === 'eth_getLogs:author');

describe('AuthorListController', () => {
  beforeEach(() => localStorage.clear());

  it('walks the reverse linked list from latestBlock for one page', async () => {
    const { list, chain, store } = make();
    await list.refresh();
    const snap = list.getSnapshot();
    expect(snap.rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7]);
    expect(snap.hasMore).toBe(true);
    expect(walks(chain).map((c) => Number(c.args[1]))).toEqual([1200, 1100, 1000, 900, 800]);
    expect(store.authorScanHead(A)).toBe('1200');
  });

  it('loadMore continues from the oldest row', async () => {
    const { list } = make();
    await list.refresh();
    await list.loadMore();
    expect(list.getSnapshot().rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    await list.loadMore();
    const snap = list.getSnapshot();
    expect(snap.rows).toHaveLength(12);
    expect(snap.hasMore).toBe(false);
  });

  it('a refresh with the head unchanged does not walk again', async () => {
    const { list, chain } = make({ ttl: 0 });
    await list.refresh();
    const n = walks(chain).length;
    await list.refresh();
    expect(walks(chain).length).toBe(n);
  });

  it('seeds instantly from a completed walk in storage', async () => {
    const { list, store } = make();
    await list.refresh();
    const again = new AuthorListController({
      author: A, store, io: null, log: silentLog(), pageSize: 5, getTtlMs: () => 60_000,
    });
    expect(again.getSnapshot().rows).toHaveLength(5);
  });

  it('an author who never published gets an empty list', async () => {
    const store = freshStore(302);
    const chain = fakeChain({ chainId: 302, head: 2000, posts });
    const list = new AuthorListController({
      author: AUTHORS[2], store, io: chain.io, log: silentLog(), pageSize: 5, getTtlMs: () => 0,
    });
    await list.refresh();
    expect(list.getSnapshot().rows).toEqual([]);
    expect(list.getSnapshot().hasMore).toBe(false);
  });

  it('records a failure and recovers on retry', async () => {
    const { list, chain } = make();
    const real = chain.io.latestBlock;
    chain.io.latestBlock = async () => {
      throw new Error('boom');
    };
    await list.refresh();
    expect(list.getSnapshot().error).toMatch(/boom/);
    chain.io.latestBlock = real;
    await list.retry();
    expect(list.getSnapshot().error).toBeNull();
    expect(list.getSnapshot().rows).toHaveLength(5);
  });
});
