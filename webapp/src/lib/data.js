// data.js — single data facade for all chain reads.
//
// Components import from here instead of blogReader.js so that, in DEV,
// `?fixtures=1` / `?fixtures=empty` (or VITE_FIXTURES=1) swaps every chain
// call for deterministic in-memory fixtures. The dynamic import below sits
// behind a literal `import.meta.env.DEV` check, so production builds
// tree-shake fixtures.js away entirely (top-level await is enabled in
// vite.config.js).

import * as reader from './blogReader';
import { GLYPH_ADDRESS } from './config';

const CLOCK_TTL_MS = 60_000;

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

// --- Chain helpers layered on top of the blogReader surface ---

function getAuthorCountReal(author) {
  return reader.client.readContract({
    address: GLYPH_ADDRESS,
    abi: reader.abi,
    functionName: 'count',
    args: [author],
  });
}

let clockCache = { at: 0, promise: null };

function getChainClockReal() {
  const now = Date.now();
  if (clockCache.promise && now - clockCache.at < CLOCK_TTL_MS) {
    return clockCache.promise;
  }
  const promise = reader.client
    .getBlock({ blockTag: 'latest' })
    .then((b) => ({ block: b.number, ts: Number(b.timestamp) }));
  promise.catch(() => {
    clockCache = { at: 0, promise: null };
  });
  clockCache = { at: now, promise };
  return promise;
}

// --- Implementation object — fixtures replace it wholesale in DEV ---

let impl = {
  loadTitleList: reader.loadTitleList,
  loadMoreTitles: reader.loadMoreTitles,
  findTitleMeta: reader.findTitleMeta,
  loadRecentAcrossAuthors: reader.loadRecentAcrossAuthors,
  loadPostBody: reader.loadPostBody,
  resolveImages: reader.resolveImages,
  resolveEnsName: reader.resolveEnsName,
  getAuthorCount: getAuthorCountReal,
  getChainClock: getChainClockReal,
};

if (import.meta.env.DEV && FIXTURES_MODE) {
  impl = (await import('./fixtures.js')).makeFixtures(FIXTURES_MODE);
}

// Every re-export routes through `impl` so fixtures swap transparently.
export const loadTitleList = (author, n) => impl.loadTitleList(author, n);
export const loadMoreTitles = (author, oldestShown, n) =>
  impl.loadMoreTitles(author, oldestShown, n);
export const findTitleMeta = (author, targetIndex) =>
  impl.findTitleMeta(author, targetIndex);
export const loadRecentAcrossAuthors = (n, opts) =>
  impl.loadRecentAcrossAuthors(n, opts);
export const loadPostBody = (txHash) => impl.loadPostBody(txHash);
export const resolveImages = (markdown) => impl.resolveImages(markdown);
export const resolveEnsName = (author) => impl.resolveEnsName(author);
export const getAuthorCount = (author) => impl.getAuthorCount(author);
export const getChainClock = () => impl.getChainClock();
