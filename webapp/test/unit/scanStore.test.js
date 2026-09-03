// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createScanStore, feedCompare, isOlder, FEED_ROW_CAP } from '../../src/lib/scanStore';
import { AUTHORS, fakeChain, freshStore } from './helpers';

const [A, B] = AUTHORS;

const row = (author, index, block, extra = {}) => ({
  author,
  index,
  block,
  prevBlock: 0,
  title: `t${index}`,
  txHash: `0x${String(index).padStart(64, '0')}`,
  eventIndex: 0,
  ...extra,
});

describe('scanStore', () => {
  beforeEach(() => localStorage.clear());

  it('normalizes rows to BigInt heights and indexes', () => {
    const store = freshStore(1);
    const [r] = store.rememberPosts([row(A, 3, 100)]);
    expect(r.index).toBe(3n);
    expect(r.block).toBe(100n);
    expect(r.prevBlock).toBe(0n);
    expect(r.logIndex).toBeNull();
    expect(store.knownPost(A, 3)).toBe(r);
    expect(store.knownPostByTx(r.txHash, 0)).toBe(r);
  });

  it('dedupes by (author, index) and lets a row with a logIndex supersede one without', () => {
    const store = freshStore(1);
    const [first] = store.rememberPosts([row(A, 1, 50)]);
    const [again] = store.rememberPosts([row(A, 1, 50)]);
    expect(again).toBe(first);
    const [better] = store.rememberPosts([row(A, 1, 50, { logIndex: 7 })]);
    expect(better).not.toBe(first);
    expect(store.knownPost(A, 1).logIndex).toBe(7);
    // …but a legacy row never replaces a better one.
    const [same] = store.rememberPosts([row(A, 1, 50)]);
    expect(same.logIndex).toBe(7);
  });

  it('coveredPosts lists only posts inside swept ranges, newest first', () => {
    const store = freshStore(1);
    store.rememberPosts([row(A, 0, 10), row(B, 0, 20), row(A, 1, 30, { logIndex: 2 }), row(B, 1, 30, { logIndex: 5 })]);
    expect(store.coveredPosts()).toEqual([]);
    store.rememberFeedRange(15n, 40n);
    const covered = store.coveredPosts();
    expect(covered.map((r) => [r.author, r.index])).toEqual([
      [B, 1n],
      [A, 1n],
      [B, 0n],
    ]);
    expect(store.allPosts()).toHaveLength(4);
    expect(store.postsInRange(0n, 10n)).toHaveLength(1);
  });

  it('feedCompare and isOlder order by block then logIndex', () => {
    const a = { block: 10n, logIndex: 1 };
    const b = { block: 10n, logIndex: 3 };
    const c = { block: 9n, logIndex: null };
    expect([a, c, b].sort(feedCompare)).toEqual([b, a, c]);
    expect(isOlder(a, b)).toBe(true);
    expect(isOlder(c, a)).toBe(true);
    expect(isOlder(a, { block: 10n, logIndex: null })).toBe(false);
  });

  it('author coverage is the union of own blocks and feed sweeps; knownChain follows prevBlock', () => {
    const store = freshStore(1);
    const chain = fakeChain({ posts: [
      { author: A, index: 0, block: 10 },
      { author: A, index: 1, block: 20 },
      { author: A, index: 2, block: 30 },
    ] });
    store.rememberPosts(chain.rows);
    store.rememberFeedRange(25n, 35n); // covers block 30 for everyone
    store.rememberAuthorBlock(A, 20n);
    expect(store.authorCoverage(A)).toEqual([[20n, 20n], [25n, 35n]]);
    // Walk from 30: 30 (covered) → 20 (covered) → 10 (not covered: stop).
    expect(store.knownChain(A, 30n).map((r) => r.index)).toEqual([2n, 1n]);
    expect(store.authorPostsInBlock(A, 20n)).toHaveLength(1);
    expect(store.authorPosts(A).map((r) => r.index)).toEqual([2n, 1n, 0n]);
  });

  it('persists the feed snapshot and seeds a new store from it', () => {
    const store = freshStore(1);
    store.rememberPosts([row(A, 0, 10, { logIndex: 0 }), row(B, 0, 12)]);
    store.rememberFeedRange(5n, 15n);
    store.setFeedScanHead(15n);
    store.persistFeedScan();
    const saved = JSON.parse(localStorage.getItem('glyph.feedScan.v2.1'));
    expect(saved.head).toBe('15');
    expect(saved.segments).toEqual([[5, 15]]);
    expect(saved.rows).toHaveLength(2);
    expect(typeof saved.rows[0].block).toBe('number');

    const again = createScanStore(1);
    expect(again.feedCoverage()).toEqual([[5n, 15n]]);
    expect(again.feedScanHead()).toBe('15');
    expect(again.coveredPosts()).toHaveLength(2);
    expect(again.knownPost(A, 0).logIndex).toBe(0);
  });

  it('persists per-author scans and reads them back', () => {
    const store = freshStore(1);
    store.rememberPosts([row(A, 0, 10), row(A, 1, 20)]);
    store.rememberAuthorBlock(A, 20n);
    store.setAuthorScanHead(A, 20n);
    store.persistAuthorScan(A);
    const again = createScanStore(1);
    expect(again.authorScanHead(A)).toBe('20');
    expect(again.authorCoverage(A)).toEqual([[20n, 20n]]);
    expect(again.readAuthorScanEntries()).toEqual([
      { address: A.toLowerCase(), head: '20', segments: [[20n, 20n]], count: 2 },
    ]);
  });

  it('caps persisted rows and retracts coverage it can no longer vouch for', () => {
    const store = freshStore(1);
    const rows = [];
    for (let i = 0; i < FEED_ROW_CAP + 50; i++) rows.push(row(A, i, 1000 + i));
    store.rememberPosts(rows);
    store.rememberFeedRange(900n, 2000n);
    store.persistFeedScan();
    const saved = JSON.parse(localStorage.getItem('glyph.feedScan.v2.1'));
    expect(saved.rows).toHaveLength(FEED_ROW_CAP);
    // The newest FEED_ROW_CAP rows sit in blocks 1050..1349; blocks below the
    // oldest kept row are no longer claimed.
    const oldestKept = Math.min(...saved.rows.map((r) => r.block));
    expect(saved.segments).toEqual([[oldestKept, 2000]]);
  });

  it('reads a v1 mainnet snapshot as the first segment', () => {
    localStorage.setItem(
      'glyph.feedScan.v1',
      JSON.stringify({ frontier: 100, head: '200', rows: [row(A, 0, 150)] }),
    );
    const store = createScanStore(1);
    expect(store.feedCoverage()).toEqual([[100n, 200n]]);
    expect(store.feedScanHead()).toBe('200');
    expect(store.coveredPosts()).toHaveLength(1);
    store.persistFeedScan();
    expect(localStorage.getItem('glyph.feedScan.v1')).toBeNull();
    expect(localStorage.getItem('glyph.feedScan.v2.1')).not.toBeNull();
  });

  it('once() shares an in-flight promise per key', async () => {
    const store = freshStore(1);
    let runs = 0;
    const fn = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 5));
      return runs;
    };
    const [a, b] = await Promise.all([store.once('k', fn), store.once('k', fn)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(await store.once('k', fn)).toBe(2);
  });

  it('notifies subscribers on every mutation', () => {
    const store = freshStore(1);
    let n = 0;
    const off = store.subscribe(() => n++);
    store.rememberPosts([row(A, 0, 1)]);
    store.rememberFeedRange(0n, 5n);
    store.setFeedScanHead(5n);
    expect(n).toBe(3);
    off();
    store.rememberPosts([row(A, 1, 2)]);
    expect(n).toBe(3);
  });
});

