// utf8.js — text as bytes.
//
// One encoder and one decoder for the whole package. The decoder is
// deliberately lenient and deliberately keeps a byte-order mark:
//
// - lenient (`fatal: false`): a title cut mid-character by a foreign writer,
//   or a payload that is not quite UTF-8, still reads, with U+FFFD where the
//   damage is. A reader that threw would hide a whole post over one byte.
// - `ignoreBOM: true`: the default TextDecoder silently DROPS a leading
//   U+FEFF, which would make the document the reader shows differ from the
//   bytes the chain holds. Node's `Buffer#toString('utf8')` keeps it, and so
//   does this — the two agree on every byte sequence.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** @param {string} text */
export const utf8Encode = (text) => encoder.encode(text);

/** @param {Uint8Array} bytes */
export const utf8Decode = (bytes) => decoder.decode(bytes);

/** The UTF-8 byte length of `text` — what the chain measures, not characters. */
export const utf8ByteLength = (text) => encoder.encode(text).length;

/**
 * A string with no lone surrogate. A lone surrogate cannot be encoded as
 * UTF-8, so TextEncoder would replace it with U+FFFD behind the writer's
 * back — and the document read back would not be the document written.
 */
export function isWellFormed(text) {
  if (typeof text.isWellFormed === 'function') return text.isWellFormed();
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}
