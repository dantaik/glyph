// config.js — runtime configuration: which chains are read, which one is
// written to, and how to reach them.
//
// The chains READ are all of them (READ_CHAIN_IDS) — the reader shows every
// deployed chain at once, and a URL naming one chain is a filter over that,
// not a setting (router.js). The chain WRITTEN to is a preference: the
// publish chain, chosen in the write tab, persisted here.
//
// Resolution order for RPC endpoints:
//   1. localStorage (set from the settings page)
//   2. Vite env vars (VITE_CHAIN_ID, VITE_RPC_URL)
//   3. the chain registry's defaults (chains.js)
//
// Endpoint lists are live state: saving one re-renders in place and even a
// scan already running moves to the new endpoints at its next request.
//
// Each chain keeps its OWN ordered list of endpoints: the reader tries the
// first and falls back to the next when one fails, so a flaky public node
// degrades instead of breaking the page.
//
// GLYPH_ADDRESS identifies the deployed contract and isn't user-tunable.
// CREATE2 puts it at the same address on every chain, so it is a constant,
// not configuration: the deployed address is the built-in default and the
// app works out of the box on any host. VITE_GLYPH_ADDRESS overrides it only
// for a private redeploy (a changed Blog.sol yields a different address).

import { useSyncExternalStore } from 'react';
import { DEFAULT_CHAIN_ID, SELECTABLE_CHAIN_IDS, defaultRpcs, isKnownChain } from './chains';

const KEY_CHAIN = 'glyph.chainId.v1'; // the active chain, before every chain was read at once
const KEY_PUBLISH_CHAIN = 'glyph.publishChain.v1';
const KEY_RPCS = 'glyph.rpcs.v1'; // { [chainId]: string[] }
const KEY_RPC_LEGACY = 'glyph.rpc.v1'; // one URL, before per-chain lists
const KEY_RESCAN_DELAY = 'glyph.rescanDelay.v1';
const KEY_CACHE_TTL_LEGACY = 'glyph.cacheTtl.v1'; // the same number, when it still meant a cache TTL

/** Window event: the publish chain changed. */
export const PUBLISH_CHAIN_EVT = 'glyph:publishChain';
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

/** The canonical CREATE2 deployment — identical on every EVM chain. */
export const DEFAULT_GLYPH_ADDRESS = '0x000000AE2f2249c497cfc5F262dd1491634C361C';

export const GLYPH_ADDRESS = import.meta.env.VITE_GLYPH_ADDRESS || DEFAULT_GLYPH_ADDRESS;

/** The chain the env vars describe (VITE_RPC_URL applies to this one). */
const ENV_CHAIN_ID = (() => {
  const fromEnv = Number(import.meta.env.VITE_CHAIN_ID);
  return isKnownChain(fromEnv) ? fromEnv : DEFAULT_CHAIN_ID;
})();

// --- The chains read -------------------------------------------------------

/**
 * Every chain the reader shows at once. The deployed mainnets — unless the
 * build points VITE_CHAIN_ID at some other known chain (a private redeploy
 * on a testnet), which is then the only one.
 */
export const READ_CHAIN_IDS =
  SELECTABLE_CHAIN_IDS.includes(ENV_CHAIN_ID) ? [...SELECTABLE_CHAIN_IDS] : [ENV_CHAIN_ID];

export const isReadChain = (id) => READ_CHAIN_IDS.includes(Number(id));

// --- The chain written to ----------------------------------------------------

/** The stored publish chain, or null when none was ever picked. */
export function getPublishChainId() {
  const stored = Number(lsGet(KEY_PUBLISH_CHAIN));
  return isKnownChain(stored) ? stored : null;
}

/** Remember the chain to publish on (null forgets it). */
export function savePublishChainId(chainId) {
  const id = chainId == null ? null : Number(chainId);
  if (id != null && !isKnownChain(id)) return;
  lsSet(KEY_PUBLISH_CHAIN, id == null ? null : String(id));
  emit(PUBLISH_CHAIN_EVT);
}

const subscribePublishChain = subscribeTo(PUBLISH_CHAIN_EVT);

/** React hook: the stored publish chain (null when none); re-renders on change. */
export function usePublishChainId() {
  return useSyncExternalStore(subscribePublishChain, getPublishChainId, getPublishChainId);
}

/**
 * The chain to publish on: the one picked, else the wallet's own chain when
 * it is one Glyph is read on, else the default. Pure, so the write tab and
 * its tests agree.
 */
export function resolvePublishChain(stored, walletChainId) {
  if (stored != null && isKnownChain(stored)) return Number(stored);
  if (walletChainId != null && isReadChain(walletChainId)) return Number(walletChainId);
  return DEFAULT_CHAIN_ID;
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

// --- Rescan delay --------------------------------------------------------
//
// How long a completed scan stays good for. Opening the home feed (or an
// author page) within `last scan finished + delay` shows what that scan
// found instead of going back to the node; after it, the next visit sweeps
// the blocks mined in between. Nothing is ever skipped — a delay only
// decides WHEN the newest blocks are read, never whether.
//
// This is not a cache lifetime: what a scan reads is immutable and is kept
// for good (see reader.js). 0 = rescan on every visit.

/** Minimum time between chain scans, in ms. Default 1 minute. */
export function getRescanDelayMs() {
  const raw = lsGet(KEY_RESCAN_DELAY) ?? lsGet(KEY_CACHE_TTL_LEGACY);
  const minutes = raw == null ? 1 : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 1) * 60_000;
}

export function saveRescanDelay(minutes) {
  const n = Number(minutes);
  lsSet(KEY_RESCAN_DELAY, Number.isFinite(n) && n >= 0 ? String(n) : null);
  lsSet(KEY_CACHE_TTL_LEGACY, null);
}

/**
 * How long the two reads that DO change on-chain are held: the head block
 * (behind every "about N hours ago") and an author's post count. Short, fixed, and
 * not worth a setting — unlike a scan, these are one cheap call each.
 */
export const VOLATILE_TTL_MS = 60_000;

// --- Reset ---------------------------------------------------------------

/** Forget every stored preference and go back to the built-in defaults. */
export function resetEndpointConfig() {
  lsSet(KEY_CHAIN, null);
  lsSet(KEY_PUBLISH_CHAIN, null);
  lsSet(KEY_RPCS, null);
  lsSet(KEY_RPC_LEGACY, null);
  lsSet(KEY_RESCAN_DELAY, null);
  lsSet(KEY_CACHE_TTL_LEGACY, null);
  rpcVersion += 1;
  emit(RPCS_EVT);
  emit(PUBLISH_CHAIN_EVT);
}

export function hasOverrides() {
  return Boolean(
    lsGet(KEY_PUBLISH_CHAIN) || lsGet(KEY_RPCS) || lsGet(KEY_RESCAN_DELAY) || lsGet(KEY_CACHE_TTL_LEGACY),
  );
}

// One-time migration: a single stored RPC URL becomes the first entry of the
// env chain's list, ahead of the registry defaults that now back it up.
(function migrateLegacyRpc() {
  const legacy = lsGet(KEY_RPC_LEGACY);
  if (!legacy || lsGet(KEY_RPCS)) return;
  if (!isHttpUrl(legacy)) {
    lsSet(KEY_RPC_LEGACY, null);
    return;
  }
  const map = {};
  map[String(ENV_CHAIN_ID)] = [
    legacy,
    ...defaultRpcs(ENV_CHAIN_ID).filter((u) => u !== legacy),
  ];
  lsSet(KEY_RPCS, JSON.stringify(map));
  lsSet(KEY_RPC_LEGACY, null);
})();
