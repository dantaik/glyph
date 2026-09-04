// base64.js — bytes to text and back, without a dependency.
//
// The archive format is one plain JSON file, so its images have to be text.
// `btoa` and `atob` are the only encoders every browser has had forever, and
// Node 22 has them too — which matters, because the command-line tool writes
// bundles the browser must read byte for byte.
//
// The chunking is not an optimisation: `String.fromCharCode(...bytes)` on a
// large image blows the argument limit and throws, and a 40 KB WebP is
// already past what some engines accept.

/** How many bytes are turned into characters at a time. */
const CHUNK = 0x8000;

/** Base64 for a byte array. */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The bytes a base64 string stands for, or null when it is not base64. */
export function base64ToBytes(text) {
  try {
    const binary = atob(String(text ?? '').trim());
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
