// clients.js — one viem client per chain, over that chain's endpoints.
//
// Clients are looked up per request, never held: a lookup after the user
// edits a chain's endpoint list returns a client built over the new list,
// so even a sweep already in flight moves to the new endpoints at its next
// window. See transport.js for how failover and cool-down work.

import { createPublicClient } from 'viem';
import { getChain } from './chains';
import { getRpcUrls, getRpcVersion } from './config';
import { orderedFallback } from './transport';
import * as rpcLog from './rpcLog';

const clients = new Map(); // chainId -> { version, client }

/** The public client for `chainId`, over its current endpoint list. */
export function getClient(chainId) {
  const id = Number(chainId);
  const version = getRpcVersion();
  const hit = clients.get(id);
  if (hit && hit.version === version) return hit.client;
  const chain = getChain(id);
  const urls = getRpcUrls(id);
  const client = createPublicClient({
    chain: chain.viem,
    transport: orderedFallback(urls, chain.viem, chain.name),
  });
  rpcLog.scoped(chain.name).endpoints(urls);
  clients.set(id, { version, client });
  return client;
}
