// router.js — tiny URL-state hook. No deps.
//
// Reads and writes `window.location.search` as a key/value map. The state
// lives at module level and every hook instance subscribes to the same
// updates, so a navigate() from ANY component (Header, Reader, …) re-renders
// all of them — history.replaceState fires no popstate, so a per-instance
// state would silently drift apart.

import { useEffect, useState, useCallback } from 'react';

const EVT = 'cairn:urlstate';

function readParams() {
  if (typeof window === 'undefined') return {};
  const sp = new URLSearchParams(window.location.search);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

let state = readParams();

export function useUrlState() {
  const [, force] = useState(0);

  useEffect(() => {
    const sync = () => {
      state = readParams();
      force((n) => n + 1);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(EVT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVT, sync);
    };
  }, []);

  const navigate = useCallback((next, { replace = false } = {}) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v != null && v !== '') sp.set(k, String(v));
    }
    const search = sp.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    state = readParams();
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return [state, navigate];
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
