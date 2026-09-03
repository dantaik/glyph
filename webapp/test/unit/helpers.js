// helpers.js — what the unit tests share: a silent logger, a fresh scan
// store, and an in-memory chain that answers the reader's I/O surface.

import { createScanStore } from '../../src/lib/scanStore';

/** The shape of rpcLog.scoped(), writing nothing. */
export const silentLog = () => ({
  b: (v) => String(v),
  range: (from, to) => `${from}-${to}`,
  fromNode: (_method, _detail, fn) => fn(),
  fromCache() {},
  endpoints() {},
  endpointFailed() {},
  windowShrunk() {},
  headLowered() {},
  sweepDone() {},
});

const STORAGE_KEYS = (chainId) => [
  `glyph.feedScan.v2.${chainId}`,
  `glyph.authorScan.v2.${chainId}`,
  'glyph.feedScan.v1',
  'glyph.authorScan.v1',
];

/** A store seeded from nothing: this chain's persisted keys are cleared first. */
export function freshStore(chainId = 1) {
  if (typeof localStorage !== 'undefined') {
    for (const key of STORAGE_KEYS(chainId)) localStorage.removeItem(key);
  }
  return createScanStore(chainId);
}

/** A store without localStorage at all (node environment). */
export function memoryStore(chainId = 1) {
  return createScanStore(chainId);
}

const HEX = '0123456789abcdef';
const hashOf = (chainId, author, index) => {
  // Deterministic, distinct per (chain, author, index), 64 hex chars.
  const seed = `${chainId}:${String(author).toLowerCase()}:${index}`;
  let h = 0x811c9dc5;
  let out = '';
  for (let i = 0; i < 64; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 0x01000193) >>> 0;
    out += HEX[h & 15];
  }
  return `0x${out}`;
};

export const AUTHORS = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
];

/**
 * An in-memory chain. `posts` is a list of `{ author, index, block, title?,
 * logIndex? }`; prevBlock links are derived per author, tx hashes are
 * deterministic, and every call is recorded in `calls` so a test can assert
 * what reached the "node".
 *
 * Options: `rangeLimit` makes eth_getLogs refuse windows wider than that
 * (the reader halves its window); `secondsPerBlock`/`now` shape block
 * timestamps; `fail` is a predicate over a call that makes it throw.
 */
export function fakeChain({
  chainId = 1,
  head,
  posts = [],
  secondsPerBlock = 12,
  now = 1_700_000_000,
  rangeLimit = null,
  fail = null,
} = {}) {
  const sorted = [...posts]
    .map((p) => ({ ...p, index: BigInt(p.index), block: BigInt(p.block) }))
    .sort((a, b) => (a.block === b.block ? Number(a.index - b.index) : a.block < b.block ? -1 : 1));
  const headBlock = BigInt(head ?? (sorted.length ? sorted[sorted.length - 1].block + 5n : 100n));
  const lastBlock = new Map(); // author -> block of their previous post
  let logCounter = new Map(); // block -> next logIndex
  const rows = sorted.map((p) => {
    const key = String(p.author).toLowerCase();
    const prevBlock = lastBlock.get(key) ?? 0n;
    lastBlock.set(key, p.block);
    const b = String(p.block);
    const logIndex = p.logIndex ?? logCounter.get(b) ?? 0;
    logCounter.set(b, logIndex + 1);
    return {
      author: p.author,
      index: p.index,
      block: p.block,
      prevBlock,
      title: p.title ?? `post ${key.slice(-4)}#${p.index}`,
      txHash: hashOf(chainId, p.author, p.index),
      eventIndex: 0,
      logIndex,
    };
  });
  const byAuthor = (author) => rows.filter((r) => r.author.toLowerCase() === String(author).toLowerCase());
  const tsOf = (block) => now - Number(headBlock - BigInt(block)) * secondsPerBlock;
  const calls = [];
  const record = (method, ...args) => {
    calls.push({ method, args });
    if (fail && fail({ method, args })) throw new Error(`${method} failed`);
  };
  const io = {
    chainId,
    ephemeral: true,
    async blockNumber() {
      record('eth_blockNumber');
      return headBlock;
    },
    async block(which) {
      record('eth_getBlockByNumber', which);
      const n = which === 'latest' ? headBlock : BigInt(which);
      return { number: n, timestamp: tsOf(n) };
    },
    async postsInRange(from, to) {
      record('eth_getLogs', from, to);
      if (rangeLimit != null && to - from + 1n > BigInt(rangeLimit)) {
        const err = new Error('query returned more than allowed');
        err.rangeTooLarge = true;
        throw err;
      }
      const hit = rows.filter((r) => r.block >= from && r.block <= to);
      return { rows: hit.map((r) => ({ ...r })), to };
    },
    async authorPostsInBlock(author, block) {
      record('eth_getLogs:author', author, block);
      return byAuthor(author)
        .filter((r) => r.block === BigInt(block))
        .sort((a, b) => Number(b.index - a.index))
        .map((r) => ({ ...r }));
    },
    async latestBlock(author) {
      record('latestBlock', author);
      const own = byAuthor(author);
      return own.length ? own[own.length - 1].block : 0n;
    },
    async count(author) {
      record('count', author);
      return BigInt(byAuthor(author).length);
    },
    async postsInTx(txHash) {
      record('eth_getTransactionReceipt', txHash);
      return rows.filter((r) => r.txHash === txHash).map((r) => ({ ...r }));
    },
    async postBody() {
      throw new Error('fake chain has no bodies');
    },
    async imageBytes() {
      throw new Error('fake chain has no images');
    },
    async ensName() {
      return null;
    },
  };
  return { io, rows, calls, head: headBlock, tsOf, hashOf: (a, i) => hashOf(chainId, a, i) };
}

/** Wait until `fn()` is truthy (polling), for controllers that stream results. */
export async function until(fn, { timeout = 2000, step = 5 } = {}) {
  const started = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error('until(): timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}
