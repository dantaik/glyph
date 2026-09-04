// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatPostRef, parsePostRef } from '../../src/lib/glyphRefs';

const HASH = `0x${'ab'.repeat(32)}`;
const ETHEREUM = 1;
const TAIKO = 167000;

describe('reading a post reference', () => {
  it('takes a bare hash as this post’s own chain', () => {
    expect(parsePostRef(HASH, TAIKO)).toEqual({ chainId: TAIKO, txHash: HASH, eventIndex: 0 });
  });

  it('takes an event index when a transaction published more than one post', () => {
    expect(parsePostRef(`${HASH}/2`, ETHEREUM)).toEqual({ chainId: ETHEREUM, txHash: HASH, eventIndex: 2 });
  });

  it('takes a chain prefix, which is how a reference crosses chains', () => {
    expect(parsePostRef(`taiko:${HASH}`, ETHEREUM)).toEqual({ chainId: TAIKO, txHash: HASH, eventIndex: 0 });
    expect(parsePostRef(`ethereum:${HASH}/1`, TAIKO)).toEqual({ chainId: ETHEREUM, txHash: HASH, eventIndex: 1 });
  });

  it('takes a link copied from the address bar, which is what a reader has', () => {
    expect(parsePostRef(`https://xueni.xyz/taiko/tx/${HASH}/3`, ETHEREUM)).toEqual({
      chainId: TAIKO,
      txHash: HASH,
      eventIndex: 3,
    });
    expect(parsePostRef(`/ethereum/tx/${HASH}`, TAIKO)).toEqual({
      chainId: ETHEREUM,
      txHash: HASH,
      eventIndex: 0,
    });
  });

  it('lower-cases the hash, so the same post is the same reference', () => {
    expect(parsePostRef(HASH.toUpperCase().replace('0X', '0x'), ETHEREUM).txHash).toBe(HASH);
  });

  it('refuses what is not a reference', () => {
    expect(parsePostRef('', ETHEREUM)).toBeNull();
    expect(parsePostRef('0x1234', ETHEREUM)).toBeNull(); // too short to be a transaction
    expect(parsePostRef('just some words', ETHEREUM)).toBeNull();
    expect(parsePostRef(`nosuchchain:${HASH}`, ETHEREUM)).toBeNull();
    expect(parsePostRef(null, ETHEREUM)).toBeNull();
    // With no chain named and none to assume, there is nothing to point at.
    expect(parsePostRef(HASH, null)).toBeNull();
  });
});

describe('writing one', () => {
  it('leaves out what can be inferred', () => {
    expect(formatPostRef({ chainId: ETHEREUM, txHash: HASH, eventIndex: 0 }, ETHEREUM)).toBe(HASH);
  });

  it('names the chain when it differs, and the event when there is one', () => {
    expect(formatPostRef({ chainId: TAIKO, txHash: HASH, eventIndex: 0 }, ETHEREUM)).toBe(`taiko:${HASH}`);
    expect(formatPostRef({ chainId: ETHEREUM, txHash: HASH, eventIndex: 2 }, ETHEREUM)).toBe(`${HASH}/2`);
  });

  it('round trips', () => {
    for (const ref of [
      { chainId: ETHEREUM, txHash: HASH, eventIndex: 0 },
      { chainId: TAIKO, txHash: HASH, eventIndex: 4 },
    ]) {
      expect(parsePostRef(formatPostRef(ref, ETHEREUM), ETHEREUM)).toEqual(ref);
    }
  });
});
