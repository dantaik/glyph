// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBodyIndex } from '../../src/lib/bodyIndex';
import { createScanStore } from '../../src/lib/scanStore';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const tx = (n) => `0x${String(n).padStart(64, '0')}`;

/** A post row the way the scan store holds one. */
const row = (n, { author = A, block = 100n, index = 0n } = {}) => ({
  author,
  index: BigInt(index),
  block: BigInt(block),
  prevBlock: 0n,
  title: `post ${n}`,
  txHash: tx(n),
  eventIndex: 0,
  logIndex: 0,
  ts: 1_700_000_000 + Number(block),
});

const body = ({ tags = [], meta = {}, markdown = 'Body.' } = {}) => ({ tags, meta, markdown });

function freshIndex() {
  localStorage.clear();
  return createBodyIndex(1, { store: createScanStore(1) });
}

beforeEach(() => localStorage.clear());

describe('what the bodies say about tags', () => {
  it('finds every post carrying a tag, newest first, whatever its case', () => {
    const index = freshIndex();
    index.add(row(1, { block: 100n }), body({ tags: ['Letters Home', 'winter'] }));
    index.add(row(2, { block: 300n }), body({ tags: ['letters home'] }));
    index.add(row(3, { block: 200n }), body({ tags: ['sea'] }));

    expect(index.rowsWithTag('letters home').map((p) => p.txHash)).toEqual([tx(2), tx(1)]);
    expect(index.rowsWithTag('LETTERS HOME')).toHaveLength(2);
    expect(index.rowsWithTag('nothing')).toEqual([]);
  });

  it('counts the tags it has seen, most used first', () => {
    const index = freshIndex();
    index.add(row(1), body({ tags: ['a', 'b'] }));
    index.add(row(2, { block: 200n }), body({ tags: ['a'] }));
    expect(index.tagsWithCounts()).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
    ]);
  });
});

describe('what the bodies say about each other', () => {
  it('files a reply against the post it answers', () => {
    const index = freshIndex();
    index.add(row(1), body());
    index.add(row(2, { author: B, block: 200n }), body({ meta: { re: tx(1) } }));

    const back = index.backlinksTo(tx(1));
    expect(back).toHaveLength(1);
    expect(back[0].kind).toBe('re');
    expect(back[0].post.txHash).toBe(tx(2));
    // …and the reply itself has nothing pointing at it.
    expect(index.backlinksTo(tx(2))).toEqual([]);
  });

  it('tells a reply, a continuation and a replacement apart', () => {
    const index = freshIndex();
    index.add(row(1), body());
    index.add(row(2, { block: 200n }), body({ meta: { re: tx(1) } }));
    index.add(row(3, { block: 300n }), body({ meta: { prev: tx(1) } }));
    index.add(row(4, { block: 400n }), body({ meta: { supersedes: tx(1) } }));
    expect(index.backlinksTo(tx(1)).map((b) => b.kind).sort()).toEqual(['prev', 're', 'supersedes']);
  });

  it('respects the event index: two posts in one transaction are two posts', () => {
    const index = freshIndex();
    index.add(row(1), body());
    index.add(row(2, { block: 200n }), body({ meta: { re: `${tx(1)}/1` } }));
    expect(index.backlinksTo(tx(1), 0)).toEqual([]);
    expect(index.backlinksTo(tx(1), 1)).toHaveLength(1);
  });

  it('gathers one author’s series in reading order', () => {
    const index = freshIndex();
    index.add(row(1, { block: 100n }), body({ meta: { series: 'Kitchen notes', part: '1' } }));
    index.add(row(3, { block: 300n }), body({ meta: { series: 'Kitchen notes', part: '3' } }));
    index.add(row(2, { block: 200n }), body({ meta: { series: 'kitchen NOTES', part: '2' } }));
    // Another author's series of the same name is a different series.
    index.add(row(9, { author: B, block: 400n }), body({ meta: { series: 'Kitchen notes', part: '1' } }));

    expect(index.seriesOf(A, 'Kitchen notes').map((p) => p.part)).toEqual([1, 2, 3]);
    expect(index.seriesOf(B, 'Kitchen notes')).toHaveLength(1);
  });

  it('ignores a relation that is not a reference at all', () => {
    const index = freshIndex();
    index.add(row(1), body({ meta: { re: 'the letter you sent me' } }));
    expect(index.backlinksTo(tx(1))).toEqual([]);
    expect(index.size()).toBe(1); // the post is still indexed, just not the relation
  });
});

describe('the index as a live thing', () => {
  it('tells whoever is watching that it has changed', () => {
    const index = freshIndex();
    const seen = vi.fn();
    index.subscribe(seen);
    index.add(row(1), body({ tags: ['a'] }));
    expect(seen).toHaveBeenCalled();
    expect(index.getVersion()).toBeGreaterThan(0);
  });

  it('files a body read before its row was known, and answers once it is', () => {
    localStorage.clear();
    const store = createScanStore(1);
    const index = createBodyIndex(1, { store });
    // A body fetched by hash alone — a deep link, before any list ran.
    index.add(null, { ...body({ tags: ['a'] }), txHash: tx(5) });
    expect(index.rowsWithTag('a')).toEqual([]); // nothing to show yet

    store.rememberPosts([row(5)]);
    // The row is resolved at read time, so it appears without re-indexing.
    expect(index.rowsWithTag('a').map((p) => p.txHash)).toEqual([tx(5)]);
  });
});
