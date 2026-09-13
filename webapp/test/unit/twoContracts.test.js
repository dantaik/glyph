// @vitest-environment jsdom
// twoContracts.test.js — one chain read on two contracts.
//
// An author has an independent list on each contract, so a post is
// (author, index, version), a walk head is per version, and the reader
// merges the two streams of a chain by block — holding back what a stream
// that stopped higher may still be hiding. Coverage recorded by a build that
// read fewer contracts is not trusted.

import { beforeEach, describe, expect, it } from 'vitest';
import { AuthorListController } from '../../src/lib/authorList';
import { createScanStore, postId } from '../../src/lib/scanStore';
import { AUTHORS, fakeChain, freshStore, silentLog } from './helpers';
import { ioReader } from './mergedHelpers';

const [A, B] = AUTHORS;
const HOOK = '0x00000000000000000000000000000000000000AB';

// A has 12 posts on v1 (one per 100 blocks from 100) and three on v2, one
// of them through a hook; B has one post on each contract.
const posts = [
  ...Array.from({ length: 12 }, (_, i) => ({ author: A, index: i, block: 100 + i * 100 })),
  { author: A, index: 0, block: 150, version: 2 },
  { author: A, index: 1, block: 650, version: 2, hook: HOOK },
  { author: A, index: 2, block: 1150, version: 2 },
  { author: B, index: 0, block: 660, version: 1 },
  { author: B, index: 0, block: 670, version: 2 },
];

const row = (author, index, block, extra = {}) => ({
  author,
  index,
  block,
  prevBlock: 0,
  title: `t${index}`,
  txHash: `0x${String(block).padStart(4, '0').repeat(16)}`,
  eventIndex: 0,
  logIndex: 0,
  ...extra,
});

describe('the scan store with two contracts', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the same index on the two contracts as two posts', () => {
    const store = freshStore(701);
    const [v1, v2] = store.rememberPosts([row(A, 0, 100), row(A, 0, 150, { version: 2, hook: HOOK })]);
    expect(postId(A, 0)).toBe(`${A.toLowerCase()}:0`); // v1's key is what it always was
    expect(postId(A, 0, 2)).not.toBe(postId(A, 0));
    expect(store.knownPost(A, 0)).toBe(v1);
    expect(store.knownPost(A, 0, 2)).toBe(v2);
    expect(v2.version).toBe(2);
    expect(v2.hook).toBe(HOOK.toLowerCase());
    expect(v1.version).toBe(1);
    expect(v1.hook).toBeNull();
    expect(store.authorPostsInBlock(A, 150n, 2)).toEqual([v2]);
    expect(store.authorPostsInBlock(A, 150n, 1)).toEqual([]);
    expect(store.authorPosts(A)).toHaveLength(2);
    expect(store.authorPosts(A, 2)).toEqual([v2]);
  });

  it('keeps a walk head per contract, and persists both', () => {
    const store = createScanStore(702, { versions: [1, 2] });
    store.rememberPosts([row(A, 0, 100), row(A, 0, 150, { version: 2 })]);
    store.rememberAuthorBlock(A, 100n);
    store.rememberAuthorBlock(A, 150n);
    store.setAuthorScanHead(A, 100n);
    store.setAuthorScanHead(A, 150n, 2);
    store.persistAuthorScan(A);
    expect(store.authorScanHead(A)).toBe('100');
    expect(store.authorScanHead(A, 2)).toBe('150');
    expect(store.knownChain(A, 150n, 2).map((r) => r.version)).toEqual([2]);
    expect(store.knownChain(A, 100n).map((r) => r.version)).toEqual([1]);

    const again = createScanStore(702, { versions: [1, 2] });
    expect(again.authorScanHead(A)).toBe('100');
    expect(again.authorScanHead(A, 2)).toBe('150');
    expect(again.knownPost(A, 0, 2).version).toBe(2);
    // The /scan page sees the newest head of the two.
    expect(again.readAuthorScanEntries()[0].head).toBe('150');
  });

  it('does not trust coverage recorded under another set of contracts', () => {
    const before = createScanStore(703, { versions: [1] });
    before.rememberPosts([row(A, 0, 100), row(B, 0, 200)]);
    before.rememberFeedRange(50n, 250n);
    before.setFeedScanHead(250n);
    before.rememberAuthorBlock(A, 100n);
    before.setAuthorScanHead(A, 100n);
    before.persistFeedScan();
    before.persistAuthorScan(A);

    // The same build again: everything comes back.
    const same = createScanStore(703, { versions: [1] });
    expect(same.feedCoverage()).toEqual([[50n, 250n]]);
    expect(same.authorScanHead(A)).toBe('100');

    // A build that reads a second contract: the rows are kept — they are
    // real posts — but ranges read for one contract prove nothing about the
    // other, so the coverage and the heads start empty.
    const wider = createScanStore(703, { versions: [1, 2] });
    expect(wider.allPosts()).toHaveLength(2);
    expect(wider.feedCoverage()).toEqual([]);
    expect(wider.feedScanHead()).toBeNull();
    expect(wider.authorCoverage(A)).toEqual([]);
    expect(wider.authorScanHead(A)).toBeNull();
    expect(wider.versions).toEqual([1, 2]);

    // Once it has persisted, the wider set is what is recorded.
    wider.rememberFeedRange(50n, 250n);
    wider.persistFeedScan();
    expect(createScanStore(703, { versions: [1, 2] }).feedCoverage()).toEqual([[50n, 250n]]);
    expect(createScanStore(703, { versions: [1] }).feedCoverage()).toEqual([]);
  });
});

