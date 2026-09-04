import { describe, expect, it } from 'vitest';
import { AUTHORS, fakeChain } from './helpers';
import { ioReader } from './mergedHelpers';

const [A, B] = AUTHORS;
const posts = [
  { author: A, index: 0, block: 100 },
  { author: B, index: 0, block: 250 },
  { author: A, index: 1, block: 400 },
  { author: A, index: 2, block: 900 },
];
const methods = (chain) => chain.calls.map((c) => c.method);

describe('reader caches', () => {
  it('findMetaByTx reads the receipt once and warms the (author, index) lookup', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    const hash = chain.hashOf(A, 1);
    const meta = await reader.findMetaByTx(hash, 0);
    expect(meta).toMatchObject({ author: A, index: 1n, block: 400n });
    expect(await reader.findMetaByTx(hash.toUpperCase(), 0)).toBe(meta); // case-insensitive, same object
    expect(await reader.findTitleMeta(A, 1)).toBe(meta); // no walk needed
    expect(await reader.findMetaByTx(hash, 1)).toBeNull(); // no second event in that tx
    expect(methods(chain)).toEqual(['eth_getTransactionReceipt']);
  });

  it('findTitleMeta refuses garbage indexes without I/O', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    expect(await reader.findTitleMeta(A, -1)).toBeNull();
    expect(await reader.findTitleMeta(A, Number.NaN)).toBeNull();
    expect(await reader.findTitleMeta(A, 1.5)).toBeNull();
    expect(chain.calls).toEqual([]);
  });

  it('findTitleMeta walks the chain once and answers from the cache after', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    const meta = await reader.findTitleMeta(A, 0);
    expect(meta).toMatchObject({ index: 0n, block: 100n });
    expect(methods(chain)).toEqual(['latestBlock', 'eth_getLogs:author', 'eth_getLogs:author', 'eth_getLogs:author']);
    expect(await reader.findTitleMeta(A, 0)).toBe(meta);
    // The walk remembered every block on the way: its posts need no I/O either.
    expect(await reader.findTitleMeta(A, 2)).toMatchObject({ block: 900n });
    expect(await reader.findMetaByTx(chain.hashOf(A, 1), 0)).toMatchObject({ block: 400n });
    expect(chain.calls).toHaveLength(4);
  });

  it('a lookup that failed is not remembered', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    let broken = true;
    const real = chain.io.postsInTx.bind(chain.io);
    chain.io.postsInTx = async (hash) => {
      if (broken) throw new Error('node down');
      return real(hash);
    };
    const reader = ioReader(1, chain.io);
    const hash = chain.hashOf(A, 2);
    await expect(reader.findMetaByTx(hash, 0)).rejects.toThrow(/node down/);
    broken = false;
    expect(await reader.findMetaByTx(hash, 0)).toMatchObject({ block: 900n });
  });

  it('blockTime answers from a stamped row without I/O, else reads the header once', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts, secondsPerBlock: 10, now: 20_000 });
    const reader = ioReader(1, chain.io);
    reader.store.rememberPosts([{ author: B, index: 5, block: 700, txHash: '0x77', ts: 12_345 }]);
    expect(await reader.blockTime(700n)).toBe(12_345);
    expect(chain.calls).toEqual([]);
    expect(await reader.blockTime(600n)).toBe(chain.tsOf(600n));
    expect(await reader.blockTime(600n)).toBe(chain.tsOf(600n));
    expect(methods(chain)).toEqual(['eth_getBlockByNumber']);
  });

  it('clock measures the pace over the last thousand blocks and is held for a while', async () => {
    const chain = fakeChain({ chainId: 1, head: 5000, posts, secondsPerBlock: 2, now: 1_800_000_000 });
    const reader = ioReader(1, chain.io);
    const clock = await reader.clock();
    expect(clock).toEqual({ block: 5000n, ts: 1_800_000_000, secondsPerBlock: 2 });
    expect(chain.calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['eth_getBlockByNumber', 'latest'],
      ['eth_getBlockByNumber', 4000n],
    ]);
    expect(await reader.clock()).toBe(clock);
    expect(chain.calls).toHaveLength(2);
  });

  it('count is shared between concurrent callers and held briefly', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    const [x, y] = await Promise.all([reader.count(A), reader.count(A.toLowerCase())]);
    expect(x).toBe(3n);
    expect(y).toBe(3n);
    expect(await reader.count(B)).toBe(1n);
    expect(methods(chain)).toEqual(['count', 'count']);
  });

  it('loadPostBody shares one read, forgets a failed one, and keeps a good one', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    let reads = 0;
    chain.io.postBody = async () => {
      reads += 1;
      if (reads === 1) throw new Error('calldata unavailable');
      return { tags: ['t'], markdown: 'body' };
    };
    const reader = ioReader(1, chain.io);
    const hash = chain.hashOf(A, 0);
    const both = await Promise.allSettled([reader.loadPostBody(hash), reader.loadPostBody(hash)]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(reads).toBe(1);
    expect(await reader.loadPostBody(hash)).toEqual({ body: { tags: ['t'], markdown: 'body' }, fromCache: false });
    expect(await reader.loadPostBody(hash)).toEqual({ body: { tags: ['t'], markdown: 'body' }, fromCache: false });
    expect(reads).toBe(2);
  });

  it('resolveImages rewrites what it can and leaves a failed image as it was', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const good = `0x${'aa'.repeat(32)}`;
    const bad = `0x${'bb'.repeat(32)}`;
    chain.io.imageBytes = async (hash) => {
      if (hash === bad) throw new Error('no such tx');
      return new Uint8Array([1, 2, 3]);
    };
    const reader = ioReader(1, chain.io);
    const md = `![one](eth:${good})\n\n![two](eth:${bad})`;
    const { markdown, urls } = await reader.resolveImages(md);
    expect(urls).toHaveLength(1);
    expect(markdown).toContain(`![one](${urls[0]})`);
    expect(markdown).toContain(`![two](eth:${bad})`);
    // The blob is shared: a second resolve mints a new URL from the same read.
    const again = await reader.resolveImages(md);
    expect(again.urls[0]).not.toBe(urls[0]);
  });

  it('ensName is asked once per address; a failure means no name', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    let asks = 0;
    chain.io.ensName = async () => {
      asks += 1;
      throw new Error('ens down');
    };
    const reader = ioReader(1, chain.io);
    expect(await reader.ensName(A)).toBeNull();
    expect(await reader.ensName(A.toLowerCase())).toBeNull();
    expect(asks).toBe(1);
  });
});

