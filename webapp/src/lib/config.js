// config.js — runtime configuration.
//
// Resolution order for the RPC URL / chain ID:
//   1. localStorage (set via the Settings modal)
//   2. Vite env vars (VITE_RPC_URL, VITE_CHAIN_ID)
//   3. hard-coded default
//
// GLYPH_ADDRESS is env-only — it identifies the deployed contract and
// shouldn't be user-tunable.

const KEY_RPC = 'glyph.rpc.v1';
const KEY_CHAIN = 'glyph.chainId.v1';
const KEY_CACHE_TTL = 'glyph.cacheTtl.v1';

function lsGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export const GLYPH_ADDRESS =
  import.meta.env.VITE_GLYPH_ADDRESS || '0xYourGlyphContractAddress';

// Default public endpoint: dRPC supports eth_getLogs (needed by the home
// feed and author pages); publicnode.com rejects getLogs without a paid
// token ('Archive requests require a personal token').
export const RPC_URL =
  lsGet(KEY_RPC) ||
  import.meta.env.VITE_RPC_URL ||
  'https://eth.drpc.org';

export const CHAIN_ID = Number(
  lsGet(KEY_CHAIN) || import.meta.env.VITE_CHAIN_ID || 1,
);

export const STORAGE_KEYS = { RPC: KEY_RPC, CHAIN: KEY_CHAIN, CACHE_TTL: KEY_CACHE_TTL };

/** Cache TTL in ms for repeat chain reads (0 = no caching). Default 1 min. */
export function getCacheTtlMs() {
  const raw = lsGet(KEY_CACHE_TTL);
  const minutes = raw == null ? 1 : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 1) * 60_000;
}

/** Persist RPC URL / chain ID / cache TTL and reload so everything picks it up. */
export function saveEndpointConfig({ rpcUrl, chainId, cacheTtl }) {
  try {
    if (rpcUrl) localStorage.setItem(KEY_RPC, rpcUrl);
    else localStorage.removeItem(KEY_RPC);
    if (chainId) localStorage.setItem(KEY_CHAIN, String(chainId));
    else localStorage.removeItem(KEY_CHAIN);
    if (cacheTtl != null) localStorage.setItem(KEY_CACHE_TTL, String(cacheTtl));
    else localStorage.removeItem(KEY_CACHE_TTL);
  } catch {
    // swallow — quota / disabled
  }
  if (typeof window !== 'undefined') window.location.reload();
}
