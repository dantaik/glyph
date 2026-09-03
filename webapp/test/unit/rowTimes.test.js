import { describe, expect, it, vi } from 'vitest';
import { makeRowTimeResolver } from '../../src/lib/rowTimes';
import { AUTHORS, memoryStore, until } from './helpers';

const [A] = AUTHORS;

/** A store holding legacy rows (no ts) in blocks 100, 200 (two rows) and 300. */
function seeded() {
  const store = memoryStore(7);
  store.rememberPosts([
    { author: A, index: 0, block: 100, txHash: '0x1', prevBlock: 0 },
    { author: A, index: 1, block: 200, txHash: '0x2', prevBlock: 100 },
    { author: A, index: 2, block: 200, txHash: '0x3', prevBlock: 200 },
    { author: A, index: 3, block: 300, txHash: '0x4', prevBlock: 200 },
  ]);
  return store;
}

function resolver(store, { fail = new Set(), limit = 3, deferred = false } = {}) {
  const calls = [];
  const pending = [];
  const blockTime = vi.fn((block) => {
    calls.push(String(block));
    if (fail.has(String(block))) return Promise.reject(new Error('header unavailable'));
    if (!deferred) return Promise.resolve(1000 + Number(block));
    return new Promise((resolve) => pending.push(() => resolve(1000 + Number(block))));
  });
  const persist = vi.fn();
  const r = makeRowTimeResolver({ blockTime, store, persist, limit });
  return { r, calls, persist, release: () => pending.shift()?.() };
}

const stamped = (store) => store.allPosts().every((row) => row.ts != null);

describe('rowTimes.makeRowTimeResolver', () => {
  it('reads each missing block once, stamps every row in it, persists per block', async () => {
    const store = seeded();
    const { r, calls, persist } = resolver(store);
    r.resolve(store.allPosts());
    await until(() => stamped(store));
    expect([...calls].sort()).toEqual(['100', '200', '300']);
    expect(persist).toHaveBeenCalledTimes(3);
    expect(store.allPosts().map((row) => [Number(row.block), row.ts])).toEqual([
      [300, 1300],
      [200, 1200],
      [200, 1200],
      [100, 1100],
    ]);
    expect(r.pending).toBe(0);
  });

  it('keeps at most `limit` blocks in flight', async () => {
    const store = seeded();
    const { r, calls, release } = resolver(store, { limit: 1, deferred: true });
    r.resolve(store.allPosts());
    expect(r.pending).toBe(1);
    await until(() => calls.length === 1);
    expect(r.pending).toBe(1);
    release();
    await until(() => calls.length === 2);
    expect(r.pending).toBe(1);
    release();
    await until(() => calls.length === 3);
    release();
    await until(() => stamped(store));
    expect(r.pending).toBe(0);
  });

  it('never asks again for a block already stamped, even from a stale row array', async () => {
    const store = seeded();
    const stale = store.allPosts(); // these objects are replaced when stamped
    const { r, calls } = resolver(store);
    r.resolve(stale);
    await until(() => stamped(store));
    r.resolve(stale);
    r.resolve(stale);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(3);
    expect(r.pending).toBe(0);
  });

  it('leaves a failed block alone until forget()', async () => {
    const store = seeded();
    const fail = new Set(['200']);
    const { r, calls } = resolver(store, { fail });
    r.resolve(store.allPosts());
    await until(() => r.pending === 0 && calls.length === 3);
    expect(store.knownBlockTs(200n)).toBeNull();
    r.resolve(store.allPosts());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.filter((b) => b === '200')).toHaveLength(1);
    fail.clear();
    r.forget();
    r.resolve(store.allPosts());
    await until(() => stamped(store));
    expect(calls.filter((b) => b === '200')).toHaveLength(2);
  });

  it('skips blocks whose time the store already knows', async () => {
    const store = seeded();
    store.rememberBlockTs(100n, 5);
    const { r, calls } = resolver(store);
    r.resolve(store.allPosts());
    await until(() => stamped(store));
    expect(calls).not.toContain('100');
    expect(store.knownBlockTs(100n)).toBe(5);
  });
});
