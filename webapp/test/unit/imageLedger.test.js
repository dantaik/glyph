// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEDGER_MAX,
  clearImageLedger,
  knownImage,
  rememberImage,
  sha256Hex,
} from '../../src/lib/imageLedger';
import { nextImageKeys } from '../../src/lib/imageKeys';

const tx = (n) => `0x${String(n).padStart(64, '0')}`;

beforeEach(() => localStorage.clear());

describe('hashing the bytes that go on chain', () => {
  it('is the plain SHA-256 of them', async () => {
    // The published test vector for "abc".
    const hash = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('separates bytes that differ by one bit', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });
});

describe('the ledger of images already paid for', () => {
  it('answers with the transaction holding those bytes', async () => {
    const hash = await sha256Hex(new Uint8Array([9]));
    expect(knownImage(1, hash)).toBeNull();
    rememberImage(1, hash, tx(1));
    expect(knownImage(1, hash)).toBe(tx(1));
  });

  it('never offers one chain’s transaction to another', async () => {
    const hash = await sha256Hex(new Uint8Array([9]));
    rememberImage(1, hash, tx(1));
    // The same image on Taiko is a different transaction; pointing readers at
    // Ethereum's would give them a reference their node cannot resolve.
    expect(knownImage(167000, hash)).toBeNull();
    rememberImage(167000, hash, tx(2));
    expect(knownImage(167000, hash)).toBe(tx(2));
    expect(knownImage(1, hash)).toBe(tx(1));
  });

  it('keeps the newest entries when it fills up', () => {
    for (let i = 0; i <= LEDGER_MAX; i++) rememberImage(1, `hash${i}`, tx(i));
    expect(knownImage(1, 'hash0')).toBeNull();
    expect(knownImage(1, `hash${LEDGER_MAX}`)).toBe(tx(LEDGER_MAX));
  });

  it('treats a corrupted record as an empty one', () => {
    localStorage.setItem('glyph.images.v1', 'not json at all');
    expect(knownImage(1, 'anything')).toBeNull();
    rememberImage(1, 'hash', tx(3));
    expect(knownImage(1, 'hash')).toBe(tx(3));
  });

  it('can be forgotten, at the price of paying once more', () => {
    rememberImage(1, 'hash', tx(4));
    clearImageLedger();
    expect(knownImage(1, 'hash')).toBeNull();
  });
});

describe('naming attached images', () => {
  it('numbers from one, skipping what is taken', () => {
    expect(nextImageKeys({}, 2)).toEqual(['img1', 'img2']);
    expect(nextImageKeys({ img1: {}, img3: {} }, 2)).toEqual(['img2', 'img4']);
    expect(nextImageKeys({ img1: {} }, 0)).toEqual([]);
  });
});
