import { describe, expect, it } from 'vitest';
import {
  AUTHORS,
  DEMO_RELAYER,
  DEMO_UNKNOWN_HOOK,
  WORLDS,
  WORLD_CHAIN_IDS,
  buildWorld,
  buildWorlds,
  expectedMergedOrder,
  txOf,
} from '../../src/lib/fixtureWorld';
import { DEFAULT_MULTI_HOOK_ADDRESS } from '../../src/lib/chains';
import { createFixtureIO } from '../../src/lib/fixtures';

const NOW = 1_800_000_000;

describe('fixtureWorld', () => {
  it('has a world per demo chain, each with posts', () => {
    expect(WORLD_CHAIN_IDS).toEqual([1, 167000]);
    for (const id of WORLD_CHAIN_IDS) {
      const world = buildWorld(id, { now: NOW });
      expect(world.posts.length).toBeGreaterThan(0);
      expect(world.head).toBe(WORLDS[id].head);
    }
  });

  it('links each author\'s posts through prevBlock in ascending blocks', () => {
    for (const id of WORLD_CHAIN_IDS) {
      const world = buildWorld(id, { now: NOW });
      for (const list of world.byAuthor.values()) {
        list.forEach((p, i) => {
          expect(p.index).toBe(BigInt(i));
          expect(p.prevBlock).toBe(i === 0 ? 0n : list[i - 1].block);
          if (i > 0) expect(p.block > list[i - 1].block).toBe(true);
        });
      }
    }
  });

  it('gives every post a distinct tx hash, across chains too', () => {
    const worlds = buildWorlds(WORLD_CHAIN_IDS, { now: NOW });
    const hashes = [...worlds.values()].flatMap((w) => w.posts.map((p) => p.txHash));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.every((h) => /^0x[0-9a-f]{64}$/.test(h))).toBe(true);
    // The same author's same index on the two chains are different transactions.
    expect(txOf(1, AUTHORS[0], 0)).not.toBe(txOf(167000, AUTHORS[0], 0));
  });

  it('times blocks at the chain\'s pace, the head at `now`', () => {
    const eth = buildWorld(1, { now: NOW });
    const taiko = buildWorld(167000, { now: NOW });
    expect(eth.tsOf(eth.head)).toBe(NOW);
    expect(eth.tsOf(eth.head - 10n)).toBe(NOW - 120);
    expect(taiko.tsOf(taiko.head - 10n)).toBe(NOW - 20);
    for (const w of [eth, taiko]) {
      for (let i = 1; i < w.posts.length; i++) expect(w.posts[i].ts).toBeGreaterThan(w.posts[i - 1].ts);
      for (const p of w.posts) expect(p.ts).toBe(w.tsOf(p.block));
    }
  });

  it('the two worlds overlap in time and differ in content', () => {
    const worlds = buildWorlds(WORLD_CHAIN_IDS, { now: NOW });
    const order = expectedMergedOrder(worlds);
    expect(order).toHaveLength(23);
    // Newest first, with both chains interleaved rather than one after the other.
    for (let i = 1; i < order.length; i++) expect(order[i].ts).toBeLessThanOrEqual(order[i - 1].ts);
    const chains = order.slice(0, 6).map((p) => p.chainId);
    expect(new Set(chains).size).toBe(2);
    expect(expectedMergedOrder(worlds, { limit: 3 })).toHaveLength(3);
    const titles = new Set(order.map((p) => p.title));
    expect(titles.has('The drums')).toBe(true);
    expect(titles.has('A letter before the solstice')).toBe(true);
  });

  it('keeps the single-chain QA hooks on Ethereum', () => {
    const eth = buildWorld(1, { now: NOW });
    const a0 = eth.byAuthor.get(AUTHORS[0].toLowerCase());
    expect(a0.map((p) => Number(p.index))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(a0[0].title).toBe('');
    expect(eth.posts.some((p) => p.title.endsWith('�'))).toBe(true);
    // The long article is referenced from another letter on the same chain.
    const ref = eth.bodyByTx.get(txOf(1, AUTHORS[1], 3n)).markdown;
    expect(ref).toContain(`](${txOf(1, AUTHORS[0], 2n)})`);
  });

  it('keeps the posts that took a route of their own', () => {
    const worlds = buildWorlds(WORLD_CHAIN_IDS, { now: NOW });
    const eth = worlds.get(1);
    const taiko = worlds.get(167000);
    // They sit in the author's one sequence, newest of it.
    const a0 = eth.byAuthor.get(AUTHORS[0].toLowerCase());
    const hooked = a0.find((p) => p.hook);
    expect([Number(hooked.index), Number(hooked.block)]).toEqual([4, 2560]);
    expect(hooked.hook).toBe(DEFAULT_MULTI_HOOK_ADDRESS.toLowerCase());
    const a1 = eth.byAuthor.get(AUTHORS[1].toLowerCase());
    const relayed = a1[a1.length - 1];
    expect(relayed.relayer).toBe(DEMO_RELAYER);
    expect(relayed.hook).toBeNull();
    const a3 = taiko.byAuthor.get(AUTHORS[3].toLowerCase());
    expect(a3[a3.length - 1].hook).toBe(DEMO_UNKNOWN_HOOK);
    expect(eth.posts.filter((p) => p.hook || p.relayer)).toHaveLength(2);
    expect(taiko.posts.filter((p) => p.hook || p.relayer)).toHaveLength(1);
  });

  it('the fixture I/O reads one list per author', async () => {
    const io = createFixtureIO(1, '1', { now: NOW, delay: 0 });
    expect(await io.latestBlock(AUTHORS[0])).toBe(2870n);
    expect(await io.count(AUTHORS[0])).toBe(6n);
    expect(await io.count(AUTHORS[3])).toBe(0n); // writes on Taiko only
    expect(await io.latestBlock(AUTHORS[3])).toBe(0n);
    const rows = await io.authorPostsInBlock(AUTHORS[0], 2560n);
    expect(rows.map((r) => [Number(r.index), r.hook])).toEqual([[4, DEFAULT_MULTI_HOOK_ADDRESS.toLowerCase()]]);
    expect(rows[0].relayer).toBeUndefined();
    const relayed = await io.postBody(txOf(1, AUTHORS[1], 4n));
    expect(relayed.form).toBe('publishFor');
    expect(relayed.relayed.author).toBe(AUTHORS[1].toLowerCase());
    expect(relayed.sender).toBe(DEMO_RELAYER);
    const hooked = await io.postBody(txOf(1, AUTHORS[0], 4n));
    expect(hooked.form).toBe('publishWithHook');
    expect(hooked.hookData).toBe('0xc0ffee');
    expect(hooked.relayed).toBeNull();
    const plain = await io.postBody(txOf(1, AUTHORS[0], 0n));
    expect([plain.form, plain.hook, plain.relayed]).toEqual(['publish', null, null]);
  });

  it('scale stretches blocks without moving the clock', () => {
    const plain = buildWorld(167000, { now: NOW });
    const wide = buildWorld(167000, { now: NOW, scale: 10 });
    expect(wide.head).toBe(plain.head * 10n);
    expect(wide.scanBlocks).toBe(plain.scanBlocks * 10n);
    expect(wide.posts.map((p) => p.ts)).toEqual(plain.posts.map((p) => p.ts));
    expect(wide.posts[0].block).toBe(plain.posts[0].block * 10n);
  });

  it('a Taiko sweep budget leaves its older posts unscanned on the first pass', () => {
    const taiko = buildWorld(167000, { now: NOW });
    const firstSweepFloor = taiko.head - taiko.scanBlocks;
    const older = taiko.posts.filter((p) => p.block < firstSweepFloor);
    expect(older.length).toBeGreaterThan(0);
    expect(taiko.posts.length - older.length).toBeGreaterThan(0);
  });
});

