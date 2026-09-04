// limits.js — the per-transaction byte ceilings, and nothing else.
//
// A module with no imports at all, so that plain Node — the command-line
// tool, the e2e mock node — can read the same numbers the app enforces
// without pulling in the browser publish pipeline.

/**
 * Per-transaction byte ceiling. NOT a consensus rule: geth's transaction
 * pool rejects anything whose encoded size exceeds txMaxSize (4 × 32 KiB)
 * with "oversized data", and every public endpoint runs that default — so
 * it binds long before EIP-7825's 16,777,216 gas cap (~409 KB of calldata,
 * the figure in the spec's constants table).
 */
export const MAX_TX_BYTES = 131_072;

/**
 * What's left for calldata once the transaction envelope is accounted for
 * (signature, nonce, gas fields, and for publish() the selector + title +
 * ABI offset/length header). Generous on purpose — being a kilobyte
 * conservative costs nothing, and guessing high costs a rejected send.
 */
export const MAX_CALLDATA_BYTES = MAX_TX_BYTES - 1_024;
