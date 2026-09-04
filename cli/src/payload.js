// payload.js — the brotli boundary, in Node.
//
// The web app compresses with brotli-wasm because a browser's own brotli is
// only available on the network path, not to a script. Node has the codec
// built in, so the CLI uses `node:zlib` and gains a dependency-free
// compression layer — but the BYTES MUST BE IDENTICAL either way, because
// the same post published from either side has to cost the same and hash the
// same, and because the app's raw view shows the compressed size of what the
// chain holds.
//
// They are identical because both sides are brotli at quality 11 with every
// other parameter left at its default, over the exact same UTF-8 document
// built by the shared `buildPayloadText`. Nothing else about this file may
// change without breaking that: no window-size tuning, no dictionary, no
// "large window" mode. `test/publish.test.js` compares a payload built here
// against a plain `brotliCompressSync` of the same text to keep it honest.

import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { buildPayloadText, parsePayloadText } from './shared.js';

const PARAMS = { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } };

/** Compress the document a payload holds. */
export function compressText(text) {
  return new Uint8Array(brotliCompressSync(Buffer.from(text, 'utf8'), PARAMS));
}

/** The document back out of the bytes the chain holds. */
export function decompressBytes(bytes) {
  return brotliDecompressSync(Buffer.from(bytes)).toString('utf8');
}

/**
 * Build the document and compress it, the same way `encodePayload` does in
 * the browser: `tags` is folded into `meta`, because tags are one
 * front-matter key among several and the dedicated argument is only there
 * because it is the one the editor has a field for.
 *
 * @returns {{ text: string, bytes: Uint8Array }} the document as it will be
 *   stored, and the bytes that will be stored.
 */
export function encodePayload({ tags, markdown = '', meta = {} } = {}) {
  const merged = { ...meta };
  if (tags != null) merged.tags = tags;
  const text = buildPayloadText({ markdown, meta: merged });
  return { text, bytes: compressText(text) };
}

/**
 * Decompress and take apart what a publish() call carried.
 * @returns {{ meta: object, tags: string[], markdown: string, text: string, compressedBytes: number }}
 *   `text` is the exact document the chain holds — front-matter included,
 *   which is what `--raw`, an exported `.md` and an archive all carry.
 */
export function decodePayload(bytes) {
  const text = decompressBytes(bytes);
  return { ...parsePayloadText(text), text, compressedBytes: bytes.length };
}