describe('createFixtureIO', () => {
  it('serves the world through the reader\'s I/O surface, stamped', async () => {
    const io = createFixtureIO(167000, '1', { now: NOW, delay: 0 });
    expect(io.chainId).toBe(167000);
    expect(io.scanBlocks).toBe(12_000n);
    expect(await io.blockNumber()).toBe(30_000n);
    const { rows, to } = await io.postsInRange(20_000n, 30_000n);
    expect(to).toBe(30_000n);
    expect(rows.map((r) => r.title)).toEqual([
      'A short note to Xiaoman',
      'Rain at midnight',
      'Morning fog at the crossing',
      'The drums',
      'The crossing, indexed',
    ]);
    expect(rows.every((r) => r.ts === io.world.tsOf(r.block))).toBe(true);
    expect((await io.block(29_000n)).timestamp).toBe(io.world.tsOf(29_000n));
    expect(await io.latestBlock(AUTHORS[3])).toBe(29_600n);
    expect(await io.count(AUTHORS[3])).toBe(4n);
    expect(await io.count(AUTHORS[2])).toBe(0n); // writes on Ethereum only
    const inBlock = await io.authorPostsInBlock(AUTHORS[0], 28_900n);
    expect(inBlock.map((r) => r.title)).toEqual(['The drums']);
    const [byTx] = await io.postsInTx(inBlock[0].txHash);
    expect(byTx.title).toBe('The drums');
    expect((await io.postBody(inBlock[0].txHash)).markdown).toContain('drum tower');
  });

  it('legacyRows hands out rows without timestamps', async () => {
    const io = createFixtureIO(1, '1', { now: NOW, delay: 0, legacyRows: true });
    const { rows } = await io.postsInRange(0n, 3000n);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ts === null)).toBe(true);
  });

  it('empty mode has no posts on either chain', async () => {
    const io = createFixtureIO(1, 'empty', { now: NOW, delay: 0 });
    expect((await io.postsInRange(0n, 3000n)).rows).toEqual([]);
    expect(await io.latestBlock(AUTHORS[0])).toBe(0n);
  });
});
