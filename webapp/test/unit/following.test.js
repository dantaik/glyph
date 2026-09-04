// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FOLLOWING_MAX,
  follow,
  getFollowing,
  getSeenTs,
  isFollowing,
  setFollowing,
  setSeenTs,
  unfollow,
} from '../../src/lib/following';

const A = '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

describe('following', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and keeps the order authors were added in', () => {
    expect(getFollowing()).toEqual([]);
    follow(A);
    follow(B);
    expect(getFollowing()).toEqual([A.toLowerCase(), B.toLowerCase()]);
  });

  it('is case-insensitive, and following twice is following once', () => {
    follow(A.toLowerCase());
    follow(A.toUpperCase().replace('0X', '0x'));
    expect(getFollowing()).toEqual([A.toLowerCase()]);
    expect(isFollowing(A)).toBe(true);
    expect(isFollowing(B)).toBe(false);
  });

  it('unfollow removes one and leaves the rest', () => {
    setFollowing([A, B]);
    unfollow(A);
    expect(getFollowing()).toEqual([B.toLowerCase()]);
    unfollow(B);
    expect(getFollowing()).toEqual([]);
    // The empty list clears the entry rather than storing "[]".
    expect(localStorage.getItem('glyph.following.v1')).toBeNull();
  });

  it('refuses anything that is not an address', () => {
    follow('not-an-address');
    follow('0x123');
    follow('');
    follow(null);
    expect(getFollowing()).toEqual([]);
  });

  it('a corrupted entry reads as an empty list, not a broken page', () => {
    localStorage.setItem('glyph.following.v1', '{oh no');
    expect(getFollowing()).toEqual([]);
    localStorage.setItem('glyph.following.v1', JSON.stringify({ addresses: 'nope' }));
    expect(getFollowing()).toEqual([]);
  });

  it('drops junk from a restored list and caps the length', () => {
    const many = Array.from({ length: FOLLOWING_MAX + 20 }, (_, i) =>
      `0x${String(i).padStart(40, '0')}`,
    );
    setFollowing([...many, 'rubbish', A, A]);
    const list = getFollowing();
    expect(list).toHaveLength(FOLLOWING_MAX);
    expect(list.every((a) => /^0x[0-9a-f]{40}$/.test(a))).toBe(true);
  });

  it('notifies listeners on every change', () => {
    let beats = 0;
    const onChange = () => { beats += 1; };
    window.addEventListener('glyph:following', onChange);
    follow(A);
    unfollow(A);
    setFollowing([B]);
    window.removeEventListener('glyph:following', onChange);
    expect(beats).toBe(3);
  });

  it('remembers how far the reader got, and never moves backwards', () => {
    expect(getSeenTs()).toBe(0);
    setSeenTs(1_700_000_000);
    expect(getSeenTs()).toBe(1_700_000_000);
    setSeenTs(1_600_000_000); // an older row scrolled into view: not a visit
    expect(getSeenTs()).toBe(1_700_000_000);
    setSeenTs(1_800_000_000.9);
    expect(getSeenTs()).toBe(1_800_000_000);
    setSeenTs(NaN);
    expect(getSeenTs()).toBe(1_800_000_000);
  });
});
