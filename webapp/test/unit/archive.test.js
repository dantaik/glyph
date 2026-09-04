// @vitest-environment jsdom
//
// jsdom has no IndexedDB, so the cache falls back to memory — which is the
// same code path a browser that refuses the API takes, and enough to show
// that an imported bundle really does make posts readable without a node.
//
// That memory cache lives at module scope, so every case re-imports the
// whole graph: two tests sharing a cache would be two tests sharing a
// browser, and "has this been read before?" is the question under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORS } from '../../src/lib/fixtureWorld';
import { NOW } from './mergedHelpers';

let archive;
let base64;
let cache;
let GLYPH_ADDRESS;
let buildWorlds;
let createReader;
let createScanStore;
let createFixtureIO;
let createView;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  archive = await import('../../src/lib/archive');
  base64 = await import('../../src/lib/base64');
  cache = await import('../../src/lib/cache');
  ({ GLYPH_ADDRESS } = await import('../../src/lib/config'));
  ({ buildWorlds } = await import('../../src/lib/fixtureWorld'));
  ({ createReader } = await import('../../src/lib/reader'));
  ({ createScanStore } = await import('../../src/lib/scanStore'));
  ({ createFixtureIO } = await import('../../src/lib/fixtures'));
  ({ createView } = await import('../../src/lib/view'));
});

afterEach(() => localStorage.clear());

const [A0] = AUTHORS;

/**
 * A reader over the demo world whose reads DO reach the cache — the fixture
 * I/O is ephemeral by default, and an archive is exactly about what persists.
 */
function cachingReader(chainId, { tweak = null } = {}) {
  return createReader(chainId, {
    makeIO: (id) => {
      const io = createFixtureIO(id, '1', { now: NOW, delay: 0 });
      io.ephemeral = false;
      tweak?.(io);
      return io;
    },
    store: createScanStore(chainId),
  });
}

/** Read an author's rows into the store, the way visiting their page does. */
async function readAuthor(reader, author) {
  const list = reader.authorList(author);
  await list.refresh();
  while (list.getSnapshot().hasMore) await list.loadMore();
  return list.getSnapshot().rows;
}

describe('exporting what this browser has read', () => {
  it('writes the documented shape, with the exact stored text of every post', async () => {
    const reader = cachingReader(1);
    const rows = await readAuthor(reader, A0);
    expect(rows.length).toBeGreaterThan(1);

    const doc = await archive.collectBrowserArchive([reader]);
    expect(doc.glyph).toEqual({ archive: archive.ARCHIVE_FORMAT });
    expect(doc.contract).toBe(GLYPH_ADDRESS);
    expect(doc.scope).toEqual({ kind: 'browser' });
    expect(new Date(doc.exportedAt).toString()).not.toBe('Invalid Date');
    expect(doc.posts).toHaveLength(rows.length);

    const world = buildWorlds([1], { now: NOW }).get(1);
    const post = doc.posts[0];
    const source = world.metaByTx.get(post.txHash);
    expect(post).toMatchObject({
      chainId: 1,
      author: source.author.toLowerCase(),
      index: Number(source.index),
      block: Number(source.block),
      title: source.title,
    });
    // The exact document, front matter and all — not a re-rendering of it.
    const body = world.bodyByTx.get(post.txHash);
    expect(post.text).toContain(body.markdown.slice(0, 40));
    expect(typeof post.compressedBytes).toBe('number');
    // Plain JSON numbers throughout: no BigInt can survive a file.
    expect(JSON.parse(archive.serializeArchive(doc)).posts[0].block).toBe(Number(source.block));
  });

  it('reports progress as it reads, once per post', async () => {
    const reader = cachingReader(1);
    const rows = await readAuthor(reader, A0);
    const seen = [];
    await archive.collectBrowserArchive([reader], { onProgress: (p) => seen.push(p) });
    expect(seen).toHaveLength(rows.length);
    expect(seen[seen.length - 1]).toEqual({ done: rows.length, total: rows.length });
  });

  it('carries the images a post refers to, as base64', async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
    const imageTx = `0x${'cd'.repeat(32)}`;
    const reader = cachingReader(1, {
      tweak: (io) => {
        const realBody = io.postBody.bind(io);
        io.postBody = async (txHash) => {
          const body = await realBody(txHash);
          return { ...body, markdown: `![a](eth:${imageTx})\n\n${body.markdown}` };
        };
        io.imageBytes = async () => bytes;
      },
    });
    await readAuthor(reader, A0);
    const doc = await archive.collectBrowserArchive([reader]);
    expect(doc.images).toHaveLength(1); // one image, referenced many times
    expect(doc.images[0]).toMatchObject({ chainId: 1, txHash: imageTx, mime: 'image/webp' });
    expect([...base64.base64ToBytes(doc.images[0].base64)]).toEqual([...bytes]);
  });

  it('an image the node will not serve is left out, and the posts still are not', async () => {
    const reader = cachingReader(1, {
      tweak: (io) => {
        const realBody = io.postBody.bind(io);
        io.postBody = async (txHash) => {
          const body = await realBody(txHash);
          return { ...body, markdown: `![a](eth:0x${'ef'.repeat(32)})\n\n${body.markdown}` };
        };
        io.imageBytes = async () => {
          throw new Error('gone');
        };
      },
    });
    const rows = await readAuthor(reader, A0);
    const doc = await archive.collectBrowserArchive([reader]);
    expect(doc.images).toEqual([]);
    expect(doc.posts).toHaveLength(rows.length);
  });

  it('an author bundle walks them to their first post and says it is complete', async () => {
    const view = createView([cachingReader(1), cachingReader(167000)]);
    const doc = await archive.collectAuthorArchive(view, A0);
    expect(doc.scope).toEqual({ kind: 'author', address: A0.toLowerCase() });
    expect(doc.posts.every((p) => p.author === A0.toLowerCase())).toBe(true);
    expect(doc.authors.map((a) => a.complete)).toEqual([true, true]);

    const worlds = buildWorlds([1, 167000], { now: NOW });
    const expected = [...worlds.values()].reduce(
      (n, w) => n + (w.byAuthor.get(A0.toLowerCase()) ?? []).length,
      0,
    );
    expect(doc.posts).toHaveLength(expected);
    // Each chain's head is the newest block of that author on it.
    for (const entry of doc.authors) {
      const mine = doc.posts.filter((p) => p.chainId === entry.chainId);
      expect(entry.head).toBe(Math.max(...mine.map((p) => p.block)));
    }
  });

  it('names the file after the day, and after the author when there is one', () => {
    const day = new Date('2026-09-04T10:00:00Z');
    expect(archive.archiveFileName({ kind: 'browser' }, day)).toBe('glyph-archive-2026-09-04.xueni.json');
    expect(archive.archiveFileName({ kind: 'author', address: A0 }, day)).toMatch(
      /^glyph-archive-8a1f3b52-2026-09-04\.xueni\.json$/,
    );
  });
});

