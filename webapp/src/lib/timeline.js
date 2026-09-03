// timeline.js — the arithmetic of a feed that spans chains.
//
// Block heights order posts within one chain and mean nothing across two,
// so a merged feed orders by time: the exact block timestamp a row carries
// (`ts`, seconds), or an estimate from the chain's clock until it does.
//
// Two ideas, both pure:
//
//   - timed rows: one chain's rows, newest first, each tagged with its chain
//     and its best-known time;
//   - the frontier: each chain is completely known from its head down to
//     some time (its `bound`); the merge is complete only above the newest
//     of those bounds, T*. Rows below T* are shown, but under a marker,
//     because a chain that stopped scanning above them may still hold
//     posts in between. The chains sitting at T* are the ones to deepen.

import { estimateBlockTime } from './format';

/** Date → seconds since the epoch. */
export const toSec = (date) => Math.floor(date.getTime() / 1000);

/**
 * Tag one chain's newest-first rows with `chainId`, `ts` and `tsExact`.
 *
 * A row without a timestamp gets an estimate from `clock` (null without
 * one). An estimate is clamped so it never lands above the row before it:
 * that row is newer on chain, whatever the clock says, and a legacy row
 * must not leap above an exact one it was mined behind.
 */
export function timeRows(rows, chainId, clock) {
  const id = Number(chainId);
  let ceiling = Infinity;
  return rows.map((r) => {
    let ts = r.ts;
    let exact = ts != null;
    if (ts == null) {
      const est = estimateBlockTime(clock, r.block);
      ts = est ? toSec(est) : null;
      exact = false;
    }
    if (ts != null && ts > ceiling) ts = ceiling;
    if (ts != null) ceiling = ts;
    return { ...r, chainId: id, ts, tsExact: exact };
  });
}

/**
 * Newest first across chains: later time first; at the same second the
 * lower chain id first, then the higher block, then the higher log index.
 * Rows without any time sort last.
 */
export function compareMerged(a, b) {
  if (a.ts == null || b.ts == null) {
    if (a.ts == null && b.ts == null) return 0;
    return a.ts == null ? 1 : -1;
  }
  if (a.ts !== b.ts) return b.ts - a.ts;
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.block !== b.block) return b.block > a.block ? 1 : -1;
  return (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

/**
 * The frontier of a set of per-chain bounds. A bound is the time a chain is
 * completely known down to: `+Infinity` when it has no coverage yet (so
 * nothing at all is complete), `-Infinity` when it is read to its floor.
 * Returns T* and which chains sit at it — the ones to deepen next.
 */
export function frontierOf(bounds) {
  let tStar = -Infinity;
  for (const b of bounds) if (b > tStar) tStar = b;
  const leaders = [];
  if (tStar !== -Infinity) bounds.forEach((b, i) => b === tStar && leaders.push(i));
  return { tStar, leaders };
}

/**
 * Index of the last row at or above the frontier (`-1` when none are: the
 * marker goes above everything). Rows must be in merged order.
 */
export function splitAtFrontier(rows, tStar) {
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].ts != null && rows[i].ts >= tStar) last = i;
    else break;
  }
  return last;
}

/** Rows on the complete side of the frontier. */
export const countAbove = (rows, tStar) => splitAtFrontier(rows, tStar) + 1;

/** Row identity across chains, for React keys and de-duplication. */
export const rowKey = (r) => `${r.chainId}:${String(r.txHash).toLowerCase()}:${r.eventIndex ?? 0}`;
