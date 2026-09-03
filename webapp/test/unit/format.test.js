import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateBlockTime, fmtAbsTime, fmtRelTime } from '../../src/lib/format';

describe('format times', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-03T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('estimateBlockTime projects from the chain clock at its measured pace', () => {
    const clock = { block: 1000n, ts: 1_756_900_000, secondsPerBlock: 2 };
    expect(estimateBlockTime(clock, 900n).getTime()).toBe((1_756_900_000 - 200) * 1000);
    expect(estimateBlockTime(null, 900n)).toBeNull();
    expect(estimateBlockTime(clock, null)).toBeNull();
  });

  it('fmtRelTime is 约-prefixed for estimates and bare for exact times', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(fmtRelTime(threeDaysAgo)).toBe('约 3天前');
    expect(fmtRelTime(threeDaysAgo, { exact: true })).toBe('3天前');
    expect(fmtRelTime(new Date(Date.now() - 20_000))).toBe('刚刚');
    expect(fmtRelTime(null)).toBeNull();
    expect(fmtRelTime('garbage')).toBeNull();
  });

  it('fmtAbsTime renders seconds as a zh-CN date and time', () => {
    const text = fmtAbsTime(1_756_900_000);
    expect(text).toMatch(/2025年9月3日/);
    expect(text).toMatch(/\d{2}:\d{2}/);
    expect(fmtAbsTime(null)).toBeNull();
    expect(fmtAbsTime('x')).toBeNull();
  });
});
