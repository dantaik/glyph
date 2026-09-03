import { describe, expect, it } from 'vitest';
import { compareMerged, countAbove, frontierOf, rowKey, splitAtFrontier, timeRows } from '../../src/lib/timeline';

const clock = { block: 1000n, ts: 10_000, secondsPerBlock: 10 };
const row = (block, extra = {}) => ({ block: BigInt(block), logIndex: 0, txHash: `0x${block}`, eventIndex: 0, ts: null, ...extra });

describe('timeline.timeRows', () => {
  it('tags rows with the chain and keeps exact timestamps', () => {
    const out = timeRows([row(900, { ts: 5000 })], 167000, clock);
    expect(out[0]).toMatchObject({ chainId: 167000, ts: 5000, tsExact: true });
  });

  it('estimates from the clock when a row has no timestamp', () => {
    const out = timeRows([row(900)], 1, clock);
    expect(out[0]).toMatchObject({ ts: 9000, tsExact: false });
    expect(timeRows([row(900)], 1, null)[0].ts).toBeNull();
  });

  it('clamps an estimate so it never lands above the newer row before it', () => {
    // Newest first: an exact 8_500 row, then a legacy row the clock would put at 9_000.
    const out = timeRows([row(950, { ts: 8500 }), row(900)], 1, clock);
    expect(out[1].ts).toBe(8500);
    expect(out[1].tsExact).toBe(false);
  });
});

describe('timeline.compareMerged', () => {
  it('orders newest first, then chain, block, log index; unknown times last', () => {
    const rows = [
      { ts: 5, chainId: 167000, block: 10n, logIndex: 0 },
      { ts: 9, chainId: 1, block: 1n, logIndex: 0 },
      { ts: 5, chainId: 1, block: 20n, logIndex: 1 },
      { ts: 5, chainId: 1, block: 20n, logIndex: 4 },
      { ts: null, chainId: 1, block: 99n, logIndex: 0 },
      { ts: 5, chainId: 1, block: 30n, logIndex: 0 },
    ];
    const sorted = [...rows].sort(compareMerged);
    expect(sorted.map((r) => [r.ts, r.chainId, Number(r.block), r.logIndex])).toEqual([
      [9, 1, 1, 0],
      [5, 1, 30, 0],
      [5, 1, 20, 4],
      [5, 1, 20, 1],
      [5, 167000, 10, 0],
      [null, 1, 99, 0],
    ]);
  });
});

describe('timeline.frontierOf', () => {
  it('finds the newest bound and who sits at it', () => {
    expect(frontierOf([100, 300, 300])).toEqual({ tStar: 300, leaders: [1, 2] });
    expect(frontierOf([Infinity, 300])).toEqual({ tStar: Infinity, leaders: [0] });
    expect(frontierOf([-Infinity, -Infinity])).toEqual({ tStar: -Infinity, leaders: [] });
    expect(frontierOf([])).toEqual({ tStar: -Infinity, leaders: [] });
  });
});

describe('timeline.splitAtFrontier', () => {
  const rows = [{ ts: 50 }, { ts: 40 }, { ts: 30 }, { ts: 20 }];
  it('is the index of the last row at or above T*', () => {
    expect(splitAtFrontier(rows, 30)).toBe(2);
    expect(splitAtFrontier(rows, 35)).toBe(1);
    expect(splitAtFrontier(rows, Infinity)).toBe(-1);
    expect(splitAtFrontier(rows, -Infinity)).toBe(3);
    expect(splitAtFrontier([], 30)).toBe(-1);
    expect(countAbove(rows, 30)).toBe(3);
  });
});

describe('timeline.rowKey', () => {
  it('is unique per chain, transaction and event', () => {
    const a = rowKey({ chainId: 1, txHash: '0xAB', eventIndex: 0 });
    expect(a).toBe('1:0xab:0');
    expect(rowKey({ chainId: 167000, txHash: '0xab', eventIndex: 0 })).not.toBe(a);
    expect(rowKey({ chainId: 1, txHash: '0xab' })).toBe(a);
  });
});
