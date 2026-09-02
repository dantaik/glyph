// config.js — runtime configuration: which chain, and how to reach it.
//
// Resolution order for the active chain and its RPC endpoints:
//   1. localStorage (set on the settings page)
//   2. Vite env vars (VITE_CHAIN_ID, VITE_RPC_URL)
//   3. the chain registry's defaults (chains.js)
//
// Each chain keeps its OWN ordered list of endpoints: the reader tries the
// first and falls back to the next when one fails, so a flaky public node
// degrades instead of breaking the page.
//
// GLYPH_ADDRESS is env-only — it identifies the deployed contract and
// shouldn't be user-tunable. CREATE2 puts it at the same address everywhere,
// which is why one address serves every chain here.

import {
  DEFAULT_CHAIN_ID,
  defaultRpcs,
  getChain,
  isKnownChain,
  logWindow,
} from './chains';

const KEY_CHAIN = 'glyph.chainId.v1';
const KEY_RPCS = 'glyph.rpcs.v1'; // { [chainId]: string[] }
const KEY_RPC_LEGACY = 'glyph.rpc.v1'; // one URL, before per-chain lists
const KEY_CACHE_TTL = 'glyph.cacheTtl.v1';

export const STORAGE_KEYS = {
  CHAIN: KEY_CHAIN,
  RPCS: KEY_RPCS,
  CACHE_TTL: KEY_CACHE_TTL,
};

function lsGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // quota / privacy mode — the setting just doesn't persist
  }
}

export const GLYPH_ADDRESS =
  import.meta.env.VITE_GLYPH_ADDRESS || '0xYourGlyphContractAddress';

/** The chain currently being read. Env is the fallback, the registry the floor. */
export const CHAIN_ID = (() => {
  const stored = Number(lsGet(KEY_CHAIN));
  if (isKnownChain(stored)) return stored;
  const fromEnv = Number(import.meta.env.VITE_CHAIN_ID);
  if (isKnownChain(fromEnv)) return fromEnv;
  return DEFAULT_CHAIN_ID;
})();

/** The viem chain object for the active chain. */
export const CHAIN = getChain(CHAIN_ID);

const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u).trim());

function readRpcMap() {
  try {
    const v = JSON.parse(lsGet(KEY_RPCS) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {}; // corrupted entry — fall back to the defaults
  }
}

/**
 * The ordered endpoints for `chainId`: the user's list when they have one,
 * otherwise the registry defaults (with VITE_RPC_URL taking the lead on the
 * active chain, so an env-configured node still wins).
 */
export function getRpcUrls(chainId = CHAIN_ID) {
  const stored = readRpcMap()[String(chainId)];
  const list = Array.isArray(stored) ? stored.filter(isHttpUrl) : [];
  if (list.length > 0) return list;
  const defaults = defaultRpcs(chainId);
  const fromEnv = import.meta.env.VITE_RPC_URL;
  if (chainId === CHAIN_ID && isHttpUrl(fromEnv || '')) {
    return [fromEnv, ...defaults.filter((u) => u !== fromEnv)];
  }
  return defaults;
}

/** True when the user has edited this chain's endpoint list. */
export const hasCustomRpcs = (chainId) => {
  const stored = readRpcMap()[String(chainId)];
  return Array.isArray(stored) && stored.length > 0;
};

/** Endpoints for the active chain, in preference order. */
export const RPC_URLS = getRpcUrls(CHAIN_ID);

/** Blocks per getLogs window on the active chain (the sweep shrinks it if
 *  the answering node caps ranges lower). */
export const LOG_WINDOW = logWindow(CHAIN_ID);

/** Cache TTL in ms for repeat chain reads (0 = no caching). Default 1 min. */
export function getCacheTtlMs() {
  const raw = lsGet(KEY_CACHE_TTL);
  const minutes = raw == null ? 1 : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 1) * 60_000;
}

function reload() {
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * Replace one chain's endpoint list. An empty list restores the defaults.
 * Reloads only when the active chain's own endpoints changed — the viem
 * client is built once at module load.
 */
export function saveRpcUrls(chainId, urls, { reloadPage = true } = {}) {
  const clean = (urls ?? []).map((u) => String(u).trim()).filter(isHttpUrl);
  const map = readRpcMap();
  if (clean.length === 0) delete map[String(chainId)];
  else map[String(chainId)] = clean;
  lsSet(KEY_RPCS, Object.keys(map).length ? JSON.stringify(map) : null);
  lsSet(KEY_RPC_LEGACY, null); // superseded by the per-chain list
  if (reloadPage && Number(chainId) === CHAIN_ID) reload();
}

/** Switch the chain being read, then reload so every client picks it up. */
export function setActiveChain(chainId) {
  if (!isKnownChain(chainId)) return;
  lsSet(KEY_CHAIN, String(chainId));
  reload();
}

export function saveCacheTtl(minutes) {
  const n = Number(minutes);
  lsSet(KEY_CACHE_TTL, Number.isFinite(n) && n >= 0 ? String(n) : null);
}

/** Forget every stored preference and reload with the built-in defaults. */
export function resetEndpointConfig() {
  lsSet(KEY_CHAIN, null);
  lsSet(KEY_RPCS, null);
  lsSet(KEY_RPC_LEGACY, null);
  lsSet(KEY_CACHE_TTL, null);
  reload();
}

export function hasOverrides() {
  return Boolean(lsGet(KEY_CHAIN) || lsGet(KEY_RPCS) || lsGet(KEY_CACHE_TTL));
}

// One-time migration: a single stored RPC URL becomes the first entry of the
// active chain's list, ahead of the registry defaults that now back it up.
(function migrateLegacyRpc() {
  const legacy = lsGet(KEY_RPC_LEGACY);
  if (!legacy || lsGet(KEY_RPCS)) return;
  if (!isHttpUrl(legacy)) {
    lsSet(KEY_RPC_LEGACY, null);
    return;
  }
  const map = {};
  map[String(CHAIN_ID)] = [legacy, ...defaultRpcs(CHAIN_ID).filter((u) => u !== legacy)];
  lsSet(KEY_RPCS, JSON.stringify(map));
  lsSet(KEY_RPC_LEGACY, null);
})();
