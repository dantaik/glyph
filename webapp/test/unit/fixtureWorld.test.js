import { describe, expect, it } from 'vitest';
import { AUTHORS, WORLDS, WORLD_CHAIN_IDS, buildWorld, buildWorlds, expectedMergedOrder, txOf } from '../../src/lib/fixtureWorld';
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
    expect(order).toHaveLength(20);
    // Newest first, with both chains interleaved rather than one after the other.
    for (let i = 1; i < order.length; i++) expect(order[i].ts).toBeLessThanOrEqual(order[i - 1].ts);
    const chains = order.slice(0, 6).map((p) => p.chainId);
    expect(new Set(chains).size).toBe(2);
    expect(expectedMergedOrder(worlds, { limit: 3 })).toHaveLength(3);
    const titles = new Set(order.map((p) => p.title));
    expect(titles.has('鼓声')).toBe(true);
    expect(titles.has('冬至前的一封信')).toBe(true);
  });

  it('keeps the single-chain QA hooks on Ethereum', () => {
    const eth = buildWorld(1, { now: NOW });
    const a0 = eth.byAuthor.get(AUTHORS[0].toLowerCase());
    expect(a0.map((p) => Number(p.index))).toEqual([0, 1, 2, 3, 4]);
    expect(a0[0].title).toBe('');
    expect(eth.posts.some((p) => p.title.endsWith('�'))).toBe(true);
    // The long article is referenced from another letter on the same chain.
    const ref = eth.bodyByTx.get(txOf(1, AUTHORS[1], 3n)).markdown;
    expect(ref).toContain(`](${txOf(1, AUTHORS[0], 2n)})`);
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
    expect(rows.map((r) => r.title)).toEqual(['给小满的短信', '半夜的雨', '渡口的晨雾', '鼓声']);
    expect(rows.every((r) => r.ts === io.world.tsOf(r.block))).toBe(true);
    expect((await io.block(29_000n)).timestamp).toBe(io.world.tsOf(29_000n));
    expect(await io.latestBlock(AUTHORS[3])).toBe(27_400n);
    expect(await io.count(AUTHORS[3])).toBe(3n);
    expect(await io.count(AUTHORS[2])).toBe(0n); // writes on Ethereum only
    const inBlock = await io.authorPostsInBlock(AUTHORS[0], 28_900n);
    expect(inBlock.map((r) => r.title)).toEqual(['鼓声']);
    const [byTx] = await io.postsInTx(inBlock[0].txHash);
    expect(byTx.title).toBe('鼓声');
    expect((await io.postBody(inBlock[0].txHash)).markdown).toContain('鼓楼');
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
