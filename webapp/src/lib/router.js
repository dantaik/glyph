// router.js — tiny URL-state hook. No deps.
//
// Reads and writes `window.location.search` as a key/value map. Components
// re-render on popstate (back / forward) and on programmatic navigate().

import { useEffect, useState, useCallback } from 'react';

function readParams() {
  if (typeof window === 'undefined') return {};
  const sp = new URLSearchParams(window.location.search);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

export function useUrlState() {
  const [params, setParams] = useState(readParams);

  useEffect(() => {
    const onPop = () => setParams(readParams());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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
    setParams(readParams());
  }, []);

  return [params, navigate];
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