describe('loadPostText — the exact document, even for a body cached without it', () => {
  it('upgrades a record that predates the text being kept, once', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    const hash = chain.hashOf(A, 1);
    let reads = 0;
    chain.io.postBody = async () => {
      reads += 1;
      // The first read stands in for a record cached before `text` existed.
      return reads === 1
        ? { tags: ['t'], markdown: 'body' }
        : { tags: ['t'], markdown: 'body', text: '---\ntags: t\n---\n\nbody', compressedBytes: 20 };
    };

    expect((await reader.loadPostBody(hash)).body.text).toBeUndefined();
    const full = await reader.loadPostText(hash);
    expect(full.text).toBe('---\ntags: t\n---\n\nbody');
    expect(reads).toBe(2);

    // The upgrade sticks: nothing asks the node a third time, and whoever
    // loads the body next gets the record that carries the text.
    expect(await reader.loadPostText(hash)).toBe(full);
    expect((await reader.loadPostBody(hash)).body).toBe(full);
    expect(reads).toBe(2);
  });

  it('costs nothing extra when the body already carries its text', async () => {
    const chain = fakeChain({ chainId: 1, head: 1000, posts });
    const reader = ioReader(1, chain.io);
    let reads = 0;
    chain.io.postBody = async () => {
      reads += 1;
      return { tags: [], markdown: 'body', text: 'body', compressedBytes: 4 };
    };
    expect((await reader.loadPostText(chain.hashOf(A, 1))).text).toBe('body');
    expect(reads).toBe(1);
  });
});