describe('scanStore timestamps', () => {
  beforeEach(() => localStorage.clear());

  it('keeps ts on rows, persists it and reads it back', () => {
    const store = freshStore(1);
    store.rememberPosts([row(A, 0, 10, { ts: 1_700_000_000 }), row(B, 0, 12)]);
    expect(store.knownPost(A, 0).ts).toBe(1_700_000_000);
    expect(store.knownPost(B, 0).ts).toBeNull();
    store.rememberFeedRange(5n, 15n);
    store.persistFeedScan();
    const again = createScanStore(1);
    expect(again.knownPost(A, 0).ts).toBe(1_700_000_000);
    expect(again.knownPost(B, 0).ts).toBeNull();
    expect(again.knownBlockTs(10n)).toBe(1_700_000_000);
    expect(again.knownBlockTs(12n)).toBeNull();
  });

  it('a newcomer fills a missing ts (and logIndex) on the held row', () => {
    const store = freshStore(1);
    const [held] = store.rememberPosts([row(A, 0, 10)]);
    let bumps = 0;
    store.subscribe(() => bumps++);
    const [filled] = store.rememberPosts([row(A, 0, 10, { ts: 5, logIndex: 2 })]);
    expect(filled).not.toBe(held);
    expect(filled).toMatchObject({ ts: 5, logIndex: 2 });
    expect(store.knownPost(A, 0)).toBe(filled);
    expect(bumps).toBe(1);
    // Nothing to fill: no new object, no notification.
    const [same] = store.rememberPosts([row(A, 0, 10, { ts: 99 })]);
    expect(same).toBe(filled);
    expect(same.ts).toBe(5);
    expect(bumps).toBe(1);
  });

  it('rememberBlockTs stamps every row in the block still lacking one', () => {
    const store = freshStore(1);
    store.rememberPosts([row(A, 0, 10), row(B, 0, 10, { ts: 1 }), row(A, 1, 11)]);
    let bumps = 0;
    store.subscribe(() => bumps++);
    expect(store.rememberBlockTs(10n, 7)).toBe(true);
    expect(store.knownPost(A, 0).ts).toBe(7);
    expect(store.knownPost(B, 0).ts).toBe(1); // already had one
    expect(store.knownPost(A, 1).ts).toBeNull(); // other block
    expect(bumps).toBe(1);
    expect(store.rememberBlockTs(10n, 8)).toBe(false); // nothing left to fill
    expect(store.rememberBlockTs(99n, 8)).toBe(false); // unknown block
    expect(store.rememberBlockTs(11n, null)).toBe(false);
    expect(bumps).toBe(1);
  });
});
