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

function lsGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export const GLYPH_ADDRESS =
  import.meta.env.VITE_GLYPH_ADDRESS || '0xYourGlyphContractAddress';

export const RPC_URL =
  lsGet(KEY_RPC) ||
  import.meta.env.VITE_RPC_URL ||
  'https://ethereum-rpc.publicnode.com';

export const CHAIN_ID = Number(
  lsGet(KEY_CHAIN) || import.meta.env.VITE_CHAIN_ID || 1,
);

export const STORAGE_KEYS = { RPC: KEY_RPC, CHAIN: KEY_CHAIN };

/** Persist a custom RPC URL + chain ID and reload so all viem clients pick it up. */
export function saveEndpointConfig({ rpcUrl, chainId }) {
  try {
    if (rpcUrl) localStorage.setItem(KEY_RPC, rpcUrl);
    else localStorage.removeItem(KEY_RPC);
    if (chainId) localStorage.setItem(KEY_CHAIN, String(chainId));
    else localStorage.removeItem(KEY_CHAIN);
  } catch {
    // swallow — quota / disabled
  }
  if (typeof window !== 'undefined') window.location.reload();
}
