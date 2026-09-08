// brotli/wasm.js — the same codec over brotli-wasm, for a browser.
//
// brotli-wasm is not a dependency of this package: the caller loads and
// initialises it (its init is asynchronous) and hands the module here, and
// what comes back is the synchronous codec the rest of the package wants.
//
//     import init from 'brotli-wasm';
//     import { fromBrotliWasm } from 'xueni-codec/brotli-wasm';
//     const brotli = fromBrotliWasm(await init);
//     postToCallData(post, { brotli });

import { REFERENCE_BROTLI } from '../payload.js';

/**
 * @param {{ compress(buf: Uint8Array, options?: { quality?: number }): Uint8Array, decompress(buf: Uint8Array): Uint8Array }} module
 *   an initialised brotli-wasm module
 * @returns {import('../payload.js').BrotliCodec}
 */
export function fromBrotliWasm(module) {
  if (!module || typeof module.compress !== 'function' || typeof module.decompress !== 'function') {
    throw new TypeError('fromBrotliWasm wants an initialised brotli-wasm module (await its default export first)');
  }
  return {
    compress: (bytes) => module.compress(bytes, { quality: REFERENCE_BROTLI.quality }),
    decompress: (bytes) => module.decompress(bytes),
  };
}
