// fixtures.js — the in-memory chains for DEV QA (`?fixtures=1` full data,
// `?fixtures=empty` empty states).
//
// Stands in for chainIO.js with the same surface — block heights and hashes
// in, post metadata and bodies out — so the REAL reader, scanner and scan
// store run on top of it: the demo exercises the same sweeps, the same
// coverage bookkeeping and the same window-by-window rendering as the
// chain does. Only ever loaded behind the literal `import.meta.env.DEV`
// guard in data.js, so production builds never bundle it.
//
// The worlds themselves are data (fixtureWorld.js): one per chain, each
// with its own pace, height and posts, so the multi-chain demo merges two
// genuinely different chains. `?window=700` shrinks the getLogs window so a
// sweep takes several round trips — the way to watch posts arrive one window
// at a time; `?fixtures=1&window=700&log=1` shows it in the console.

import { buildWorld } from './fixtureWorld';
import { buildPayloadText, parsePayloadText } from './payloadText';

const DELAY_MIN_MS = 350;
const DELAY_SPAN_MS = 250;

const keyOf = (author) => String(author || '').toLowerCase();

/** Window size override from `?window=N`, else the chain's default. */
function windowOverride() {
  try {
    const n = Number(new URLSearchParams(window.location.search).get('window'));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the fixture chain I/O for `chainId`. `mode === 'empty'` → no posts
 * anywhere (empty-state QA). Same surface as createChainIO(); see chainIO.js.
 *
 * Options (tests): `now` pins the head block's time; `delay` is the
 * artificial latency per call in ms (the demo's 350–600 ms by default, 0
 * in tests); `legacyRows` hands out rows without `ts`, the way rows
 * persisted before timestamps existed look; `scale` is buildWorld's.
 */
export function createFixtureIO(chainId, mode, { now, delay, legacyRows = false, scale = 1 } = {}) {
  const world = buildWorld(chainId, { now, scale });
  const empty = mode === 'empty';
  const feed = empty ? [] : world.posts;
  const postsOf = (author) => (empty ? [] : (world.byAuthor.get(keyOf(author)) ?? []));
  const metaByTx = empty ? new Map() : world.metaByTx;
  const bodyByTx = empty ? new Map() : world.bodyByTx;
  const wait =
    delay === 0
      ? () => Promise.resolve()
      : () =>
          new Promise((resolve) =>
            setTimeout(resolve, delay ?? DELAY_MIN_MS + Math.random() * DELAY_SPAN_MS),
          );
  // What chainIO hands out: a copy, with the block's timestamp attached.
  const meta = (p) => ({ ...p, ts: legacyRows ? null : p.ts });

  return {
    chainId: world.chainId,
    /** Demo data never enters the real IndexedDB cache. */
    ephemeral: true,
    /** Genesis: nothing is deployed, the whole chain is worth reading. */
    floor: world.floor,
    windowSize: windowOverride(),
    /** Per-sweep budget, when the world sets one (Taiko's is small on purpose). */
    scanBlocks: world.scanBlocks,
    /** The world behind this I/O, for tests and the /scan page. */
    world,

    async blockNumber() {
      await wait();
      return world.head;
    },

    async block(which) {
      await wait();
      const number = which === 'latest' ? world.head : BigInt(which);
      // A constant base fee: the demo is about the reader, not the market.
      return { number, timestamp: world.tsOf(number), baseFeePerGas: 1n };
    },

    async postsInRange(from, to) {
      await wait();
      const lo = BigInt(from);
      const hi = BigInt(to);
      return { rows: feed.filter((p) => p.block >= lo && p.block <= hi).map(meta), to: hi };
    },

    async authorPostsInBlock(author, block) {
      await wait();
      const at = BigInt(block);
      return postsOf(author)
        .filter((p) => p.block === at)
        .map(meta);
    },

    async latestBlock(author) {
      await wait();
      const posts = postsOf(author);
      return posts.length ? posts[posts.length - 1].block : 0n;
    },

    async count(author) {
      await wait();
      return BigInt(postsOf(author).length);
    },

    async postsInTx(txHash) {
      await wait();
      const p = metaByTx.get(String(txHash).toLowerCase());
      return p ? [meta(p)] : []; // demo posts are one event per tx
    },

    async postBody(txHash) {
      await wait();
      const body = bodyByTx.get(txHash);
      if (!body) throw new Error('no such transaction in the demo data');
      // Built and re-parsed through the real text layer, so the demo body
      // carries the same `text` and front-matter the chain would.
      const text = buildPayloadText({
        markdown: body.markdown,
        meta: { ...(body.meta ?? {}), tags: body.tags },
      });
      return {
        ...parsePayloadText(text),
        text,
        compressedBytes: Math.ceil(new TextEncoder().encode(text).length * 0.45),
      };
    },

    async imageBytes() {
      throw new Error('the demo data has no on-chain images'); // bodies use data: URIs instead
    },

    async ensName() {
      return null; // demo data has no ENS names
    },
  };
}
