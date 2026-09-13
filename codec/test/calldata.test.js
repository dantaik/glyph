// calldata.test.js — the three call forms, checked against viem.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, parseAbi, toEventSelector, toFunctionSelector, toHex } from 'viem';
import {
  CALL_FORMS,
  MalformedCallDataError,
  POST_EVENT_SIGNATURE,
  POST_EVENT_TOPIC,
  POST_V2_EVENT_SIGNATURE,
  POST_V2_EVENT_TOPIC,
  PUBLISH_FOR_SELECTOR,
  PUBLISH_FOR_SIGNATURE,
  PUBLISH_SELECTOR,
  PUBLISH_SIGNATURE,
  PUBLISH_WITH_HOOK_SELECTOR,
  PUBLISH_WITH_HOOK_SIGNATURE,
  ZERO_ADDRESS,
  bytesToHex,
  callDataForm,
  decodePublishCallData,
  encodePublishCallData,
  encodePublishForCallData,
  encodeTitle,
  isPublishCallData,
} from '../src/index.js';

const abi = parseAbi([
  'function publish(bytes32 title, bytes payload) external',
  'function publish(bytes32 title, bytes payload, address hook, bytes hookData) external payable',
  'function publishFor(address author, bytes32 title, bytes payload, address hook, bytes hookData, uint256 deadline, bytes signature) external payable',
]);
const TITLE = encodeTitle('A letter');
const HOOK = '0x00000000000000000000000000000000000000AB';
// Lowercase: viem refuses a mixed-case address whose checksum is wrong, and
// the codec takes either case.
const AUTHOR = '0x8a1f3b52c9e44e1a9b1f0d2c7a44e0b1d2e3f4a5';
const SIG = new Uint8Array(65).map((_, i) => (i * 5 + 1) & 0xff);
const bytesOf = (length, seed) => new Uint8Array(length).map((_, i) => (i * seed + 3) & 0xff);
const EMPTY = new Uint8Array(0);

describe('the constants', () => {
  test('each selector is keccak256 of its signature, as viem computes it', () => {
    assert.equal(PUBLISH_SIGNATURE, 'publish(bytes32,bytes)');
    assert.equal(PUBLISH_SELECTOR, toFunctionSelector('function publish(bytes32 title, bytes payload)'));
    assert.equal(PUBLISH_SELECTOR, '0x70a74532');
    assert.equal(PUBLISH_WITH_HOOK_SIGNATURE, 'publish(bytes32,bytes,address,bytes)');
    assert.equal(PUBLISH_WITH_HOOK_SELECTOR, toFunctionSelector(`function ${PUBLISH_WITH_HOOK_SIGNATURE}`));
    assert.equal(PUBLISH_FOR_SIGNATURE, 'publishFor(address,bytes32,bytes,address,bytes,uint256,bytes)');
    assert.equal(PUBLISH_FOR_SELECTOR, toFunctionSelector(`function ${PUBLISH_FOR_SIGNATURE}`));
    assert.deepEqual(
      Object.values(CALL_FORMS).map((f) => [f.form, f.selector]),
      [['publish', PUBLISH_SELECTOR], ['publishWithHook', PUBLISH_WITH_HOOK_SELECTOR], ['publishFor', PUBLISH_FOR_SELECTOR]],
    );
  });

  test('the event topics are keccak256 of the event signatures', () => {
    assert.equal(POST_EVENT_SIGNATURE, 'Post(address,uint256,uint256,bytes32)');
    assert.equal(POST_EVENT_TOPIC, toEventSelector(POST_EVENT_SIGNATURE));
    assert.equal(POST_V2_EVENT_SIGNATURE, 'Post(address,address,uint256,uint256,bytes32)');
    assert.equal(POST_V2_EVENT_TOPIC, toEventSelector(POST_V2_EVENT_SIGNATURE));
    assert.equal(ZERO_ADDRESS, `0x${'00'.repeat(20)}`);
  });
});

