import { describe, expect, it } from 'vitest';
import * as seg from '../../src/lib/segments';

describe('segments', () => {
  it('normalize sorts, clamps and merges overlapping or touching ranges', () => {
    expect(seg.normalize([[200, 300], [1, 100], [101, 150]])).toEqual([
      [1n, 150n],
      [200n, 300n],
    ]);
    expect(seg.normalize([[-5, 10]])).toEqual([[0n, 10n]]);
    expect(seg.normalize([[10, 5], ['x'], null, [7]])).toEqual([]);
    expect(seg.normalize([[1, 10], [5, 8]])).toEqual([[1n, 10n]]);
  });

  it('add folds one more range into coverage', () => {
    expect(seg.add([[1n, 10n]], 20n, 30n)).toEqual([[1n, 10n], [20n, 30n]]);
    expect(seg.add([[1n, 10n]], 11n, 30n)).toEqual([[1n, 30n]]);
  });

  it('segmentAt finds the containing range (inclusive)', () => {
    const cov = [[1n, 10n], [20n, 30n]];
    expect(seg.segmentAt(cov, 10)).toBe(cov[0]);
    expect(seg.segmentAt(cov, 20n)).toBe(cov[1]);
    expect(seg.segmentAt(cov, 15n)).toBeNull();
  });

  it('topBelow is the highest covered block strictly below', () => {
    const cov = [[1n, 10n], [20n, 30n]];
    expect(seg.topBelow(cov, 25n)).toBe(10n);
    expect(seg.topBelow(cov, 31n)).toBe(30n);
    expect(seg.topBelow(cov, 1n)).toBeNull();
  });

  it('lowest / highest / blockCount', () => {
    const cov = [[1n, 10n], [20n, 30n]];
    expect(seg.lowest(cov)).toBe(1n);
    expect(seg.highest(cov)).toBe(30n);
    expect(seg.blockCount(cov)).toBe(21n);
    expect(seg.lowest([])).toBeNull();
    expect(seg.highest([])).toBeNull();
  });

  it('clipBelow drops and trims claims under the floor', () => {
    expect(seg.clipBelow([[1n, 10n], [20n, 30n]], 25n)).toEqual([[25n, 30n]]);
    expect(seg.clipBelow([[1n, 10n]], 11n)).toEqual([]);
  });

  it('toPlain / fromPlain round-trip through JSON and drop garbage', () => {
    const cov = [[1n, 10n], [20n, 30n]];
    const json = JSON.stringify(seg.toPlain(cov));
    expect(seg.fromPlain(JSON.parse(json))).toEqual(cov);
    expect(seg.fromPlain('nope')).toEqual([]);
    expect(seg.fromPlain([[1, 'x'], [5, 6]])).toEqual([[5n, 6n]]);
  });
});