describe('an author list over two contracts', () => {
  beforeEach(() => localStorage.clear());

  function make({ chainId = 711, pageSize = 5 } = {}) {
    const store = createScanStore(chainId, { versions: [1, 2] });
    const chain = fakeChain({ chainId, head: 2000, posts, versions: [1, 2] });
    const list = new AuthorListController({
      author: A,
      store,
      io: chain.io,
      log: silentLog(),
      pageSize,
      getTtlMs: () => 60_000,
    });
    return { store, chain, list };
  }

  const shape = (rows) => rows.map((r) => `${r.version}:${Number(r.block)}`);

  it('walks both streams and merges them by block, newest first', async () => {
    const { list, chain } = make();
    expect(list.versions).toEqual([1, 2]);
    await list.refresh();
    const snap = list.getSnapshot();
    // v1 walked 1200…800 (a page), v2 walked to its first post. Everything
    // at or above v1's stop shows; v2's older two wait behind it.
    expect(shape(snap.rows)).toEqual(['2:1150', '1:1200', '1:1100', '1:1000', '1:900', '1:800'].sort((x, y) => Number(y.split(':')[1]) - Number(x.split(':')[1])));
    expect(snap.hasMore).toBe(true);
    expect(snap.error).toBeNull();
    expect(snap.streams.map((s) => [s.version, s.rows.length, s.hasMore])).toEqual([
      [1, 5, true],
      [2, 3, false],
    ]);
    // One head read per contract, then single-block walks.
    expect(chain.calls.filter((c) => c.method === 'latestBlock')).toHaveLength(2);
    expect(chain.calls.filter((c) => c.method === 'eth_getLogs:author').map((c) => Number(c.args[1]))).toEqual(
      expect.arrayContaining([1200, 1150, 650, 150]),
    );
  });

  it('load more deepens the stream that stopped highest, and the held rows come out in order', async () => {
    const { list } = make();
    await list.refresh();
    await list.loadMore();
    let snap = list.getSnapshot();
    expect(shape(snap.rows)).toEqual([
      '2:1150', '1:1200', '1:1100', '1:1000', '1:900', '1:800', '1:700', '2:650', '1:600', '1:500', '1:400', '1:300',
    ].sort((x, y) => Number(y.split(':')[1]) - Number(x.split(':')[1])));
    expect(snap.hasMore).toBe(true);
    await list.loadMore();
    snap = list.getSnapshot();
    expect(snap.rows).toHaveLength(15);
    expect(snap.hasMore).toBe(false);
    expect(shape(snap.rows).slice(-3)).toEqual(['1:200', '2:150', '1:100']);
    expect(snap.rows.find((r) => r.version === 2 && Number(r.block) === 650).hook).toBe(HOOK.toLowerCase());
  });

  it('an author who never wrote on the second contract reads exactly as before', async () => {
    const chainId = 712;
    const store = createScanStore(chainId, { versions: [1, 2] });
    const chain = fakeChain({ chainId, head: 2000, posts, versions: [1, 2] });
    const list = new AuthorListController({ author: AUTHORS[2], store, io: chain.io, log: silentLog(), pageSize: 5, getTtlMs: () => 0 });
    await list.refresh();
    expect(list.getSnapshot().rows).toEqual([]);
    expect(list.getSnapshot().hasMore).toBe(false);
    expect(list.getSnapshot().refreshedAt).toBeGreaterThan(0);
  });

  it('seeds both streams from storage and knows which stream a post is in', async () => {
    const { list, store } = make({ chainId: 713 });
    await list.refresh();
    const again = new AuthorListController({ author: A, store, io: null, log: silentLog(), pageSize: 5, getTtlMs: () => 60_000 });
    expect(again.getSnapshot().rows).toHaveLength(6);
    expect(again.stream(2).getSnapshot().rows).toHaveLength(3);
    expect(again.stream(1).getSnapshot().rows).toHaveLength(5);
    expect(again.stream(3)).toBeNull();
  });

  it('a failing stream is reported, and retry asks it again', async () => {
    const { list, chain } = make({ chainId: 714 });
    const real = chain.io.latestBlock;
    chain.io.latestBlock = async (author, version) => {
      if (version === 2) throw new Error('v2 node down');
      return real(author, version);
    };
    await list.refresh();
    let snap = list.getSnapshot();
    expect(snap.error).toMatch(/v2 node down/);
    expect(snap.rows.length).toBe(5); // v1 still shows
    chain.io.latestBlock = real;
    await list.retry();
    snap = list.getSnapshot();
    expect(snap.error).toBeNull();
    expect(snap.rows.length).toBe(6);
  });
});

describe('the reader over two contracts', () => {
  it('counts an author across both contracts, and finds a post on either', async () => {
    const chain = fakeChain({ chainId: 721, head: 2000, posts, versions: [1, 2] });
    const reader = ioReader(721, chain.io);
    expect(reader.versions).toEqual([1, 2]);
    expect(await reader.count(A)).toBe(15n);
    expect(await reader.countOf(A, 2)).toBe(3n);
    expect(await reader.countOf(B, 1)).toBe(1n);
    expect(await reader.isDeployed(2)).toBe(true);
    const onV2 = await reader.findTitleMeta(A, 1, 2);
    expect(onV2).toMatchObject({ version: 2, block: 650n, hook: HOOK.toLowerCase() });
    const onV1 = await reader.findTitleMeta(A, 1);
    expect(onV1).toMatchObject({ version: 1, block: 200n });
    expect(onV1).not.toBe(onV2);
    // And the same post by its transaction says which contract it is on.
    const byTx = await reader.findMetaByTx(onV2.txHash, 0);
    expect(byTx).toBe(onV2);
  });
});
