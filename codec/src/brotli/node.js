// brotli/node.js — the reference codec, on Node's built-in brotli.
//
// Quality 11 and every other parameter at its default (REFERENCE_BROTLI).
// Nothing here may change without changing every post's bytes: no window
// tuning, no dictionary, no "large window" mode. brotli-wasm with the same
// quality produces the identical stream, and test/interop.test.js checks it.

import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { REFERENCE_BROTLI } from '../payload.js';

const PARAMS = { params: { [constants.BROTLI_PARAM_QUALITY]: REFERENCE_BROTLI.quality } };

/** @returns {import('../payload.js').BrotliCodec} */
export function createNodeBrotli() {
  return {
    compress: (bytes) => new Uint8Array(brotliCompressSync(bytes, PARAMS)),
    decompress: (bytes) => new Uint8Array(brotliDecompressSync(bytes)),
  };
}

/** The one instance; the codec keeps no state, so one is enough. */
export const nodeBrotli = createNodeBrotli();