describe('encodePublishCallData', () => {
  test('lays the plain call out as selector, title, offset 0x40, length, payload, padding', () => {
    const data = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.equal(
      data,
      '0x70a74532' + TITLE.slice(2) + '00'.repeat(31) + '40' + '00'.repeat(31) + '03' + '010203' + '00'.repeat(29),
    );
  });

  test('is byte for byte what viem encodes, for payloads of every length', () => {
    for (const length of [0, 1, 31, 32, 33, 64, 65, 1000, 4097]) {
      const payload = bytesOf(length, 7);
      const expected = encodeFunctionData({ abi, functionName: 'publish', args: [TITLE, toHex(payload)] });
      assert.equal(encodePublishCallData({ title: TITLE, payload }), expected, `length ${length}`);
      assert.equal(encodePublishCallData({ title: TITLE, payload: toHex(payload) }), expected);
    }
  });

  test('a hook, or data for one, makes it the four-argument call — as viem encodes it', () => {
    for (const [pl, hd] of [[0, 0], [1, 1], [33, 0], [0, 33], [700, 65], [32, 32]]) {
      const payload = bytesOf(pl, 7);
      const hookData = bytesOf(hd, 11);
      const expected = encodeFunctionData({
        abi,
        functionName: 'publish',
        args: [TITLE, toHex(payload), HOOK, toHex(hookData)],
      });
      assert.equal(encodePublishCallData({ title: TITLE, payload, hook: HOOK, hookData }), expected, `${pl}/${hd}`);
      assert.equal(encodePublishCallData({ title: TITLE, payload, hook: HOOK, hookData: toHex(hookData) }), expected);
    }
    // Data with no hook still needs the four-argument form (the zero address).
    const data = encodePublishCallData({ title: TITLE, payload: EMPTY, hookData: new Uint8Array([9]) });
    assert.equal(data, encodeFunctionData({ abi, functionName: 'publish', args: [TITLE, '0x', ZERO_ADDRESS, '0x09'] }));
    // A zero hook and no data is the plain form: the cheaper call, and v1's.
    assert.equal(encodePublishCallData({ title: TITLE, payload: EMPTY, hook: ZERO_ADDRESS, hookData: EMPTY }), encodePublishCallData({ title: TITLE, payload: EMPTY }));
    assert.equal(encodePublishCallData({ title: TITLE, payload: EMPTY, hook: null, hookData: null }), encodePublishCallData({ title: TITLE, payload: EMPTY }));
  });

  test('takes the title as bytes too, and refuses anything but 32 of them', () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x41]);
    assert.equal(encodePublishCallData({ title: bytes, payload: EMPTY }), encodePublishCallData({ title: encodeTitle('A'), payload: EMPTY }));
    assert.throws(() => encodePublishCallData({ title: '0x41', payload: EMPTY }), MalformedCallDataError);
  });

  test('refuses a hook that is not an address', () => {
    assert.throws(() => encodePublishCallData({ title: TITLE, payload: EMPTY, hook: '0x1234' }), /hook must be an address/);
    assert.throws(() => encodePublishCallData({ title: TITLE, payload: EMPTY, hook: 42 }), MalformedCallDataError);
  });
});

describe('encodePublishForCallData', () => {
  test('is byte for byte what viem encodes, whatever the lengths', () => {
    for (const [pl, hd, hook] of [[0, 0, null], [33, 0, HOOK], [1, 65, HOOK], [700, 32, null]]) {
      const payload = bytesOf(pl, 7);
      const hookData = bytesOf(hd, 11);
      const expected = encodeFunctionData({
        abi,
        functionName: 'publishFor',
        args: [AUTHOR, TITLE, toHex(payload), hook ?? ZERO_ADDRESS, toHex(hookData), 1_800_000_000n, toHex(SIG)],
      });
      const mine = encodePublishForCallData({ author: AUTHOR, title: TITLE, payload, hook, hookData, deadline: 1_800_000_000, signature: SIG });
      assert.equal(mine, expected, `${pl}/${hd}`);
      assert.equal(mine.slice(0, 10), PUBLISH_FOR_SELECTOR);
      // The deadline as a bigint or a decimal string encodes the same.
      assert.equal(encodePublishForCallData({ author: AUTHOR, title: TITLE, payload, hook, hookData, deadline: 1_800_000_000n, signature: toHex(SIG) }), expected);
      assert.equal(encodePublishForCallData({ author: AUTHOR, title: TITLE, payload, hook, hookData, deadline: '1800000000', signature: SIG }), expected);
    }
  });

  test('a deadline fills the whole word', () => {
    const max = (1n << 256n) - 1n;
    const data = encodePublishForCallData({ author: AUTHOR, title: TITLE, payload: EMPTY, deadline: max, signature: SIG });
    assert.equal(decodePublishCallData(data).relayed.deadline, max.toString());
    assert.throws(() => encodePublishForCallData({ author: AUTHOR, title: TITLE, payload: EMPTY, deadline: max + 1n, signature: SIG }), /too large for a word/);
    assert.throws(() => encodePublishForCallData({ author: AUTHOR, title: TITLE, payload: EMPTY, deadline: -1, signature: SIG }), /negative/);
  });

  test('refuses an author that is not an address', () => {
    assert.throws(() => encodePublishForCallData({ author: 'xiaoman.eth', title: TITLE, payload: EMPTY, deadline: 1, signature: SIG }), /author must be an address/);
    assert.throws(() => encodePublishForCallData({ title: TITLE, payload: EMPTY, deadline: 1, signature: SIG }), MalformedCallDataError);
  });
});

