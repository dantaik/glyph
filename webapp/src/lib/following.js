// following.js — the authors this reader wants to keep up with.
//
// A list of addresses in this browser, and nothing more. No account, no
// server, nothing on chain: following somebody is a decision about what YOU
// read, not a fact about them, and it would be strange for it to cost gas or
// to be public. It travels in the settings file with everything else.

import { useSyncExternalStore } from 'react';
import { ADDRESS_RE } from './router';

const KEY = 'glyph.following.v1';
const KEY_SEEN = 'glyph.followingSeen.v1';

/** Window event: the followed list changed. */
export const FOLLOWING_EVT = 'glyph:following';

/** A generous ceiling; the point is to bound storage, not to ration reading. */
export const FOLLOWING_MAX = 500;

const norm = (a) => String(a ?? '').trim().toLowerCase();

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
    /* quota / privacy mode — the list just doesn't persist */
  }
}

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(FOLLOWING_EVT));
  } catch {
    /* non-browser context */
  }
}

/** The addresses followed, lower-cased, in the order they were added. */
export function getFollowing() {
  try {
    const raw = JSON.parse(lsGet(KEY) || 'null');
    const list = Array.isArray(raw?.addresses) ? raw.addresses : [];
    return [...new Set(list.map(norm).filter((a) => ADDRESS_RE.test(a)))].slice(0, FOLLOWING_MAX);
  } catch {
    return []; // corrupted entry — an empty list, not a broken page
  }
}

/** Replace the whole list (a restored settings file, or the settings page). */
export function setFollowing(addresses) {
  const clean = [...new Set((addresses ?? []).map(norm).filter((a) => ADDRESS_RE.test(a)))].slice(
    0,
    FOLLOWING_MAX,
  );
  lsSet(KEY, clean.length ? JSON.stringify({ addresses: clean }) : null);
  emit();
}

export function follow(address) {
  const a = norm(address);
  if (!ADDRESS_RE.test(a)) return;
  const list = getFollowing();
  if (list.includes(a)) return;
  setFollowing([...list, a]);
}

export function unfollow(address) {
  const a = norm(address);
  setFollowing(getFollowing().filter((x) => x !== a));
}

export const isFollowing = (address) => getFollowing().includes(norm(address));

// --- What has been seen ---------------------------------------------------
//
// The following page marks where the reader got to last time, which is only
// useful if leaving the page records it. One number: the time of the newest
// row that was on screen.

/** The time (seconds) of the newest post seen on the following page. */
export function getSeenTs() {
  const raw = Number(lsGet(KEY_SEEN));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Remember how far the reader got. Never moves backwards. */
export function setSeenTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= getSeenTs()) return;
  lsSet(KEY_SEEN, String(Math.floor(n)));
}

const subscribe = (fn) => {
  window.addEventListener(FOLLOWING_EVT, fn);
  return () => window.removeEventListener(FOLLOWING_EVT, fn);
};

// The list is read from storage on every call, so two reads in a row are
// different arrays and `useSyncExternalStore` would loop. The snapshot is
// therefore the joined string, and the hook turns it back into a list.
const snapshot = () => getFollowing().join(',');

/** React hook: the followed addresses; re-renders when they change. */
export function useFollowing() {
  const joined = useSyncExternalStore(subscribe, snapshot, () => '');
  return joined ? joined.split(',') : [];
}
