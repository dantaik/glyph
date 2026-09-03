// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTHOR_ROW_CAP, FEED_ROW_CAP, createScanStore } from '../../src/lib/scanStore';
import { AUTHORS, freshStore } from './helpers';

const [A] = AUTHORS;
const row = (index, block, extra = {}) => ({ author: A, index, block, txHash: `0x${index}`, prevBlock: 0, ...extra });

describe('scanStore — what persistence may claim', () => {
  beforeEach(() => localStorage.clear());

  it('a block holding more rows than the cap keeps what fits but withdraws that block\'s coverage', () => {
    const store = freshStore(401);
    store.rememberPosts(Array.from({ length: FEED_ROW_CAP + 1 }, (_, i) => row(i, 500, { logIndex: i })));
    store.rememberFeedRange(400n, 600n);
    store.persistFeedScan();
    const again = createScanStore(401);
    expect(again.allPosts()).toHaveLength(FEED_ROW_CAP);
    expect(again.feedCoverage()).toEqual([[501n, 600n]]);
  });

  it('a cut at a block boundary keeps that block\'s coverage whole', () => {
    const store = freshStore(402);
    store.rememberPosts(Array.from({ length: FEED_ROW_CAP + 1 }, (_, i) => row(i, i))); // blocks 0..300
    store.rememberFeedRange(0n, 400n);
    store.persistFeedScan();
    const again = createScanStore(402);
    expect(again.allPosts()).toHaveLength(FEED_ROW_CAP);
    expect(again.allPosts().at(-1).block).toBe(1n);
    expect(again.feedCoverage()).toEqual([[1n, 400n]]);
  });

  it('an author\'s own coverage is clipped to the rows kept for them', () => {
    const store = freshStore(403);
    for (let i = 0; i <= AUTHOR_ROW_CAP; i++) {
      store.rememberPosts([row(i, i + 1)]);
      store.rememberAuthorBlock(A, BigInt(i + 1));
    }
    store.setAuthorScanHead(A, AUTHOR_ROW_CAP + 1);
    store.persistAuthorScan(A);
    const again = createScanStore(403);
    expect(again.authorPosts(A)).toHaveLength(AUTHOR_ROW_CAP);
    expect(again.authorCoverage(A)).toEqual([[2n, BigInt(AUTHOR_ROW_CAP + 1)]]);
    expect(again.authorScanHead(A)).toBe(String(AUTHOR_ROW_CAP + 1));
  });

  it('a corrupted snapshot reads as a first scan, and is overwritten cleanly', () => {
    localStorage.setItem('glyph.feedScan.v2.404', '{not json');
    localStorage.setItem('glyph.authorScan.v2.404', '[1, 2');
    const store = createScanStore(404);
    expect(store.allPosts()).toEqual([]);
    expect(store.feedCoverage()).toEqual([]);
    store.rememberPosts([row(0, 10)]);
    store.rememberFeedRange(0n, 20n);
    store.persistFeedScan();
    expect(createScanStore(404).feedCoverage()).toEqual([[0n, 20n]]);
  });

  it('a v1 mainnet snapshot means nothing to another chain\'s store', () => {
    localStorage.setItem('glyph.feedScan.v1', JSON.stringify({ head: '300', frontier: 100, rows: [row(0, 150)] }));
    expect(createScanStore(167000).allPosts()).toEqual([]);
    expect(createScanStore(1).allPosts()).toHaveLength(1);
  });
});

describe('scanStore — walking and sharing', () => {
  it('knownChain stops at the first block it would have to fetch', () => {
    const store = freshStore(405);
    store.rememberPosts([row(0, 100), row(1, 200, { prevBlock: 100 }), row(2, 300, { prevBlock: 200 })]);
    store.rememberAuthorBlock(A, 300n);
    store.rememberAuthorBlock(A, 200n);
    expect(store.knownChain(A, 300n).map((r) => Number(r.index))).toEqual([2, 1]);
    store.rememberFeedRange(50n, 150n); // a sweep proves block 100 too
    expect(store.knownChain(A, 300n).map((r) => Number(r.index))).toEqual([2, 1, 0]);
  });

  it('once() hands one rejection to every waiter and frees the key', async () => {
    const store = freshStore(406);
    const p1 = store.once('k', () => Promise.reject(new Error('boom')));
    const p2 = store.once('k', () => 'never runs');
    expect(p2).toBe(p1);
    await expect(p1).rejects.toThrow(/boom/);
    expect(await store.once('k', () => 'ok')).toBe('ok');
  });

  it('rememberPosts keeps the held row and fills only what it lacked', () => {
    const store = freshStore(407);
    const [held] = store.rememberPosts([row(0, 100, { title: 'first' })]);
    const [again] = store.rememberPosts([row(0, 100, { title: 'second', logIndex: 3, ts: 99 })]);
    expect(again).not.toBe(held); // a fresh object, so watchers notice
    expect(again).toMatchObject({ title: 'first', logIndex: 3, ts: 99 });
    const [third] = store.rememberPosts([row(0, 100, { title: 'third', logIndex: 9, ts: 1 })]);
    expect(third).toBe(again); // nothing left to fill: the same object
  });
});
