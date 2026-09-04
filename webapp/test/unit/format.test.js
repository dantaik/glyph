import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateBlockTime, fmtAbsTime, fmtRelTime, friendlyError, NODE_BEHIND_CODE } from '../../src/lib/format';
import { setLang } from '../../src/lib/i18n';

describe('format times', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-03T12:00:00Z') }));
  afterEach(() => {
    vi.useRealTimers();
    setLang('en');
  });

  it('estimateBlockTime projects from the chain clock at its measured pace', () => {
    const clock = { block: 1000n, ts: 1_756_900_000, secondsPerBlock: 2 };
    expect(estimateBlockTime(clock, 900n).getTime()).toBe((1_756_900_000 - 200) * 1000);
    expect(estimateBlockTime(null, 900n)).toBeNull();
    expect(estimateBlockTime(clock, null)).toBeNull();
  });

  it('fmtRelTime marks estimates as approximate and leaves exact times bare', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(fmtRelTime(threeDaysAgo)).toBe('about 3 days ago');
    expect(fmtRelTime(threeDaysAgo, { exact: true })).toBe('3 days ago');
    expect(fmtRelTime(new Date(Date.now() - 20_000))).toBe('just now');
    expect(fmtRelTime(null)).toBeNull();
    expect(fmtRelTime('garbage')).toBeNull();
  });

  it('fmtRelTime follows the chosen language', () => {
    setLang('zh');
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(fmtRelTime(threeDaysAgo)).toBe('约 3天前');
    expect(fmtRelTime(threeDaysAgo, { exact: true })).toBe('3天前');
    expect(fmtRelTime(new Date(Date.now() - 20_000))).toBe('刚刚');
  });

  it('fmtAbsTime renders seconds as a date and time in the chosen language', () => {
    const text = fmtAbsTime(1_756_900_000);
    expect(text).toMatch(/September 3, 2025/);
    expect(text).toMatch(/\d{2}:\d{2}/);
    expect(fmtAbsTime(null)).toBeNull();
    expect(fmtAbsTime('x')).toBeNull();

    setLang('zh');
    expect(fmtAbsTime(1_756_900_000)).toMatch(/2025年9月3日/);
  });
});

describe('friendlyError', () => {
  afterEach(() => setLang('en'));

  it('says a lagging node in the reader’s language, and maps the rest', () => {
    // The scanner reports this one as a code, so the sentence is built here
    // and follows the interface language rather than the scanner's.
    expect(friendlyError(`${NODE_BEHIND_CODE} 5`)).toMatch(/has not synced to block 5/);
    expect(friendlyError('HTTP 429 too many requests')).toMatch(/too frequent/);
    expect(friendlyError('fetch failed')).toMatch(/network connection/);
    expect(friendlyError('something odd')).toMatch(/unavailable right now/);

    setLang('zh');
    expect(friendlyError(`${NODE_BEHIND_CODE} 5`)).toBe('节点尚未同步到区块 5，稍后重试即可');
    expect(friendlyError('HTTP 429 too many requests')).toMatch(/过于频繁/);
    expect(friendlyError('fetch failed')).toMatch(/网络连接/);
    expect(friendlyError('something odd')).toMatch(/节点暂时不可用/);
  });
});
