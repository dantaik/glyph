// calldata.js — the CALL DATA: `publish(bytes32 title, bytes payload)`.
//
// The one function of the contract that writes, ABI-encoded by hand. There
// are two arguments and one of them is dynamic, so the whole layout is:
//
//     0x70a74532                       the selector, keccak256("publish(bytes32,bytes)")[0..4]
//     title            32 bytes        the bytes32, as is
//     0x40             32 bytes        where the payload starts, counted from after the selector
//     length           32 bytes        how many bytes the payload is
//     payload          length bytes    the payload
//     zeros            0–31 bytes      right-padding to a multiple of 32
//
// Reading follows the offset rather than assuming it, the way every ABI
// decoder does, and tolerates what they tolerate: bytes after the padding,
// and padding that is short. It refuses a different selector, an offset or
// a length that points outside the data, and a payload that is cut short.

import { MalformedCallDataError } from './errors.js';
import { bytesToHex, hexToBytes, toBytes } from './hex.js';

export const PUBLISH_SIGNATURE = 'publish(bytes32,bytes)';

/** keccak256(PUBLISH_SIGNATURE), first four bytes. */
export const PUBLISH_SELECTOR = '0x70a74532';

/**
 * The event `publish()` emits, whose `title` field is the same bytes32 —
 * informative: decoding events is a client's job, but `decodeTitle` applies
 * to what a log carries exactly as it applies to the calldata.
 */
export const POST_EVENT_SIGNATURE = 'Post(address,uint256,uint256,bytes32)';

/** keccak256(POST_EVENT_SIGNATURE): topic 0 of every Post log. */
export const POST_EVENT_TOPIC = '0x5cd0759ab74dbe8f489ac7602146c443e7d2eedf00377e0c113b0466b4ffde5f';

const WORD = 32;
const SELECTOR = hexToBytes(PUBLISH_SELECTOR);
const HEAD = 2 * WORD; // title + offset

/** A 32-byte big-endian word for a small non-negative integer. */
function word(n) {
  const out = new Uint8Array(WORD);
  let v = n;
  for (let i = WORD - 1; i >= 0 && v > 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

/** The integer a 32-byte word holds, refusing one too large to be an offset or a length. */
function readWord(bytes, at, what) {
  let n = 0;
  for (let i = 0; i < WORD; i++) {
    n = n * 256 + bytes[at + i];
    if (n > Number.MAX_SAFE_INTEGER) throw new MalformedCallDataError(`${what} is not a plausible size`);
  }
  return n;
}

/** Is this the calldata of a `publish()` call, going by its selector? */
export function isPublishCallData(data) {
  let bytes;
  try {
    bytes = toBytes(data, 'calldata');
  } catch {
    return false;
  }
  return bytes.length >= 4 && SELECTOR.every((b, i) => bytes[i] === b);
}

/**
 * Encode a `publish()` call.
 * @param {{ title: string | Uint8Array, payload: Uint8Array | string }} args
 *   `title` a bytes32 (`0x` + 64 hex, or 32 bytes); `payload` the bytes
 * @returns {string} the calldata, `0x`-prefixed lowercase hex
 */
export function encodePublishCallData({ title, payload }) {
  const titleBytes = toBytes(title, 'title');
  if (titleBytes.length !== WORD) throw new MalformedCallDataError(`a bytes32 title is 32 bytes, not ${titleBytes.length}`);
  const payloadBytes = toBytes(payload, 'payload');
  const padded = Math.ceil(payloadBytes.length / WORD) * WORD;
  const out = new Uint8Array(4 + HEAD + WORD + padded);
  out.set(SELECTOR, 0);
  out.set(titleBytes, 4);
  out.set(word(HEAD), 4 + WORD);
  out.set(word(payloadBytes.length), 4 + HEAD);
  out.set(payloadBytes, 4 + HEAD + WORD);
  return bytesToHex(out);
}

/**
 * Decode a `publish()` call.
 * @param {string | Uint8Array} data the calldata (`tx.input`)
 * @returns {{ title: string, payload: Uint8Array }} the bytes32 title as
 *   `0x` + 64 hex, and the payload bytes (a copy, safe to keep)
 * @throws {MalformedCallDataError} for anything that is not such a call
 */
export function decodePublishCallData(data) {
  const bytes = toBytes(data, 'calldata');
  if (!isPublishCallData(bytes)) {
    const got = bytes.length >= 4 ? bytesToHex(bytes.subarray(0, 4)) : bytesToHex(bytes);
    throw new MalformedCallDataError(`not a publish() call: selector ${got}, expected ${PUBLISH_SELECTOR}`, { selector: got });
  }
  const args = bytes.subarray(4);
  if (args.length < HEAD + WORD) throw new MalformedCallDataError('calldata too short for publish(bytes32,bytes)');
  const title = bytesToHex(args.subarray(0, WORD));
  const offset = readWord(args, WORD, 'the payload offset');
  if (offset + WORD > args.length) throw new MalformedCallDataError('the payload offset points outside the calldata');
  const length = readWord(args, offset, 'the payload length');
  const start = offset + WORD;
  if (start + length > args.length) throw new MalformedCallDataError('the payload is cut short');
  // A copy, and a plain Uint8Array whatever came in: a Buffer's slice() is
  // a view, and a caller who keeps the payload must not be keeping the call.
  return { title, payload: new Uint8Array(args.subarray(start, start + length)) };
}