describe('decodePublishCallData', () => {
  test('inverts encodePublishCallData, and agrees with viem', () => {
    for (const length of [0, 1, 32, 33, 700]) {
      const payload = bytesOf(length, 13);
      const data = encodePublishCallData({ title: TITLE, payload });
      const mine = decodePublishCallData(data);
      const theirs = decodeFunctionData({ abi, data });
      assert.equal(mine.title, theirs.args[0]);
      assert.equal(toHex(mine.payload), theirs.args[1]);
      assert.deepEqual(mine, { form: 'publish', title: TITLE, payload, hook: null, hookData: EMPTY, relayed: null });
      // Bytes in, the same out — and a plain Uint8Array out, even for a Buffer in.
      const fromBytes = decodePublishCallData(Buffer.from(data.slice(2), 'hex'));
      assert.deepEqual(fromBytes, mine);
      assert.equal(Object.getPrototypeOf(fromBytes.payload), Uint8Array.prototype);
    }
  });

  test('decodes a post through a hook: the address lowercase, the data as bytes', () => {
    const payload = bytesOf(50, 3);
    const hookData = bytesOf(40, 5);
    const data = encodePublishCallData({ title: TITLE, payload, hook: HOOK, hookData });
    assert.deepEqual(decodePublishCallData(data), {
      form: 'publishWithHook',
      title: TITLE,
      payload,
      hook: HOOK.toLowerCase(),
      hookData,
      relayed: null,
    });
    const theirs = decodeFunctionData({ abi, data });
    assert.equal(theirs.args[2].toLowerCase(), HOOK.toLowerCase());
    assert.equal(theirs.args[3], toHex(hookData));
    // The zero hook reads as no hook, whatever the data says.
    const zero = encodePublishCallData({ title: TITLE, payload, hookData: new Uint8Array([1]) });
    assert.equal(decodePublishCallData(zero).form, 'publishWithHook');
    assert.equal(decodePublishCallData(zero).hook, null);
    assert.deepEqual(decodePublishCallData(zero).hookData, new Uint8Array([1]));
  });

  test('decodes a relayed post: the author, the deadline as a decimal string, the signature', () => {
    const payload = bytesOf(50, 3);
    const data = encodePublishForCallData({ author: AUTHOR, title: TITLE, payload, hook: HOOK, hookData: new Uint8Array([7]), deadline: 1_800_000_000, signature: SIG });
    const mine = decodePublishCallData(data);
    assert.deepEqual(mine, {
      form: 'publishFor',
      title: TITLE,
      payload,
      hook: HOOK.toLowerCase(),
      hookData: new Uint8Array([7]),
      relayed: { author: AUTHOR.toLowerCase(), deadline: '1800000000', signature: SIG },
    });
    const theirs = decodeFunctionData({ abi, data });
    assert.equal(theirs.args[0].toLowerCase(), AUTHOR.toLowerCase());
    assert.equal(theirs.args[5], 1_800_000_000n);
    assert.equal(theirs.args[6], toHex(SIG));
    // Without a hook.
    const plain = decodePublishCallData(encodePublishForCallData({ author: AUTHOR, title: TITLE, payload, deadline: 5, signature: SIG }));
    assert.equal(plain.hook, null);
    assert.deepEqual(plain.hookData, EMPTY);
    assert.equal(plain.relayed.deadline, '5');
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
    assert.deepEqual(decodePublishCallData(data), { form: 'publish', title: TITLE, payload, hook: null, hookData: EMPTY, relayed: null });
    assert.equal(decodeFunctionData({ abi, data }).args[1], '0x0708');
  });

  test('tolerates what every ABI decoder tolerates: trailing bytes, short padding', () => {
    const canonical = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(decodePublishCallData(`${canonical}ff`).payload, new Uint8Array([1, 2, 3]));
    assert.deepEqual(decodePublishCallData(canonical.slice(0, -40)).payload, new Uint8Array([1, 2, 3]));
    const hooked = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]), hook: HOOK, hookData: new Uint8Array([4]) });
    assert.deepEqual(decodePublishCallData(hooked.slice(0, -40)).hookData, new Uint8Array([4]));
  });

  test('refuses what is not a publish() call', () => {
    const canonical = encodePublishCallData({ title: TITLE, payload: new Uint8Array([1, 2, 3]) });
    assert.throws(() => decodePublishCallData(`0xdeadbeef${canonical.slice(10)}`), (e) => e instanceof MalformedCallDataError && e.selector === '0xdeadbeef' && e.code === 'MALFORMED_CALLDATA');
    assert.throws(() => decodePublishCallData('0x'), /not a publish\(\) call/);
    assert.throws(() => decodePublishCallData('0x70a745'), /not a publish\(\) call/);
    assert.throws(() => decodePublishCallData(`${PUBLISH_SELECTOR}${'00'.repeat(40)}`), /too short/);
    assert.throws(() => decodePublishCallData(`${PUBLISH_WITH_HOOK_SELECTOR}${'00'.repeat(100)}`), /too short for publish\(bytes32,bytes,address,bytes\)/);
    assert.throws(() => decodePublishCallData(`${PUBLISH_FOR_SELECTOR}${'00'.repeat(200)}`), /too short for publishFor/);
    assert.throws(() => decodePublishCallData('nonsense'), /Uint8Array or a 0x-prefixed hex/);
  });

  test('refuses an offset or a length that points outside the data, in any form', () => {
    const hex = (n) => n.toString(16).padStart(64, '0');
    const head = PUBLISH_SELECTOR + TITLE.slice(2);
    assert.throws(() => decodePublishCallData(head + hex(0x1000) + hex(0)), /payload offset points outside/);
    assert.throws(() => decodePublishCallData(head + hex(0x40) + hex(50) + '00'.repeat(32)), /payload is cut short/);
    assert.throws(() => decodePublishCallData(head + hex(0x40) + 'ff'.repeat(32)), /not a plausible size/);
    assert.throws(() => decodePublishCallData(head + 'ff'.repeat(32) + hex(0)), /not a plausible size/);

    // The hooked form: a hookData offset that points past the end.
    const hooked = PUBLISH_WITH_HOOK_SELECTOR + TITLE.slice(2) + hex(0x80) + hex(0xab) + hex(0x1000) + hex(0) + hex(0);
    assert.throws(() => decodePublishCallData(hooked), /hookData offset points outside/);
    // The relayed form: a signature cut short.
    const good = encodePublishForCallData({ author: AUTHOR, title: TITLE, payload: EMPTY, deadline: 1, signature: SIG });
    assert.throws(() => decodePublishCallData(good.slice(0, -80)), /signature is cut short/);
  });

  test('refuses an address word with anything in its upper bytes', () => {
    const hex = (n) => n.toString(16).padStart(64, '0');
    const dirty = PUBLISH_WITH_HOOK_SELECTOR + TITLE.slice(2) + hex(0x80) + '01' + '00'.repeat(11) + 'ab'.repeat(20) + hex(0xa0) + hex(0) + hex(0);
    assert.throws(() => decodePublishCallData(dirty), /hook is not an address/);
  });

  test('callDataForm and isPublishCallData go by the selector alone', () => {
    assert.equal(callDataForm(`${PUBLISH_SELECTOR}00`), 'publish');
    assert.equal(callDataForm(`${PUBLISH_WITH_HOOK_SELECTOR}00`), 'publishWithHook');
    assert.equal(callDataForm(`${PUBLISH_FOR_SELECTOR}00`), 'publishFor');
    assert.equal(callDataForm('0x70a745'), null);
    assert.equal(callDataForm('0xdeadbeef'), null);
    assert.equal(callDataForm('garbage'), null);
    assert.equal(isPublishCallData(`${PUBLISH_SELECTOR}00`), true);
    assert.equal(isPublishCallData(`${PUBLISH_FOR_SELECTOR}`), true);
    assert.equal(isPublishCallData('0x70a745'), false);
    assert.equal(isPublishCallData('0xdeadbeef'), false);
    assert.equal(isPublishCallData('garbage'), false);
    assert.equal(isPublishCallData(new Uint8Array([0x70, 0xa7, 0x45, 0x32])), true);
    assert.equal(bytesToHex(new Uint8Array([0xcf, 0x5f, 0x0b, 0xff])), PUBLISH_WITH_HOOK_SELECTOR);
  });
});
