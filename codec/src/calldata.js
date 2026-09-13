// calldata.js — the CALL DATA: the three ways a post reaches the chain.
//
//     publish(bytes32 title, bytes payload)                                   v1 and v2, the plain post
//     publish(bytes32 title, bytes payload, address hook, bytes hookData)     v2, a post through a hook
//     publishFor(address author, bytes32 title, bytes payload,                v2, a post someone else
//                address hook, bytes hookData, uint256 deadline,              submits against the
//                bytes signature)                                             author's signature
//
// All three are standard ABI encoding, hand-written here so that the package
// depends on nothing. A call is a selector, then a HEAD of one 32-byte word
// per argument — a static argument in place, a dynamic one as the offset of
// its tail, counted from the first byte after the selector — and then the
// TAILS: a length word, the bytes, zero-padding to a whole word. The plain
// form is exactly what SPEC.md §6.2 draws:
//
//     0x70a74532                       the selector
//     title            32 bytes        the bytes32, as is
//     0x40             32 bytes        where the payload starts, counted from after the selector
//     length           32 bytes        how many bytes the payload is
//     payload          length bytes    the payload
//     zeros            0–31 bytes      right-padding to a multiple of 32
//
// Reading follows the offsets rather than assuming them, the way every ABI
// decoder does, and tolerates what they tolerate: bytes after the padding,
// and padding that is short. It refuses a selector it does not know, an
// offset or a length that points outside the data, a payload that is cut
// short, and an address word with anything in its upper twelve bytes.

import { MalformedCallDataError } from './errors.js';
import { bytesToHex, hexToBytes, toBytes } from './hex.js';

export const PUBLISH_SIGNATURE = 'publish(bytes32,bytes)';
/** keccak256(PUBLISH_SIGNATURE), first four bytes. */
export const PUBLISH_SELECTOR = '0x70a74532';

export const PUBLISH_WITH_HOOK_SIGNATURE = 'publish(bytes32,bytes,address,bytes)';
/** keccak256(PUBLISH_WITH_HOOK_SIGNATURE), first four bytes. */
export const PUBLISH_WITH_HOOK_SELECTOR = '0xcf5f0bff';

export const PUBLISH_FOR_SIGNATURE = 'publishFor(address,bytes32,bytes,address,bytes,uint256,bytes)';
/** keccak256(PUBLISH_FOR_SIGNATURE), first four bytes. */
export const PUBLISH_FOR_SELECTOR = '0x80e41e43';

/**
 * The event v1's `publish()` emits, whose `title` field is the same bytes32 —
 * informative: decoding events is a client's job, but `decodeTitle` applies
 * to what a log carries exactly as it applies to the calldata.
 */
export const POST_EVENT_SIGNATURE = 'Post(address,uint256,uint256,bytes32)';
/** keccak256(POST_EVENT_SIGNATURE): topic 0 of every v1 Post log. */
export const POST_EVENT_TOPIC = '0x5cd0759ab74dbe8f489ac7602146c443e7d2eedf00377e0c113b0466b4ffde5f';

/** The v2 event: the hook a post went through is its second indexed field. */
export const POST_V2_EVENT_SIGNATURE = 'Post(address,address,uint256,uint256,bytes32)';
/** keccak256(POST_V2_EVENT_SIGNATURE): topic 0 of every v2 Post log. */
export const POST_V2_EVENT_TOPIC = '0xb9b1202ea7165d7724de1f5fd6ae97b9a1b4376c87e1fdbcceb4907f60a78a9d';

/** The zero address: "no hook", as the chain spells it. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const WORD = 32;
const EMPTY = new Uint8Array(0);

/**
 * The three call forms, by selector: the argument list, and which of the
 * arguments each field of a decoded call comes from.
 * @type {Record<string, { form: string, selector: string, signature: string, params: Array<{ name: string, type: 'bytes32' | 'bytes' | 'address' | 'uint256' }> }>}
 */
