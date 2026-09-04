import { describe, expect, it } from 'vitest';
import { baseFeeHistory, latestSample, lowestSample, sparklinePoints } from '../../src/lib/gasHistory';
import { fakeChain } from './helpers';
import { ioReader } from './mergedHelpers';

/**
 * A reader over a fake chain whose base fee varies with height, so the samples
 * can be told apart. The floor is dropped to zero: the real one is the
 * contract's deployment block, far above these test heights.
 */
function readerOver({ head = 100_000, secondsPerBlock = 12, baseFee, fail } = {}) {
  const chain = fakeChain({ chainId: 1, head, secondsPerBlock, baseFee, fail, posts: [] });
  chain.io.floor = 0n;
  return { chain, reader: ioReader(1, chain.io) };
}

const headerReads = (chain) => chain.calls.filter((c) => c.method === 'eth_getBlockByNumber').length;

describe('the last day of base fees, read from block headers', () => {
  it('samples an hour at a time, oldest first, at the chain’s own pace', async () => {
    const { chain, reader } = readerOver({ secondsPerBlock: 12 });
    const history = await baseFeeHistory(reader, { hours: 24, samples: 25 });

    expect(history).toHaveLength(25);
    // Oldest first, and each sample carries what it cost and when.
    const blocks = history.map((s) => s.block);
    expect([...blocks].sort((a, b) => (a < b ? -1 : 1))).toEqual(blocks);
    expect(history[history.length - 1].block).toBe(chain.head);
    expect(history.every((s) => typeof s.baseFeePerGas === 'bigint' && s.ts > 0)).toBe(true);
    // An hour of Ethereum is ~300 blocks, and the step follows from that.
    expect(Number(blocks[1] - blocks[0])).toBe(300);
  });

  it('follows a faster chain: an hour of Taiko is many more blocks', async () => {
    const { reader } = readerOver({ head: 500_000, secondsPerBlock: 2 });
    const history = await baseFeeHistory(reader, { hours: 24, samples: 25 });
    expect(Number(history[1].block - history[0].block)).toBe(1800);
  });

  it('drops a header the node will not serve rather than losing the day', async () => {
    const { reader } = readerOver({
      // One sample in the middle fails; the clock's own reads are left alone.
      fail: ({ method, args }) => method === 'eth_getBlockByNumber' && String(args[0]) === '97600',
    });
    const history = await baseFeeHistory(reader, { hours: 24, samples: 25 });
    expect(history).toHaveLength(24);
    expect(history.some((s) => s.block === 97_600n)).toBe(false);
  });

  it('never reads below the block the contract was deployed in', async () => {
    const chain = fakeChain({ chainId: 1, head: 1_000, posts: [] });
    chain.io.floor = 900n; // as if the contract were deployed here
    const reader = ioReader(1, chain.io);
    const history = await baseFeeHistory(reader, { hours: 24, samples: 25 });
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((s) => s.block >= 900n)).toBe(true);
  });

  it('is held for a while: asking twice reads the headers once', async () => {
    const { chain, reader } = readerOver();
    await reader.baseFees();
    const after = headerReads(chain);
    expect(after).toBeGreaterThan(20);
    await reader.baseFees();
    expect(headerReads(chain)).toBe(after);
  });
});

describe('reading the samples', () => {
  const samples = [
    { block: 1n, ts: 10, baseFeePerGas: 5n },
    { block: 2n, ts: 20, baseFeePerGas: 1n },
    { block: 3n, ts: 30, baseFeePerGas: 3n },
  ];

  it('finds the cheapest hour and the current one', () => {
    expect(lowestSample(samples).baseFeePerGas).toBe(1n);
    expect(latestSample(samples).baseFeePerGas).toBe(3n);
    expect(lowestSample([])).toBeNull();
    expect(latestSample([])).toBeNull();
  });

  it('draws the shape with the cheapest at the bottom', () => {
    const points = sparklinePoints(samples);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0, y: 1 }); // the most expensive
    expect(points[1]).toEqual({ x: 0.5, y: 0 }); // the cheapest
    expect(points[2].x).toBe(1);
  });

  it('draws a flat day as a flat line rather than dividing by zero', () => {
    const flat = [
      { block: 1n, ts: 1, baseFeePerGas: 7n },
      { block: 2n, ts: 2, baseFeePerGas: 7n },
    ];
    expect(sparklinePoints(flat).every((p) => p.y === 0.5)).toBe(true);
    expect(sparklinePoints([])).toEqual([]);
  });
});
