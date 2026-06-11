// Lazy brotli WASM initializer.
// brotli-wasm exports a default function that returns the WASM module on first call.
// We cache the module so it's reused across reader and publisher.

/** @type {import('brotli-wasm').BrotliWasmType | null} */
let brotliModule = null;

/**
 * Get the brotli WASM module, initializing it on first call.
 * @returns {Promise<import('brotli-wasm').BrotliWasmType>}
 */
export async function getBrotli() {
  if (!brotliModule) {
    const init = (await import('brotli-wasm')).default;
    brotliModule = await init;
  }
  return brotliModule;
}
