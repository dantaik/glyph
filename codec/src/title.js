// title.js — the title as the contract holds it: one `bytes32`.
//
// The title is the one part of a post the contract sees: it is the first
// argument of `publish()` and rides in the `Post` event, so a list of titles
// is read from logs without decompressing anything. The encoding is the
// simplest there is — the UTF-8 bytes, right-padded with zeros to 32 — and
// what that costs is a hard ceiling of 32 BYTES: 32 ASCII letters, about ten
// Chinese characters, eight emoji.

import { InvalidPostError } from './errors.js';
import { bytesToHex, toBytes } from './hex.js';
import { BIDI_CONTROL_RE, CONTROL_RE } from './refs.js';
import { isWellFormed, utf8ByteLength, utf8Decode, utf8Encode } from './utf8.js';

export const TITLE_MAX_BYTES = 32;

const NUL = String.fromCharCode(0);

/** @returns {number} the UTF-8 byte length of `title` */
export const titleByteLength = (title) => utf8ByteLength(String(title ?? ''));

/**
 * What is wrong with `title` as a bytes32, as a list of problems (empty when
 * nothing is). `validatePost` folds these in; `encodeTitle` refuses on them.
 * @returns {import('./post.js').Problem[]}
 */
export function titleProblems(title) {
  const problems = [];
  if (typeof title !== 'string') {
    return [{ level: 'error', path: 'title', code: 'TYPE', message: 'must be a string' }];
  }
  if (!isWellFormed(title)) {
    problems.push({ level: 'error', path: 'title', code: 'MALFORMED_UNICODE', message: 'contains a lone surrogate' });
  }
  if (title.includes(NUL)) {
    // The padding is zero bytes, and a reader strips trailing zeros: a NUL
    // inside the title could not be told from the padding after it.
    problems.push({ level: 'error', path: 'title', code: 'TITLE_NUL', message: 'must not contain U+0000' });
  } else if (CONTROL_RE.test(title)) {
    problems.push({ level: 'error', path: 'title', code: 'CONTROL_CHAR', message: 'contains a control character (a terminal would obey it)' });
  }
  if (BIDI_CONTROL_RE.test(title)) {
    problems.push({ level: 'warning', path: 'title', code: 'BIDI_CONTROL', message: 'contains bidirectional control characters, which can make it read differently from how it is stored' });
  }
  const bytes = utf8ByteLength(title);
  if (bytes > TITLE_MAX_BYTES) {
    problems.push({
      level: 'error',
      path: 'title',
      code: 'TITLE_TOO_LONG',
      message: `${bytes} bytes of UTF-8, more than the ${TITLE_MAX_BYTES} a bytes32 holds`,
    });
  }
  if (title.length === 0) {
    problems.push({ level: 'warning', path: 'title', code: 'TITLE_EMPTY', message: 'is empty' });
  }
  return problems;
}

/**
 * The bytes32 for `title`: UTF-8, right-padded with zeros, as lowercase hex.
 * @param {string} title
 * @returns {string} `0x` + 64 hex characters
 * @throws {InvalidPostError} over 32 bytes, a NUL inside, or a lone surrogate
 */
export function encodeTitle(title) {
  const problems = titleProblems(title);
  if (problems.some((p) => p.level === 'error')) throw new InvalidPostError(problems);
  const padded = new Uint8Array(TITLE_MAX_BYTES);
  padded.set(utf8Encode(title));
  return bytesToHex(padded);
}

/**
 * The title a bytes32 holds — from the calldata argument or from the event
 * field, which carry the same value. Trailing zero bytes are the padding and
 * are dropped; what is left is decoded as UTF-8, leniently, so a title a
 * foreign writer cut mid-character still reads (ending in U+FFFD).
 * @param {string | Uint8Array} bytes32 `0x` + 64 hex characters, or 32 bytes
 * @returns {string}
 */
export function decodeTitle(bytes32) {
  const bytes = toBytes(bytes32, 'title');
  if (bytes.length !== TITLE_MAX_BYTES) {
    throw new InvalidPostError([
      { level: 'error', path: 'title', code: 'TYPE', message: `a bytes32 is 32 bytes, not ${bytes.length}` },
    ]);
  }
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return utf8Decode(bytes.subarray(0, end));
}

/**
 * `title` cut to what a bytes32 holds, at a grapheme boundary — so neither a
 * multi-byte character nor an emoji sequence is split, and the result is a
 * title a reader would recognise as the start of the original.
 *
 * A convenience for editors and importers; the encoder never cuts on its
 * own, because a title silently truncated is a title nobody meant.
 */
export function fitTitle(title) {
  const text = String(title ?? '');
  if (utf8ByteLength(text) <= TITLE_MAX_BYTES) return text;
  const pieces =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
      : [...text]; // code points, when no segmenter is there to give graphemes
  let out = '';
  for (const piece of pieces) {
    if (utf8ByteLength(out + piece) > TITLE_MAX_BYTES) break;
    out += piece;
  }
  return out;
}
