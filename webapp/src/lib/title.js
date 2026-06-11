// title.js — bytes32 title encoding/decoding.
//
// A title is UTF-8 bytes, zero-right-padded to 32 bytes, stored as
// `bytes32` in the event and as a calldata arg to publish().
//
// bytes32 = 32 bytes total:
//   - ASCII char           = 1 byte  → up to 32 chars
//   - Latin accented char  = 2 bytes
//   - Chinese / CJK char   = 3 bytes → up to ~10 chars
//   - Emoji (most)         = 4 bytes
//
// `titleByteLength` returns the actual byte length so the UI can warn at
// the right threshold.

import { bytesToHex, hexToBytes } from 'viem';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** @returns {number} byte length of the UTF-8 encoding of `title` */
export function titleByteLength(title) {
  return encoder.encode(title || '').length;
}

export const TITLE_MAX_BYTES = 32;

/**
 * Encode a UTF-8 title into a 0x-prefixed bytes32 hex string.
 * Throws if the title exceeds 32 bytes.
 */
export function encodeTitle(title) {
  const bytes = encoder.encode(title || '');
  if (bytes.length > TITLE_MAX_BYTES) {
    throw new Error(`title too long: ${bytes.length} > ${TITLE_MAX_BYTES} bytes`);
  }
  const padded = new Uint8Array(TITLE_MAX_BYTES);
  padded.set(bytes);
  return bytesToHex(padded);
}

/**
 * Decode a 0x-prefixed bytes32 hex string back to a UTF-8 title.
 * Trailing zero bytes are stripped; trailing partial multibyte
 * sequences are dropped (TextDecoder in non-fatal mode replaces them).
 */
export function decodeTitle(bytes32Hex) {
  if (!bytes32Hex) return '';
  const bytes = hexToBytes(bytes32Hex);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return decoder.decode(bytes.slice(0, end));
}
