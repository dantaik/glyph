// gas.js — what a publish will cost, without asking a node.
//
// `--dry-run` exists to answer "what would this cost?" before anything is
// signed, and it must answer offline: the whole point of a dry run is that it
// works with no key, no endpoint and no network. So the figure is computed
// from the calldata rather than from eth_estimateGas.
//
// The model is webapp/src/lib/price.js's, kept in step with it by hand
// because price.js pulls in the app's formatting layer and this package only
// imports the five modules listed in shared.js. Under EIP-7623 a data-heavy
// transaction pays the calldata floor — 40 gas a non-zero byte, 10 a zero one
// — and brotli output is very nearly all non-zero.

/** A publish() transaction's gas, for a payload of `payloadBytes` bytes. */
export function estimatePublishGas(payloadBytes, firstPost = false) {
  const padded = Math.ceil(payloadBytes / 32) * 32;
  const nonzero = 4 + 32 + payloadBytes; // selector + title + payload
  const zero = 32 + 32 + (padded - payloadBytes); // ABI offset and length slots, and the tail padding
  const calldata = nonzero * 40 + zero * 10;
  // LOG with two topics (the event signature and the indexed author) and 96
  // bytes of data: 375 + 375 × 2 + 8 × 96.
  const logCost = 1893;
  // One packed slot, read then written. A first post pays the cold access and
  // the 0 → non-zero initialisation; every post after it is warm.
  const sstore = firstPost ? 2100 + 22100 : 100 + 100;
  return 21000 + calldata + logCost + sstore;
}

/** An image is a plain self-transfer with the bytes as calldata. */
export const estimateImageGas = (imageBytes) => 21000 + imageBytes * 40;