export const CALL_FORMS = Object.freeze({
  publish: {
    form: 'publish',
    selector: PUBLISH_SELECTOR,
    signature: PUBLISH_SIGNATURE,
    params: [
      { name: 'title', type: 'bytes32' },
      { name: 'payload', type: 'bytes' },
    ],
  },
  publishWithHook: {
    form: 'publishWithHook',
    selector: PUBLISH_WITH_HOOK_SELECTOR,
    signature: PUBLISH_WITH_HOOK_SIGNATURE,
    params: [
      { name: 'title', type: 'bytes32' },
      { name: 'payload', type: 'bytes' },
      { name: 'hook', type: 'address' },
      { name: 'hookData', type: 'bytes' },
    ],
  },
  publishFor: {
    form: 'publishFor',
    selector: PUBLISH_FOR_SELECTOR,
    signature: PUBLISH_FOR_SIGNATURE,
    params: [
      { name: 'author', type: 'address' },
      { name: 'title', type: 'bytes32' },
      { name: 'payload', type: 'bytes' },
      { name: 'hook', type: 'address' },
      { name: 'hookData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
  },
});

const FORMS_BY_SELECTOR = new Map(Object.values(CALL_FORMS).map((f) => [f.selector, f]));

// --- Words -------------------------------------------------------------

/** A 32-byte big-endian word for a non-negative integer (number or bigint). */
function word(n) {
  const out = new Uint8Array(WORD);
  let v = BigInt(n);
  if (v < 0n) throw new MalformedCallDataError('a word cannot hold a negative number');
  for (let i = WORD - 1; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v > 0n) throw new MalformedCallDataError('a number too large for a word');
  return out;
}

/** The integer a 32-byte word holds, refusing one too large to be an offset or a length. */
function readSize(bytes, at, what) {
  let n = 0;
  for (let i = 0; i < WORD; i++) {
    n = n * 256 + bytes[at + i];
    if (n > Number.MAX_SAFE_INTEGER) throw new MalformedCallDataError(`${what} is not a plausible size`);
  }
  return n;
}

/** The integer a 32-byte word holds, exactly, as a decimal string. */
function readUint(bytes, at) {
  let n = 0n;
  for (let i = 0; i < WORD; i++) n = (n << 8n) | BigInt(bytes[at + i]);
  return n.toString(10);
}

/** The address a 32-byte word holds, lowercase hex; refuses dirty upper bytes. */
function readAddress(bytes, at, what) {
  for (let i = 0; i < 12; i++) {
    if (bytes[at + i] !== 0) throw new MalformedCallDataError(`${what} is not an address (the word's upper bytes are not zero)`);
  }
  return bytesToHex(bytes.subarray(at + 12, at + WORD));
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** An address as a 32-byte word. */
function addressWord(value, what) {
  if (value == null) return new Uint8Array(WORD);
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new MalformedCallDataError(`${what} must be an address (0x + 40 hex)`);
  }
  const out = new Uint8Array(WORD);
  out.set(hexToBytes(value), 12);
  return out;
}

const isZeroAddress = (value) => value == null || String(value).toLowerCase() === ZERO_ADDRESS;

// --- Encoding ------------------------------------------------------------

/**
 * ABI-encode a call: the selector, a head of one word per argument, and the
 * tails of the dynamic ones, in argument order.
 * @param {typeof CALL_FORMS[keyof typeof CALL_FORMS]} form
 * @param {Record<string, any>} values
 */
function encodeCall(form, values) {
  const head = [];
  const tails = [];
  let tailLength = 0;
  const headLength = form.params.length * WORD;
  for (const p of form.params) {
    const v = values[p.name];
    if (p.type === 'bytes32') {
      const b = toBytes(v, p.name);
      if (b.length !== WORD) throw new MalformedCallDataError(`a bytes32 ${p.name} is 32 bytes, not ${b.length}`);
      head.push(b);
    } else if (p.type === 'address') {
      head.push(addressWord(v, p.name));
    } else if (p.type === 'uint256') {
      head.push(word(v));
    } else {
      const b = v == null ? EMPTY : toBytes(v, p.name);
      head.push(word(headLength + tailLength));
      const padded = Math.ceil(b.length / WORD) * WORD;
      const tail = new Uint8Array(WORD + padded);
      tail.set(word(b.length), 0);
      tail.set(b, WORD);
      tails.push(tail);
      tailLength += tail.length;
    }
  }
  const out = new Uint8Array(4 + headLength + tailLength);
  out.set(hexToBytes(form.selector), 0);
  let at = 4;
  for (const w of head) {
    out.set(w, at);
    at += WORD;
  }
  for (const t of tails) {
    out.set(t, at);
    at += t.length;
  }
  return bytesToHex(out);
}

/**
 * Encode a `publish()` call: the plain two-argument form, or, when a hook
 * (other than the zero address) or hook data is given, the four-argument
 * form of v2.
 * @param {{ title: string | Uint8Array, payload: Uint8Array | string, hook?: string | null, hookData?: Uint8Array | string | null }} args
 *   `title` a bytes32 (`0x` + 64 hex, or 32 bytes); `payload` the bytes;
 *   `hook` an address; `hookData` bytes for the hook
 * @returns {string} the calldata, `0x`-prefixed lowercase hex
 */
export function encodePublishCallData({ title, payload, hook = null, hookData = null }) {
  const data = hookData == null ? EMPTY : toBytes(hookData, 'hookData');
  if (isZeroAddress(hook) && data.length === 0) {
    return encodeCall(CALL_FORMS.publish, { title, payload });
  }
  return encodeCall(CALL_FORMS.publishWithHook, { title, payload, hook: hook ?? ZERO_ADDRESS, hookData: data });
}

/**
 * Encode a `publishFor()` call: a post submitted on `author`'s behalf,
 * against their EIP-712 signature (see Xueni.sol `publishDigest`).
 * @param {{ author: string, title: string | Uint8Array, payload: Uint8Array | string, hook?: string | null, hookData?: Uint8Array | string | null, deadline: number | bigint | string, signature: Uint8Array | string }} args
 * @returns {string} the calldata, `0x`-prefixed lowercase hex
 */
export function encodePublishForCallData({ author, title, payload, hook = null, hookData = null, deadline, signature }) {
  if (typeof author !== 'string' || !ADDRESS_RE.test(author)) {
    throw new MalformedCallDataError('author must be an address (0x + 40 hex)');
  }
  return encodeCall(CALL_FORMS.publishFor, {
    author,
    title,
    payload,
    hook: hook ?? ZERO_ADDRESS,
    hookData: hookData ?? EMPTY,
    deadline: deadline ?? 0,
    signature,
  });
}

// --- Decoding ------------------------------------------------------------

/** Which call this is, by its selector, or null for a call this package does not know. */
export function callDataForm(data) {
  let bytes;
  try {
    bytes = toBytes(data, 'calldata');
  } catch {
    return null;
  }
  if (bytes.length < 4) return null;
  return FORMS_BY_SELECTOR.get(bytesToHex(bytes.subarray(0, 4)))?.form ?? null;
}

/** Is this the calldata of a call that publishes a post, going by its selector? Any of the three forms. */
export const isPublishCallData = (data) => callDataForm(data) != null;

/**
 * @typedef {object} DecodedCall
 * @property {'publish' | 'publishWithHook' | 'publishFor'} form  which call it is
 * @property {string} title              the bytes32, `0x` + 64 hex
 * @property {Uint8Array} payload        the payload bytes (a copy, safe to keep)
 * @property {string | null} hook        the hook's address (lowercase), or null for none
 * @property {Uint8Array} hookData       the bytes for the hook (empty for none)
 * @property {{ author: string, deadline: string, signature: Uint8Array } | null} relayed
 *   for `publishFor`: the author of record (lowercase address), the signature's
 *   deadline (a unix time, as a decimal string) and the signature bytes; null otherwise
 */

/**
 * Decode a `publish()` or `publishFor()` call.
 * @param {string | Uint8Array} data the calldata (`tx.input`)
 * @returns {DecodedCall}
 * @throws {MalformedCallDataError} for anything that is not such a call
 */
export function decodePublishCallData(data) {
  const bytes = toBytes(data, 'calldata');
  const got = bytes.length >= 4 ? bytesToHex(bytes.subarray(0, 4)) : bytesToHex(bytes);
  const form = FORMS_BY_SELECTOR.get(got);
  if (!form) {
    throw new MalformedCallDataError(`not a publish() call: selector ${got}, expected ${PUBLISH_SELECTOR}, ${PUBLISH_WITH_HOOK_SELECTOR} or ${PUBLISH_FOR_SELECTOR}`, { selector: got });
  }
  const args = bytes.subarray(4);
  const headLength = form.params.length * WORD;
  if (args.length < headLength) throw new MalformedCallDataError(`calldata too short for ${form.signature}`);
  const values = {};
  form.params.forEach((p, i) => {
    const at = i * WORD;
    if (p.type === 'bytes32') {
      values[p.name] = bytesToHex(args.subarray(at, at + WORD));
    } else if (p.type === 'address') {
      values[p.name] = readAddress(args, at, `the ${p.name}`);
    } else if (p.type === 'uint256') {
      values[p.name] = readUint(args, at);
    } else {
      const offset = readSize(args, at, `the ${p.name} offset`);
      if (offset + WORD > args.length) throw new MalformedCallDataError(`the ${p.name} offset points outside the calldata`);
      const length = readSize(args, offset, `the ${p.name} length`);
      const start = offset + WORD;
      if (start + length > args.length) throw new MalformedCallDataError(`the ${p.name} is cut short`);
      // A copy, and a plain Uint8Array whatever came in: a Buffer's slice()
      // is a view, and a caller who keeps the payload must not be keeping
      // the call.
      values[p.name] = new Uint8Array(args.subarray(start, start + length));
    }
  });
  const hook = values.hook == null || values.hook === ZERO_ADDRESS ? null : values.hook;
  return {
    form: form.form,
    title: values.title,
    payload: values.payload,
    hook,
    hookData: values.hookData ?? EMPTY,
    relayed:
      form.form === 'publishFor'
        ? { author: values.author, deadline: values.deadline, signature: values.signature }
        : null,
  };
}
