// chain.js — one viem public client per chain, over an ordered endpoint list.
//
// The web app's transport (webapp/src/lib/transport.js) puts a failed
// endpoint on a cool-down, because a browser tab makes hundreds of requests
// over its life and must not pay a timeout for a dead node on every one of
// them. A command-line run is one short errand, so there is nothing to
// remember: try each endpoint in order, take the first answer, and if they
// all refuse, report the last refusal. That is the whole of the failover
// here, and it is deliberately less machinery than the app's.

import { createPublicClient, custom, http } from 'viem';
import { getChain } from './shared.js';
import { errorText } from './out.js';

/**
 * A public endpoint is either quick or not coming. Eight seconds is what the
 * app allows too, and a one-shot tool that hangs is worse than one that moves
 * on to the next endpoint.
 */
const TIMEOUT_MS = 8_000;

/**
 * Walk `urls` in the order given. viem's own `fallback` transport restarts at
 * the first endpoint for every request and applies its own retry policy on
 * top; this is the plain reading of "in order", which is what `--rpc` means.
 *
 * Exported because the wallet signs over the same endpoints the reads use —
 * a publish that reads its nonce from one node and broadcasts to another is
 * a race nobody asked for.
 */
export function orderedTransport(urls, chain) {
  const nodes = urls.map((url) => ({
    url,
    request: http(url, { timeout: TIMEOUT_MS, retryCount: 0 })({ chain }).request,
  }));
  return custom({
    async request(args) {
      let lastError;
      for (const node of nodes) {
        try {
          return await node.request(args);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError ?? new Error('no endpoints to try');
    },
  });
}

/**
 * The client for `chainId` over `urls` (already resolved by args.js, so this
 * function never consults the registry for endpoints — only for the chain
 * object viem wants for encoding and for the wallet's chain check).
 */
export function createClient(chainId, urls) {
  const chain = getChain(chainId);
  return createPublicClient({
    chain: chain.viem,
    transport: orderedTransport(urls, chain.viem),
  });
}

/**
 * Run `fn` and label whatever goes wrong with the chain it went wrong on.
 * With `--chain all` in play, "HTTP request failed" on its own tells the
 * reader nothing about which of the two chains is down.
 */
export async function onChain(chainName, fn) {
  try {
    return await fn();
  } catch (err) {
    err.message = `${chainName}: ${errorText(err)}`;
    throw err;
  }
}
