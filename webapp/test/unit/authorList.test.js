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

describe('AuthorListController — lagging nodes and new posts', () => {
  it('a node answering the head block empty fails the walk without claiming coverage; retry recovers', async () => {
    const { list, chain, store } = make({ chainId: 302 });
    let behind = true;
    const real = chain.io.authorPostsInBlock.bind(chain.io);
    chain.io.authorPostsInBlock = async (author, block) => (behind ? [] : real(author, block));
    await list.refresh();
    let snap = list.getSnapshot();
    expect(snap.error).toMatch(/尚未同步到区块 1200/);
    expect(snap.rows).toEqual([]);
    expect(store.authorCoverage(A)).toEqual([]);
    expect(store.authorScanHead(A)).toBeNull();
    behind = false;
    await list.retry();
    snap = list.getSnapshot();
    expect(snap.error).toBeNull();
    expect(snap.rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7]);
    expect(store.authorScanHead(A)).toBe('1200');
  });

  it('a head block a sweep claimed empty is read again', async () => {
    const { list, chain, store } = make({ chainId: 303 });
    store.rememberFeedRange(1200n, 1200n); // a lagging node's sweep saw nothing there
    await list.refresh();
    expect(list.getSnapshot().rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7]);
    expect(walks(chain).map((c) => Number(c.args[1]))).toEqual([1200, 1100, 1000, 900, 800]);
  });

  it('a refresh after new posts walks down to the rows it already has, leaving no hole', async () => {
    const { list, chain } = make({ chainId: 304 });
    let visible = 800n; // the author's newest post the chain has seen so far
    chain.io.latestBlock = async () => visible;
    await list.refresh();
    expect(list.getSnapshot().rows.map((r) => Number(r.index))).toEqual([7, 6, 5, 4, 3]);
    visible = 1200n; // four posts since
    await list.refresh();
    let snap = list.getSnapshot();
    expect(snap.rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(snap.hasMore).toBe(true);
    // Block 800 was served from the store; only the new blocks were read.
    expect(walks(chain).map((c) => Number(c.args[1]))).toEqual([800, 700, 600, 500, 400, 1200, 1100, 1000, 900]);
    await list.loadMore();
    snap = list.getSnapshot();
    expect(snap.rows.map((r) => Number(r.index))).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(snap.hasMore).toBe(false);
    const before = chain.calls.length;
    await list.loadMore(); // nothing older than the first post
    expect(chain.calls).toHaveLength(before);
  });

  it('an author with a single post has nothing more to walk', async () => {
    const store = freshStore(305);
    const chain = fakeChain({ chainId: 305, head: 2000, posts });
    const list = new AuthorListController({ author: B, store, io: chain.io, log: silentLog(), pageSize: 5, getTtlMs: () => 0 });
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ hasMore: false, error: null });
    expect(list.getSnapshot().rows.map((r) => Number(r.block))).toEqual([650]);
  });
});
