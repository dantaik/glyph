// transport.js — ordered RPC failover.
//
// The endpoint list is the user's preference order: the first one is used,
// the next one covers for it when it fails. viem's own `fallback` restarts
// at the first endpoint on EVERY request with no memory of health, so a dead
// or rate-limited primary taxes every single call with a full timeout. This
// keeps the order but puts a failed endpoint on a short cool-down, so one bad
// node costs one round trip, not one per request.
//
// The distinction that matters: a NODE failure (network, timeout, HTTP error,
// rate limit) means try someone else and remember it briefly. An ANSWER the
// node gave — "range too large", a revert — is not a failure of the node; we
// still try the next endpoint in case it is more permissive, but nothing is
// held against this one, and the last error propagates so callers (the feed
// sweep) can react to it.

import { custom, http } from 'viem';
import * as rpcLog from './rpcLog';

/** How long a failed endpoint is skipped before it is tried first again. */
const COOLDOWN_MS = 30_000;
const TIMEOUT_MS = 8_000;

/**
 * Walk a viem error chain for a transport-level failure — the node could not
 * be reached, timed out, or is rate-limiting. A JSON-RPC error RESPONSE
 * (method not supported, range too large) is not this: the node answered, so
 * it stays in rotation and only this request moves on.
 */
function isNodeFailure(err) {
  const hit = (e) =>
    e?.name === 'HttpRequestError' || e?.name === 'TimeoutError' || e?.status === 429;
  const found = typeof err?.walk === 'function' ? err.walk(hit) : hit(err) ? err : null;
  if (found) return true;
  const msg = String(err?.details || err?.shortMessage || err?.message || '');
  return /rate limit|429|too many requests|fetch failed|timed? ?out/i.test(msg);
}

/**
 * A transport that walks `urls` in order, skipping endpoints still cooling
 * off from a recent failure.
 */
export function orderedFallback(urls, chain) {
  const nodes = urls.map((url) => ({
    url,
    request: http(url, { timeout: TIMEOUT_MS, retryCount: 0 })({ chain }).request,
    downUntil: 0,
  }));

  return custom({
    async request(args) {
      const now = Date.now();
      // Preferred order first, then anything still cooling off — a cooling
      // endpoint is a last resort, never simply dropped.
      const ready = nodes.filter((n) => n.downUntil <= now);
      const cooling = nodes.filter((n) => n.downUntil > now);
      const order = [...ready, ...cooling];
      let lastError;
      for (let i = 0; i < order.length; i++) {
        const node = order[i];
        try {
          const out = await node.request(args);
          node.downUntil = 0;
          return out;
        } catch (err) {
          lastError = err;
          const failed = isNodeFailure(err);
          if (failed) node.downUntil = Date.now() + COOLDOWN_MS;
          if (i < order.length - 1) {
            rpcLog.endpointFailed(node.url, args.method, err, {
              cooled: failed,
              next: order[i + 1].url,
            });
          }
        }
      }
      throw lastError;
    },
  });
}
