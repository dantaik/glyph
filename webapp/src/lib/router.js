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
  // Path deep links: /tx/0x<hash> → tx; /author/0x<addr> → author.
  const mTx = window.location.pathname.match(/^\/tx\/(0x[0-9a-fA-F]{64})\/?$/);
  if (mTx) out.tx = mTx[1];
  const mAuthor = window.location.pathname.match(/^\/author\/(0x[0-9a-fA-F]{40})\/?$/);
  if (mAuthor) {
    out.author = mAuthor[1];
  } else if (out.author) {
    out.authorFromQuery = true; // legacy ?author= link
  }
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
      // `tx` and `author` live in the path (/tx/<hash>, /author/<addr>),
      // never in the query string.
      if (k === 'tx' || k === 'author') continue;
      if (v != null && v !== '') sp.set(k, String(v));
    }
    // Dev demo mode (fixtures) follows in-app navigation.
    if (next.fixtures == null && state.fixtures) sp.set('fixtures', state.fixtures);
    const search = sp.toString();
    // Deep links use their paths; everything else is the root path
    // with query params.
    const path = next.tx ? `/tx/${next.tx}` : next.author ? `/author/${next.author}` : '/';
    const url = `${path}${search ? `?${search}` : ''}`;
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    state = readParams();
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return [state, navigate];
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
