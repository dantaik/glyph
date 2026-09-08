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
    // `maxOutputLength` makes zlib stop where the bound is rather than grow
    // the output until memory runs out — which is the whole point of a bound.
    decompress: (bytes, { maxOutputBytes } = {}) => {
      const options = Number.isFinite(maxOutputBytes) ? { maxOutputLength: Math.max(1, Math.floor(maxOutputBytes)) } : undefined;
      try {
        return new Uint8Array(brotliDecompressSync(bytes, options));
      } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
          throw Object.assign(new Error(`decompressed output passes ${maxOutputBytes} bytes`), { code: 'OUTPUT_TOO_LARGE', cause: err });
        }
        throw err;
      }
    },
  };
}

/** The one instance; the codec keeps no state, so one is enough. */
export const nodeBrotli = createNodeBrotli();
