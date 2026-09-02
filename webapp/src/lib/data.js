// data.js — single data facade for all chain reads.
//
// Components import from here instead of blogReader.js so that, in DEV,
// `?fixtures=1` / `?fixtures=empty` (or VITE_FIXTURES=1) swaps every chain
// call for deterministic in-memory fixtures. The dynamic import below sits
// behind a literal `import.meta.env.DEV` check, so production builds
// tree-shake fixtures.js away entirely (top-level await is enabled in
// vite.config.js).

import * as reader from './blogReader';
import { GLYPH_ADDRESS, getCacheTtlMs } from './config';
import { makeTtlCache } from './ttlCache';

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

function getChainClockReal() {
  return reader.client
    .getBlock({ blockTag: 'latest' })
    .then((b) => ({ block: b.number, ts: Number(b.timestamp) }));
}

// --- Implementation object — fixtures replace it wholesale in DEV ---

let impl = {
  loadTitleList: reader.loadTitleList,
  loadMoreTitles: reader.loadMoreTitles,
  findTitleMeta: reader.findTitleMeta,
  loadRecentAcrossAuthors: reader.loadRecentAcrossAuthors,
  findMetaByTx: reader.findMetaByTx,
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
// Repeat chain reads (lists, counts, feed, clock) are deduped by a TTL
// cache — default 5 minutes, configurable in Settings. Bodies and images
// are permanently cached in IndexedDB, so they bypass this layer.
const ttlCache = makeTtlCache(getCacheTtlMs);
const authorKey = (a) => String(a || '').toLowerCase();

export const loadTitleList = (author, n) =>
  ttlCache(`titles:${authorKey(author)}:${n}`, () => impl.loadTitleList(author, n));
export const loadMoreTitles = (author, oldestShown, n) =>
  ttlCache(
    `more:${authorKey(author)}:${oldestShown?.index ?? ''}:${oldestShown?.block ?? ''}:${n}`,
    () => impl.loadMoreTitles(author, oldestShown, n),
  );
export const findTitleMeta = (author, targetIndex) =>
  ttlCache(`meta:${authorKey(author)}:${targetIndex}`, () =>
    impl.findTitleMeta(author, targetIndex),
  );
export const loadRecentAcrossAuthors = (n, opts) =>
  ttlCache(`recent:${n}:${opts?.windowSize ?? ''}:${opts?.maxWindows ?? ''}`, () =>
    impl.loadRecentAcrossAuthors(n, opts),
  );
export const findMetaByTx = (txHash) =>
  ttlCache(`txmeta:${String(txHash).toLowerCase()}`, () => impl.findMetaByTx(txHash));
export const loadPostBody = (txHash) => impl.loadPostBody(txHash);
export const resolveImages = (markdown) => impl.resolveImages(markdown);
export const resolveEnsName = (author) => impl.resolveEnsName(author);
export const getAuthorCount = (author) =>
  ttlCache(`count:${authorKey(author)}`, () => impl.getAuthorCount(author));
export const getChainClock = () => ttlCache('clock', () => impl.getChainClock());