describe('reading a bundle back', () => {
  const doc = (body) => JSON.stringify({ glyph: { archive: 1 }, contract: GLYPH_ADDRESS, ...body });

  it('refuses a file that is not one of ours', () => {
    expect(archive.parseArchive('nonsense').problems[0]).toMatch(/valid JSON/);
    expect(archive.parseArchive('[1,2]').problems[0]).toMatch(/not an archive/);
    expect(archive.parseArchive('{"posts":[]}').problems[0]).toMatch(/not an archive/);
    expect(archive.parseArchive(JSON.stringify({ glyph: { archive: 2 } })).problems[0]).toMatch(/version 2/);
  });

  it('refuses a bundle from a different deployment of the contract', () => {
    const other = archive.parseArchive(
      JSON.stringify({ glyph: { archive: 1 }, contract: '0x1111111111111111111111111111111111111111', posts: [] }),
    );
    expect(other.doc).toBeNull();
    expect(other.problems[0]).toMatch(/different deployment/);
  });

  it('keeps the good rows and names what it dropped', () => {
    const good = {
      chainId: 1,
      txHash: `0x${'aa'.repeat(32)}`,
      eventIndex: 0,
      author: AUTHORS[0],
      index: 0,
      block: 100,
      prevBlock: 0,
      title: 'Hello',
      text: 'Hello.',
      compressedBytes: 10,
    };
    const { doc: parsed, problems, summary } = archive.parseArchive(
      doc({
        posts: [good, { ...good, txHash: 'nope' }, { ...good, chainId: 999 }],
        images: [
          { chainId: 1, txHash: `0x${'bb'.repeat(32)}`, mime: 'image/webp', base64: 'AAA=' },
          { chainId: 1, txHash: 'nope', base64: 'AAA=' },
        ],
        authors: [{ chainId: 1, address: AUTHORS[0], head: 100, complete: true }],
      }),
    );
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.images).toHaveLength(1);
    expect(problems).toEqual([
      'Ignoring 2 posts that are malformed or on an unknown chain.',
      'Ignoring 1 images that are malformed or on an unknown chain.',
    ]);
    expect(summary).toEqual(['Ethereum: 1 post, 1 image', '1 author, complete']);
  });

  it('a bundle with nothing in it says so', () => {
    expect(archive.parseArchive(doc({ posts: [] })).problems).toContain(
      'The file holds no posts that can be imported.',
    );
  });
});

