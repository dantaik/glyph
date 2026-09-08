// hex.js — bytes as a `0x…` string and back, strictly.
//
// Everything a node hands out, and everything a wallet is given, is hex with
// a `0x` prefix. These two functions are the whole of what the codec needs,
// written here rather than imported so that the package depends on nothing.

import { CodecError } from './errors.js';

const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

/** True for a `0x`-prefixed string of whole bytes (an empty `0x` included). */
export const isHex = (value) => typeof value === 'string' && HEX_RE.test(value);

/** @param {Uint8Array} bytes @returns {string} lowercase, `0x`-prefixed */
export function bytesToHex(bytes) {
  let out = '0x';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * @param {string} hex a `0x`-prefixed string of whole bytes, either case
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (!isHex(hex)) {
    throw new CodecError('expected a 0x-prefixed hex string of whole bytes', { code: 'INVALID_HEX' });
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

/** Bytes in, bytes out; hex in, bytes out. What every decoder accepts. */
export function toBytes(value, what = 'input') {
  if (value instanceof Uint8Array) return value;
  if (isHex(value)) return hexToBytes(value);
  throw new CodecError(`${what} must be a Uint8Array or a 0x-prefixed hex string`, { code: 'INVALID_HEX' });
}
