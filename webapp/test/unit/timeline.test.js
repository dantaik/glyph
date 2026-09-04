import { describe, expect, it } from 'vitest';
import { compareMerged, countAbove, frontierOf, rowKey, splitAtFrontier, timeRows, walkBound } from '../../src/lib/timeline';

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

describe('timeline.timeRows — exact times are anchors', () => {
  it('clamps an estimate between the exact rows around it and never moves an exact row', () => {
    // Newest first. Block 800's estimate (8_000) sits below the exact 8_500 of
    // block 700, which was mined before it: it is lifted to 8_500.
    const out = timeRows([row(950, { ts: 9000 }), row(800), row(700, { ts: 8500 }), row(600)], 1, clock);
    expect(out.map((r) => [r.ts, r.tsExact])).toEqual([
      [9000, true],
      [8500, false],
      [8500, true],
      [6000, false],
    ]);
  });

  it('a low estimate above an exact row is lifted; the exact row is not lowered to it', () => {
    // Before, the exact 9_950 would have been clamped down to the estimate 9_900.
    const out = timeRows([row(990), row(980, { ts: 9950 })], 1, clock);
    expect(out.map((r) => [r.ts, r.tsExact])).toEqual([
      [9950, false],
      [9950, true],
    ]);
  });

  it('with no clock, rows without a time stay timeless and exact ones keep theirs', () => {
    const out = timeRows([row(990), row(980, { ts: 9950 }), row(970)], 1, null);
    expect(out.map((r) => r.ts)).toEqual([null, 9950, null]);
  });
});

describe('timeline.walkBound', () => {
  const snap = (extra = {}) => ({ hasMore: false, job: null, error: null, refreshedAt: 1, ...extra });
  const timed = (...ts) => ts.map((t) => ({ ts: t }));

  it('a walk that reached the author\'s first post knows everything', () => {
    expect(walkBound(snap({ hasMore: false }), timed(900, 500))).toBe(-Infinity);
  });

  it('a walk with more to read knows down to its oldest row', () => {
    expect(walkBound(snap({ hasMore: true }), timed(900, 500))).toBe(500);
  });

  it('an oldest row with no time yet bounds nothing', () => {
    expect(walkBound(snap({ hasMore: true }), [{ ts: 900 }, { ts: null }])).toBe(Infinity);
  });

  it('a walk still out, or failed, or never asked, bounds nothing', () => {
    expect(walkBound(snap({ job: 'refresh' }), [])).toBe(Infinity);
    expect(walkBound(snap({ error: new Error('down') }), [])).toBe(Infinity);
    expect(walkBound(snap({ refreshedAt: 0 }), [])).toBe(Infinity);
  });

  it('an author who has answered and written nothing is complete, not pending', () => {
    expect(walkBound(snap(), [])).toBe(-Infinity);
  });
});
