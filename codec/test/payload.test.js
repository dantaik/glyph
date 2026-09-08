// payload.test.js — the brotli boundary and the version envelope.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import {
  FORMAT_VERSION,
  MalformedPayloadError,
  SUPPORTED_FORMAT_VERSIONS,
  UnsupportedFormatVersionError,
  VERSION_ENVELOPE_BYTE,
  decodePayload as decodeWith,
  detectFormatVersion,
  encodePayload as encodeWith,
} from '../src/index.js';
import { decodePayload, encodePayload, nodeBrotli } from '../src/node.js';

describe('the format version', () => {
  test('is 1, and 1 is the only version this library knows', () => {
    assert.equal(FORMAT_VERSION, 1);
    assert.deepEqual([...SUPPORTED_FORMAT_VERSIONS], [1]);
    assert.equal(VERSION_ENVELOPE_BYTE, 0x91);
  });

  test('an unmarked payload is version 1', () => {
    assert.equal(detectFormatVersion(encodePayload('x')), 1);
    assert.equal(detectFormatVersion(new Uint8Array([0x3b])), 1); // brotli of the empty document
  });

  test('an enveloped payload declares its version', () => {
    assert.equal(detectFormatVersion(new Uint8Array([0x91, 2, 0, 0])), 2);
    assert.equal(detectFormatVersion(new Uint8Array([0x91, 255])), 255);
    assert.equal(detectFormatVersion('0x9103'), 3);
  });

  test('an envelope that cannot be right is malformed, not a version', () => {
    assert.throws(() => detectFormatVersion(new Uint8Array(0)), (e) => e instanceof MalformedPayloadError && /empty/.test(e.message));
    assert.throws(() => detectFormatVersion(new Uint8Array([0x91])), (e) => e instanceof MalformedPayloadError && /no version byte/.test(e.message));
    assert.throws(() => detectFormatVersion(new Uint8Array([0x91, 0])), (e) => e instanceof MalformedPayloadError && e.version === 0);
    assert.throws(() => detectFormatVersion(new Uint8Array([0x91, 1])), (e) => e instanceof MalformedPayloadError && e.version === 1);
  });

  test('no brotli stream begins with the envelope byte, at any quality or window', () => {
    // RFC 7932 §9.1: the seven low bits of 0x91 are the one window-size code
    // that is invalid. A sample across inputs and parameters, as evidence.
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rand() * 400);
      const input = new Uint8Array(len);
      for (let j = 0; j < len; j++) input[j] = i % 2 ? Math.floor(rand() * 256) : 0x61 + (j % 7);
      for (const quality of [0, 1, 5, 9, 11]) {
        for (const lgwin of [10, 16, 22, 24]) {
          const out = brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: lgwin } });
          assert.notEqual(out[0], VERSION_ENVELOPE_BYTE);
          assert.notEqual(out[0] & 0x7f, VERSION_ENVELOPE_BYTE & 0x7f);
        }
      }
    }
  });

  test('a version-1 decoder refuses the envelope byte on the first byte', () => {
    assert.throws(() => nodeBrotli.decompress(new Uint8Array([0x91, 2, 0x0b, 0x00, 0x80])), (e) => e.code === 'ERR__ERROR_FORMAT_WINDOW_BITS');
  });
});

describe('encodePayload / decodePayload', () => {
  test('are brotli at quality 11 and back', () => {
    const text = '---\ntags: a, b\n---\n\n# Hello\n\nA body.\n';
    const bytes = encodePayload(text);
    assert.deepEqual(bytes, new Uint8Array(brotliCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })));
    assert.deepEqual(decodePayload(bytes), { version: 1, text });
    assert.deepEqual(decodePayload(`0x${Buffer.from(bytes).toString('hex')}`), { version: 1, text });
  });

  test('the empty document is one byte', () => {
    assert.deepEqual([...encodePayload('')], [0x3b]);
    assert.deepEqual(decodePayload(new Uint8Array([0x3b])), { version: 1, text: '' });
  });

  test('read a payload that is not quite UTF-8 with U+FFFD rather than refusing it', () => {
    const bytes = nodeBrotli.compress(new Uint8Array([0x41, 0xff, 0x42]));
    assert.equal(decodePayload(bytes).text, 'A�B');
  });

  test('keep a byte-order mark the document begins with', () => {
    const text = '﻿# Heading';
    assert.equal(decodePayload(encodePayload(text)).text, text);
  });

  test('refuse a version this library does not write or read', () => {
    assert.throws(() => encodePayload('x', { version: 2 }), (e) => e instanceof UnsupportedFormatVersionError && e.version === 2 && e.code === 'UNSUPPORTED_FORMAT_VERSION');
    assert.throws(() => decodePayload(new Uint8Array([0x91, 2, 1, 2, 3])), (e) => e instanceof UnsupportedFormatVersionError && e.version === 2 && e.supported[0] === 1);
  });

  test('refuse bytes that are not a brotli stream', () => {
    assert.throws(() => decodePayload(new Uint8Array([0xff, 0xff, 0xff])), (e) => e instanceof MalformedPayloadError && e.code === 'MALFORMED_PAYLOAD' && Boolean(e.cause));
    assert.throws(() => decodePayload(new Uint8Array(0)), MalformedPayloadError);
  });

  test('want a codec, and say where to get one', () => {
    assert.throws(() => encodeWith('x'), /brotli codec is required/);
    assert.throws(() => decodeWith(new Uint8Array([0x3b])), /brotli codec is required/);
    assert.throws(() => encodeWith('x', { brotli: { compress: 1 } }), TypeError);
  });

  test('take any codec with the two functions', () => {
    const identity = { compress: (b) => new Uint8Array([...b]), decompress: (b) => new Uint8Array([...b]) };
    assert.deepEqual(encodeWith('hi', { brotli: identity }), new Uint8Array([0x68, 0x69]));
    assert.deepEqual(decodeWith(new Uint8Array([0x68, 0x69]), { brotli: identity }), { version: 1, text: 'hi' });
  });
});
