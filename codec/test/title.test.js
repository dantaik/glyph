// title.test.js — the bytes32 title.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPostError, TITLE_MAX_BYTES, decodeTitle, encodeTitle, fitTitle, titleByteLength, titleProblems } from '../src/index.js';

describe('encodeTitle', () => {
  test('is the UTF-8 bytes, right-padded with zeros to 32', () => {
    assert.equal(encodeTitle('AAAA'), `0x41414141${'00'.repeat(28)}`);
    assert.equal(encodeTitle(''), `0x${'00'.repeat(32)}`);
    assert.equal(encodeTitle('雪泥'), `0xe99baae6b3a5${'00'.repeat(26)}`);
  });

  test('fills the word exactly at 32 bytes', () => {
    assert.equal(encodeTitle('a'.repeat(32)), `0x${'61'.repeat(32)}`);
    assert.equal(encodeTitle('😀'.repeat(8)), `0x${'f09f9880'.repeat(8)}`);
  });

  test('refuses a title over 32 bytes rather than cutting it', () => {
    assert.throws(() => encodeTitle('a'.repeat(33)), (err) => err instanceof InvalidPostError && err.problems[0].code === 'TITLE_TOO_LONG');
    // Eleven Chinese characters is 33 bytes: one too many.
    assert.throws(() => encodeTitle('冬至前两天我上阁楼找腊'), /33 bytes/);
  });

  test('refuses a NUL inside, which the padding could not be told from', () => {
    assert.throws(() => encodeTitle(`a${String.fromCharCode(0)}b`), (err) => err.problems[0].code === 'TITLE_NUL');
  });

  test('refuses a lone surrogate, which TextEncoder would silently replace', () => {
    assert.throws(() => encodeTitle('bad \ud83d'), (err) => err.problems[0].code === 'MALFORMED_UNICODE');
  });

  test('refuses anything that is not a string', () => {
    assert.throws(() => encodeTitle(42), (err) => err.problems[0].code === 'TYPE');
  });
});

describe('decodeTitle', () => {
  test('inverts encodeTitle', () => {
    for (const title of ['', 'A letter before the solstice', '雪泥鸿爪', '😀'.repeat(8), 'a'.repeat(32), ' spaced ']) {
      assert.equal(decodeTitle(encodeTitle(title)), title);
    }
  });

  test('takes bytes or hex, either case', () => {
    const hex = encodeTitle('Hi');
    assert.equal(decodeTitle(hex.toUpperCase().replace('0X', '0x')), 'Hi');
    const bytes = new Uint8Array(32);
    bytes.set([0x48, 0x69]);
    assert.equal(decodeTitle(bytes), 'Hi');
  });

  test('reads a title a foreign writer cut mid-character, ending in U+FFFD', () => {
    // 31 bytes of a 33-byte title: the last character's third byte is gone.
    const bytes = new TextEncoder().encode('冬至前两天我上阁楼找腊').slice(0, 32);
    const padded = new Uint8Array(32);
    padded.set(bytes);
    assert.equal(decodeTitle(padded), '冬至前两天我上阁楼找�');
  });

  test('keeps a zero byte the title itself ends with out, and everything before it in', () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x41, 0x00, 0x42]); // "A", NUL, "B": only the padding after B is stripped
    assert.equal(decodeTitle(bytes), `A${String.fromCharCode(0)}B`);
  });

  test('refuses anything but 32 bytes', () => {
    assert.throws(() => decodeTitle('0x4141'), InvalidPostError);
    assert.throws(() => decodeTitle('not hex'), /Uint8Array or a 0x-prefixed hex/);
  });
});

describe('titleByteLength and fitTitle', () => {
  test('count UTF-8 bytes, not characters', () => {
    assert.equal(titleByteLength('abc'), 3);
    assert.equal(titleByteLength('雪泥'), 6);
    assert.equal(titleByteLength('😀'), 4);
    assert.equal(titleByteLength(undefined), 0);
  });

  test('fitTitle cuts to 32 bytes without splitting a character', () => {
    const long = '冬至前两天我上阁楼找腊';
    assert.equal(fitTitle(long), '冬至前两天我上阁楼找');
    assert.ok(titleByteLength(fitTitle(long)) <= TITLE_MAX_BYTES);
    assert.equal(fitTitle('A letter'), 'A letter');
    assert.equal(fitTitle('a'.repeat(40)), 'a'.repeat(32));
  });

  test('fitTitle keeps an emoji sequence whole', () => {
    // A family emoji is one grapheme of 25 bytes; two would be 50.
    const family = '👨‍👩‍👧‍👦';
    const fitted = fitTitle(family + family);
    assert.equal(fitted, family);
    assert.ok(titleByteLength(fitted) <= TITLE_MAX_BYTES);
    assert.equal(encodeTitle(fitted).length, 66); // still a valid title
  });

  test('titleProblems warns on an empty title without refusing it', () => {
    const problems = titleProblems('');
    assert.deepEqual(problems.map((p) => [p.level, p.code]), [['warning', 'TITLE_EMPTY']]);
    assert.equal(encodeTitle(''), `0x${'00'.repeat(32)}`);
  });
});
