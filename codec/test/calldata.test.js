// calldata.test.js — publish(bytes32,bytes), checked against viem.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, parseAbi, toEventSelector, toFunctionSelector, toHex } from 'viem';
import {
  MalformedCallDataError,
  POST_EVENT_SIGNATURE,
  POST_EVENT_TOPIC,
  PUBLISH_SELECTOR,
  PUBLISH_SIGNATURE,
  decodePublishCallData,
  encodePublishCallData,
  encodeTitle,
  isPublishCallData,
} from '../src/index.js';

const abi = parseAbi(['function publish(bytes32 title, bytes payload) external']);
const TITLE = encodeTitle('A letter');

describe('the constants', () => {
  test('the selector is keccak256 of the signature, as viem computes it', () => {
    assert.equal(PUBLISH_SIGNATURE, 'publish(bytes32,bytes)');
    assert.equal(PUBLISH_SELECTOR, toFunctionSelector('function publish(bytes32 title, bytes payload)'));
    assert.equal(PUBLISH_SELECTOR, '0x70a74532');
  });

  test('the event topic is keccak256 of the event signature', () => {
    assert.equal(POST_EVENT_SIGNATURE, 'Post(address,uint256,uint256,bytes32)');
    assert.equal(POST_EVENT_TOPIC, toEventSelector('Post(address,uint256,uint256,bytes32)'));
  });
});

describe('encodePublishCallData', () => {
  test('lays the call out as selector, title, offset 0x40, length, payload, padding', () => {
    const data = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.equal(
      data,
      '0x70a74532' + TITLE.slice(2) + '00'.repeat(31) + '40' + '00'.repeat(31) + '03' + '010203' + '00'.repeat(29),
    );
  });

  test('is byte for byte what viem encodes, for payloads of every length', () => {
    for (const length of [0, 1, 31, 32, 33, 64, 65, 1000, 4097]) {
      const payload = new Uint8Array(length).map((_, i) => (i * 7 + 3) & 0xff);
      const expected = encodeFunctionData({ abi, functionName: 'publish', args: [TITLE, toHex(payload)] });
      assert.equal(encodePublishCallData({ title: TITLE, payload }), expected, `length ${length}`);
      assert.equal(encodePublishCallData({ title: TITLE, payload: toHex(payload) }), expected);
    }
  });

  test('takes the title as bytes too, and refuses anything but 32 of them', () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x41]);
    assert.equal(encodePublishCallData({ title: bytes, payload: new Uint8Array(0) }), encodePublishCallData({ title: encodeTitle('A'), payload: new Uint8Array(0) }));
    assert.throws(() => encodePublishCallData({ title: '0x41', payload: new Uint8Array(0) }), MalformedCallDataError);
  });
});

describe('decodePublishCallData', () => {
  test('inverts encodePublishCallData, and agrees with viem', () => {
    for (const length of [0, 1, 32, 33, 700]) {
      const payload = new Uint8Array(length).map((_, i) => (i * 13 + 1) & 0xff);
      const data = encodePublishCallData({ title: TITLE, payload });
      const mine = decodePublishCallData(data);
      const theirs = decodeFunctionData({ abi, data });
      assert.equal(mine.title, theirs.args[0]);
      assert.equal(toHex(mine.payload), theirs.args[1]);
      assert.deepEqual(mine.payload, payload);
      // Bytes in, the same out — and a plain Uint8Array out, even for a Buffer in.
      const fromBytes = decodePublishCallData(Buffer.from(data.slice(2), 'hex'));
      assert.deepEqual(fromBytes, mine);
      assert.equal(Object.getPrototypeOf(fromBytes.payload), Uint8Array.prototype);
    }
  });

  test('returns a copy of the payload, not a view into the calldata', () => {
    const data = Buffer.from(encodePublishCallData({ title: TITLE, payload: new Uint8Array([9, 9]) }).slice(2), 'hex');
    const { payload } = decodePublishCallData(new Uint8Array(data));
    payload[0] = 0;
    assert.equal(data[4 + 96], 9);
  });

  test('follows the offset rather than assuming it', () => {
    // The payload placed one word further out than canonical; still valid ABI.
    const payload = new Uint8Array([7, 8]);
    const hex = (n) => n.toString(16).padStart(64, '0');
    const data = PUBLISH_SELECTOR + TITLE.slice(2) + hex(0x60) + '00'.repeat(32) + hex(2) + '0708' + '00'.repeat(30);
    assert.deepEqual(decodePublishCallData(data), { title: TITLE, payload });
    assert.equal(decodeFunctionData({ abi, data }).args[1], '0x0708');
  });

  test('tolerates what every ABI decoder tolerates: trailing bytes, short padding', () => {
    const canonical = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(decodePublishCallData(`${canonical}ff`).payload, new Uint8Array([1, 2, 3]));
    assert.deepEqual(decodePublishCallData(canonical.slice(0, -40)).payload, new Uint8Array([1, 2, 3]));
  });

  test('refuses what is not a publish() call', () => {
    const canonical = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.throws(() => decodePublishCallData(`0xdeadbeef${canonical.slice(10)}`), (e) => e instanceof MalformedCallDataError && e.selector === '0xdeadbeef' && e.code === 'MALFORMED_CALLDATA');
    assert.throws(() => decodePublishCallData('0x'), /not a publish\(\) call/);
    assert.throws(() => decodePublishCallData('0x70a745'), /not a publish\(\) call/);
    assert.throws(() => decodePublishCallData(`${PUBLISH_SELECTOR}${'00'.repeat(40)}`), /too short/);
    assert.throws(() => decodePublishCallData('nonsense'), /Uint8Array or a 0x-prefixed hex/);
  });

  test('refuses an offset or a length that points outside the data', () => {
    const hex = (n) => n.toString(16).padStart(64, '0');
    const head = PUBLISH_SELECTOR + TITLE.slice(2);
    assert.throws(() => decodePublishCallData(head + hex(0x1000) + hex(0)), /offset points outside/);
    assert.throws(() => decodePublishCallData(head + hex(0x40) + hex(50) + '00'.repeat(32)), /cut short/);
    assert.throws(() => decodePublishCallData(head + hex(0x40) + 'ff'.repeat(32)), /not a plausible size/);
    assert.throws(() => decodePublishCallData(head + 'ff'.repeat(32) + hex(0)), /not a plausible size/);
  });

  test('isPublishCallData goes by the selector alone', () => {
    assert.equal(isPublishCallData(`${PUBLISH_SELECTOR}00`), true);
    assert.equal(isPublishCallData('0x70a745'), false);
    assert.equal(isPublishCallData('0xdeadbeef'), false);
    assert.equal(isPublishCallData('garbage'), false);
    assert.equal(isPublishCallData(new Uint8Array([0x70, 0xa7, 0x45, 0x32])), true);
  });
});
