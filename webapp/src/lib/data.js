// data.js — the readers, one per chain, and the DEV fixtures switch.
//
// Components get their readers from here — `getReader(chainId)`, and
// view.js composes them into the merged view — so that, in DEV,
// `?fixtures=1` / `?fixtures=empty` (or VITE_FIXTURES=1) can swap the chain
// I/O for an in-memory chain. The dynamic import sits behind a literal
// `import.meta.env.DEV` check, so production builds tree-shake fixtures.js
// away entirely (top-level await is enabled in vite.config.js).
//
// Readers live for the page: a scan one of them is running keeps going, and
// keeps caching, whatever the page shows meanwhile.

import { createReader } from './reader';

function detectFixturesMode() {
  try {
    const q = new URLSearchParams(window.location.search).get('fixtures');
    if (q === '1' || q === 'empty') return q;
  } catch {
    // non-browser context — fall through to the env flag
  }
  return import.meta.env.VITE_FIXTURES === '1' ? '1' : null;
}

/** `'1'` (demo dataset) | `'empty'` (empty-state QA) | `null` (real chain). DEV only. */
export const FIXTURES_MODE = import.meta.env.DEV ? detectFixturesMode() : null;

let makeIO = null;
if (import.meta.env.DEV && FIXTURES_MODE) {
  const { createFixtureIO } = await import('./fixtures.js');
  makeIO = (chainId) => createFixtureIO(chainId, FIXTURES_MODE);
}

const readers = new Map(); // chainId -> reader

/** The reader for `chainId`, created on first use and kept for the page. */
export function getReader(chainId) {
  const id = Number(chainId);
  let reader = readers.get(id);
  if (!reader) {
    reader = createReader(id, { makeIO });
    readers.set(id, reader);
  }
  return reader;
}

