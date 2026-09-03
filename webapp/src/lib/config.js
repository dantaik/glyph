// config.js — runtime configuration: which chain is being read, and how to
// reach it.
//
// Resolution order for the active chain and its RPC endpoints:
//   1. localStorage (set from the chain menu / settings page)
//   2. Vite env vars (VITE_CHAIN_ID, VITE_RPC_URL)
//   3. the chain registry's defaults (chains.js)
//
// The active chain is live state, not a constant. Switching it re-renders
// the app in place: nothing reloads and nothing running is interrupted — a
// scan started on the previous chain keeps its own client and store and
// finishes in the background (see reader.js), and what it finds is cached
// under that chain, ready for the next visit.
//
// Each chain keeps its OWN ordered list of endpoints: the reader tries the
// first and falls back to the next when one fails, so a flaky public node
// degrades instead of breaking the page.
//
// GLYPH_ADDRESS is env-only — it identifies the deployed contract and
// shouldn't be user-tunable. CREATE2 puts it at the same address everywhere,
// which is why one address serves every chain here.

import { useSyncExternalStore } from 'react';
import { DEFAULT_CHAIN_ID, defaultRpcs, isKnownChain } from './chains';

const KEY_CHAIN = 'glyph.chainId.v1';
const KEY_RPCS = 'glyph.rpcs.v1'; // { [chainId]: string[] }
const KEY_RPC_LEGACY = 'glyph.rpc.v1'; // one URL, before per-chain lists
const KEY_CACHE_TTL = 'glyph.cacheTtl.v1';

/** Window event: the active chain changed. */
export const CHAIN_EVT = 'glyph:chain';
/** Window event: some chain's endpoint list changed. */
export const RPCS_EVT = 'glyph:rpcs';

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

function emit(name) {
  try {
    window.dispatchEvent(new CustomEvent(name));
  } catch {
    /* non-browser context */
  }
}

const subscribeTo = (name) => (callback) => {
  window.addEventListener(name, callback);
  return () => window.removeEventListener(name, callback);
};

export const GLYPH_ADDRESS =
  import.meta.env.VITE_GLYPH_ADDRESS || '0xYourGlyphContractAddress';

/** False until VITE_GLYPH_ADDRESS names a deployed contract. */
export const CONTRACT_CONFIGURED = GLYPH_ADDRESS !== '0xYourGlyphContractAddress';

/** The chain the env vars describe (VITE_RPC_URL applies to this one). */
const ENV_CHAIN_ID = (() => {
  const fromEnv = Number(import.meta.env.VITE_CHAIN_ID);
  return isKnownChain(fromEnv) ? fromEnv : DEFAULT_CHAIN_ID;
})();

function resolveStoredChain() {
  const stored = Number(lsGet(KEY_CHAIN));
  return isKnownChain(stored) ? stored : ENV_CHAIN_ID;
}

// --- Active chain -------------------------------------------------------

let activeChainId = resolveStoredChain();

/** The chain currently being read. */
export const getActiveChainId = () => activeChainId;

/**
 * Switch the chain being read. Persists the choice and lets every
 * subscriber re-render; no reload — see the file comment.
 */
export function setActiveChain(chainId) {
  const id = Number(chainId);
  if (!isKnownChain(id) || id === activeChainId) return;
  activeChainId = id;
  lsSet(KEY_CHAIN, String(id));
  emit(CHAIN_EVT);
}

const subscribeChain = subscribeTo(CHAIN_EVT);

/** React hook: the chain currently being read; re-renders on switch. */
export function useActiveChainId() {
  return useSyncExternalStore(subscribeChain, getActiveChainId, getActiveChainId);
}

// --- RPC endpoints -------------------------------------------------------

const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u).trim());

function readRpcMap() {
  try {
    const v = JSON.parse(lsGet(KEY_RPCS) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {}; // corrupted entry — fall back to the defaults
  }
}

/** Bumped whenever any endpoint list changes; clients rebuild against it. */
let rpcVersion = 0;
export const getRpcVersion = () => rpcVersion;

const subscribeRpcs = subscribeTo(RPCS_EVT);

/** React hook: a counter that changes whenever endpoint lists do. */
export function useRpcVersion() {
  return useSyncExternalStore(subscribeRpcs, getRpcVersion, getRpcVersion);
}

/**
 * The ordered endpoints for `chainId`: the user's list when they have one,
 * otherwise the registry defaults (with VITE_RPC_URL taking the lead on the
 * env-configured chain, so an env-configured node still wins).
 */
export function getRpcUrls(chainId) {
  const stored = readRpcMap()[String(chainId)];
  const list = Array.isArray(stored) ? stored.filter(isHttpUrl) : [];
  if (list.length > 0) return list;
  const defaults = defaultRpcs(chainId);
  const fromEnv = import.meta.env.VITE_RPC_URL;
  if (Number(chainId) === ENV_CHAIN_ID && isHttpUrl(fromEnv || '')) {
    return [fromEnv, ...defaults.filter((u) => u !== fromEnv)];
  }
  return defaults;
}

/** True when the user has edited this chain's endpoint list. */
export const hasCustomRpcs = (chainId) => {
  const stored = readRpcMap()[String(chainId)];
  return Array.isArray(stored) && stored.length > 0;
};

/**
 * Replace one chain's endpoint list. An empty list restores the defaults.
 * Takes effect at the next request: clients are looked up per call and
 * rebuilt when this changes, so even a sweep already in flight moves to the
 * new list at its next window.
 */
export function saveRpcUrls(chainId, urls) {
  const clean = (urls ?? []).map((u) => String(u).trim()).filter(isHttpUrl);
  const map = readRpcMap();
  if (clean.length === 0) delete map[String(chainId)];
  else map[String(chainId)] = clean;
  lsSet(KEY_RPCS, Object.keys(map).length ? JSON.stringify(map) : null);
  lsSet(KEY_RPC_LEGACY, null); // superseded by the per-chain list
  rpcVersion += 1;
  emit(RPCS_EVT);
}

// --- Read cache TTL ------------------------------------------------------

/** Cache TTL in ms for repeat chain reads (0 = no caching). Default 1 min. */
export function getCacheTtlMs() {
  const raw = lsGet(KEY_CACHE_TTL);
  const minutes = raw == null ? 1 : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 1) * 60_000;
}

export function saveCacheTtl(minutes) {
  const n = Number(minutes);
  lsSet(KEY_CACHE_TTL, Number.isFinite(n) && n >= 0 ? String(n) : null);
}

// --- Reset ---------------------------------------------------------------

/** Forget every stored preference and go back to the built-in defaults. */
export function resetEndpointConfig() {
  lsSet(KEY_CHAIN, null);
  lsSet(KEY_RPCS, null);
  lsSet(KEY_RPC_LEGACY, null);
  lsSet(KEY_CACHE_TTL, null);
  rpcVersion += 1;
  emit(RPCS_EVT);
  const next = resolveStoredChain();
  if (next !== activeChainId) {
    activeChainId = next;
    emit(CHAIN_EVT);
  }
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
  map[String(activeChainId)] = [
    legacy,
    ...defaultRpcs(activeChainId).filter((u) => u !== legacy),
  ];
  lsSet(KEY_RPCS, JSON.stringify(map));
  lsSet(KEY_RPC_LEGACY, null);
})();
