// @vitest-environment jsdom
//
// jsdom has no IndexedDB — the same situation as a page opened from disk in
// a browser that refuses the API — so this exercises the in-memory fallback.
import { describe, expect, it } from 'vitest';
import { MEMORY_MAX, cachePersists, getCachedBody, getCachedImage, setCachedBody, setCachedImage } from '../../src/lib/cache';

const tx = (n) => `0x${String(n).padStart(64, '0')}`;

describe('cache without IndexedDB', () => {
  it('reports that nothing persists, and serves what was written this session', async () => {
    expect(await cachePersists()).toBe(false);
    const body = { tags: ['a'], markdown: '# hi' };
    await setCachedBody(1, tx(1), body);
    expect(await getCachedBody(1, tx(1))).toEqual(body);
    expect(await getCachedBody(1, tx(1).toUpperCase())).toEqual(body); // hashes are case-insensitive
    expect(await getCachedBody(167000, tx(1))).toBeNull(); // scoped to the chain
    expect(await getCachedBody(1, tx(2))).toBeNull();
  });

  it('hands images back as webp blobs', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await setCachedImage(167000, tx(9), bytes.buffer);
    const blob = await getCachedImage(167000, tx(9));
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBe(4);
    expect(await getCachedImage(1, tx(9))).toBeNull();
  });

  it('keeps the session cache bounded, dropping the least recently written', async () => {
    for (let i = 0; i <= MEMORY_MAX; i++) await setCachedBody(1, tx(1000 + i), { tags: [], markdown: String(i) });
    expect(await getCachedBody(1, tx(1000))).toBeNull();
    expect(await getCachedBody(1, tx(1000 + MEMORY_MAX))).toEqual({ tags: [], markdown: String(MEMORY_MAX) });
  });
});