describe('importing into a browser that has read nothing', () => {
  it('makes the posts readable, and the author\'s page complete', async () => {
    // One browser reads an author…
    const source = createView([cachingReader(1), cachingReader(167000)]);
    const bundle = await archive.collectAuthorArchive(source, A0);
    const text = archive.serializeArchive(bundle);

    // …and another browser, which has read nothing, takes the file. A second
    // browser means a second cache, so the module graph is reloaded.
    localStorage.clear();
    vi.resetModules();
    archive = await import('../../src/lib/archive');
    cache = await import('../../src/lib/cache');
    ({ createReader } = await import('../../src/lib/reader'));
    ({ createScanStore } = await import('../../src/lib/scanStore'));
    ({ createFixtureIO } = await import('../../src/lib/fixtures'));
    const fresh = [cachingReader(1), cachingReader(167000)];
    const { doc: parsed, problems } = archive.parseArchive(text);
    expect(problems).toEqual([]);
    const result = await archive.applyArchive(parsed, fresh);
    expect(result.posts).toBe(bundle.posts.length);
    expect(result.skipped).toBe(0);

    // Every row is in the store, and every body in the cache.
    const rows = fresh.flatMap((r) => r.store.allPosts());
    expect(rows).toHaveLength(bundle.posts.length);
    for (const post of bundle.posts) {
      const cached = await cache.getCachedBody(post.chainId, post.txHash);
      expect(cached.text).toBe(post.text);
    }
    // The author was walked to the end, so their head is claimed.
    for (const entry of bundle.authors) {
      const reader = fresh.find((r) => r.chainId === entry.chainId);
      expect(Number(reader.store.authorScanHead(A0))).toBe(entry.head);
    }
    // …and every row's own block is claimed for its own author.
    for (const post of bundle.posts) {
      const reader = fresh.find((r) => r.chainId === post.chainId);
      expect(reader.store.authorPostsInBlock(A0, BigInt(post.block))).not.toBeNull();
    }
  });

  it('never overwrites a record that is already here', async () => {
    const reader = cachingReader(1);
    await readAuthor(reader, A0);
    const bundle = await archive.collectBrowserArchive([reader]);
    const again = await archive.applyArchive(archive.parseArchive(archive.serializeArchive(bundle)).doc, [reader]);
    expect(again.posts).toBe(0);
    expect(again.skipped).toBe(bundle.posts.length);
  });

  it('writes the images, and a malformed one is skipped rather than fatal', async () => {
    const reader = cachingReader(1);
    const txA = `0x${'11'.repeat(32)}`;
    const txB = `0x${'22'.repeat(32)}`;
    const bytes = new Uint8Array([9, 8, 7]);
    const parsed = archive.parseArchive(
      JSON.stringify({
        glyph: { archive: 1 },
        contract: GLYPH_ADDRESS,
        posts: [
          {
            chainId: 1,
            txHash: `0x${'33'.repeat(32)}`,
            eventIndex: 0,
            author: AUTHORS[0],
            index: 0,
            block: 5,
            prevBlock: 0,
            title: 'x',
            text: '---\ntags: a\n---\n\nBody.',
            compressedBytes: 4,
          },
        ],
        images: [
          { chainId: 1, txHash: txA, mime: 'image/webp', base64: base64.bytesToBase64(bytes) },
          { chainId: 1, txHash: txB, mime: 'image/webp', base64: '!!not base64!!' },
        ],
        authors: [],
      }),
    ).doc;

    const result = await archive.applyArchive(parsed, [reader]);
    expect(result.images).toBe(1);
    const blob = await cache.getCachedImage(1, txA);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...bytes]);
    expect(await cache.getCachedImage(1, txB)).toBeNull();
    // The front matter is parsed back out, so tags and search cover it.
    expect((await cache.getCachedBody(1, `0x${'33'.repeat(32)}`)).tags).toEqual(['a']);
  });

  it('claims nothing about the feed: a bundle proves nothing about other authors', async () => {
    const source = createView([cachingReader(1)]);
    const bundle = await archive.collectAuthorArchive(source, A0);
    localStorage.clear();
    vi.resetModules();
    archive = await import('../../src/lib/archive');
    ({ createReader } = await import('../../src/lib/reader'));
    ({ createScanStore } = await import('../../src/lib/scanStore'));
    ({ createFixtureIO } = await import('../../src/lib/fixtures'));
    const fresh = cachingReader(1);
    await archive.applyArchive(archive.parseArchive(archive.serializeArchive(bundle)).doc, [fresh]);
    expect(fresh.store.feedCoverage()).toEqual([]);
    expect(fresh.store.feedScanHead()).toBeNull();
  });
});

describe('base64', () => {
  it('round-trips bytes, including a run longer than one chunk', () => {
    const big = new Uint8Array(0x8000 + 17).map((_, i) => i % 256);
    expect([...base64.base64ToBytes(base64.bytesToBase64(big))]).toEqual([...big]);
    expect(base64.bytesToBase64(new Uint8Array([]))).toBe('');
  });

  it('is not something to throw over', () => {
    expect(base64.base64ToBytes('!!!')).toBeNull();
    expect(base64.base64ToBytes(null)).toEqual(new Uint8Array(0));
  });
});
