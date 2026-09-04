// imageLedger.js — images this browser has already paid to put on chain.
//
// An image is its own transaction, and a big one: tens of thousands of bytes
// of calldata, dollars rather than cents. Nothing about the design stops the
// same bytes being sent twice — a photo reused in a second post, a draft
// republished after an edit — and the second transaction buys a copy of
// something already there.
//
// So the bytes are hashed after processing and the resulting transaction is
// remembered against that hash, per chain. Next time the same image comes
// round, the reference points at the copy already on chain and nothing is
// sent. This is a local convenience, not a protocol: another browser has its
// own ledger and simply pays once itself, and clearing site data costs one
// duplicate transaction, never correctness.

const KEY = 'glyph.images.v1';

/** Entries kept per chain. A prolific writer's whole history, and then some. */
export const LEDGER_MAX = 500;

/** The SHA-256 of some bytes, as lowercase hex. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {}; // corrupted entry — one duplicate transaction, not a broken page
  }
}

function write(ledger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    /* quota / privacy mode — reuse just stops working */
  }
}

/**
 * The transaction holding these bytes on `chainId`, or null.
 * A hash is only ever answered for the chain it was published on: the same
 * image on Taiko is a different transaction, and pointing at Ethereum's would
 * give readers a reference their node cannot resolve.
 */
export function knownImage(chainId, hash) {
  const forChain = read()[String(Number(chainId))];
  const txHash = forChain?.[hash];
  return typeof txHash === 'string' ? txHash : null;
}

/** Remember that these bytes are on `chainId` in `txHash`. */
export function rememberImage(chainId, hash, txHash) {
  if (!hash || !txHash) return;
  const ledger = read();
  const id = String(Number(chainId));
  // Re-inserted rather than updated in place, so the newest entries are the
  // last ones — which is what the trim below keeps.
  const forChain = { ...(ledger[id] ?? {}) };
  delete forChain[hash];
  forChain[hash] = txHash;
  const keys = Object.keys(forChain);
  if (keys.length > LEDGER_MAX) {
    for (const old of keys.slice(0, keys.length - LEDGER_MAX)) delete forChain[old];
  }
  ledger[id] = forChain;
  write(ledger);
}

/** Forget everything. Costs one duplicate transaction per image, no more. */
export function clearImageLedger() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
