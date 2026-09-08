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
//
// Decompression is BOUNDED, through brotli-wasm's streaming decompressor:
// the output is produced a chunk at a time and the stream is abandoned the
// moment the bound is passed, so a decompression bomb costs one chunk and a
// few milliseconds rather than the tab. The one-shot `decompress` would
// allocate the whole bomb before anyone could look at its size.

import { REFERENCE_BROTLI } from '../payload.js';

/** Output produced per streaming step. Small enough that a bomb is caught early. */
const CHUNK = 64 * 1024;

const tooLarge = (limit) => Object.assign(new Error(`decompressed output passes ${limit} bytes`), { code: 'OUTPUT_TOO_LARGE' });

/**
 * Decompress with the streaming API, stopping at `limit` bytes of output.
 * @param {*} module an initialised brotli-wasm module
 * @param {Uint8Array} bytes
 * @param {number} limit
 * @returns {Uint8Array}
 */
function decompressBounded(module, bytes, limit) {
  const { ResultSuccess, NeedsMoreInput, NeedsMoreOutput } = module.BrotliStreamResultCode;
  const stream = new module.DecompressStream();
  const parts = [];
  let total = 0;
  let offset = 0;
  try {
    for (;;) {
      const result = stream.decompress(bytes.subarray(offset), CHUNK);
      const produced = result.buf.length;
      if (produced) parts.push(result.buf);
      total += produced;
      offset += result.input_offset;
      if (total > limit) throw tooLarge(limit);
      if (result.code === ResultSuccess) break;
      if (result.code === NeedsMoreOutput) continue;
      if (result.code === NeedsMoreInput) {
        // All the input is gone and the stream still wants more: it is cut short.
        if (offset >= bytes.length || (result.input_offset === 0 && produced === 0)) {
          throw new Error('the brotli stream ends before the document does');
        }
        continue;
      }
      throw new Error(`brotli decompression failed with code ${result.code}`);
    }
  } finally {
    stream.free?.();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * @param {{ compress(buf: Uint8Array, options?: { quality?: number }): Uint8Array, decompress(buf: Uint8Array): Uint8Array, DecompressStream?: Function, BrotliStreamResultCode?: object }} module
 *   an initialised brotli-wasm module
 * @returns {import('../payload.js').BrotliCodec}
 */
export function fromBrotliWasm(module) {
  if (!module || typeof module.compress !== 'function' || typeof module.decompress !== 'function') {
    throw new TypeError('fromBrotliWasm wants an initialised brotli-wasm module (await its default export first)');
  }
  const streaming = typeof module.DecompressStream === 'function' && module.BrotliStreamResultCode != null;
  return {
    compress: (bytes) => module.compress(bytes, { quality: REFERENCE_BROTLI.quality }),
    decompress: (bytes, { maxOutputBytes } = {}) => {
      const limit = Number.isFinite(maxOutputBytes) ? maxOutputBytes : Infinity;
      if (streaming) return decompressBounded(module, bytes, limit);
      // A build without the streaming classes: the bound can only be checked
      // after the fact, which is late, but still not never.
      const out = module.decompress(bytes);
      if (out.length > limit) throw tooLarge(limit);
      return out;
    },
  };
}
