// gasHistory.js — what the last day of block space cost, read from the node.
//
// When you publish is the biggest lever on what a post costs — a factor of a
// hundred between a quiet hour and a busy one — and until now the write tab
// showed only the price at this instant, which is no help in deciding whether
// to wait.
//
// The history comes from the chain itself: one block header per hour for the
// last day, each carrying its base fee. No off-chain price feed, no gas
// oracle, nothing to be blocked or rate-limited beyond the node the reader is
// already using. It is a sample, not a survey: a handful of headers is enough
// to see the shape of a day.

import { mapLimit } from './async';

/** How many headers are read at once. Gentle on a public node. */
const IN_FLIGHT = 4;

/** Assumed when a chain's clock has not measured a pace yet. */
const FALLBACK_SECONDS_PER_BLOCK = 12;

/**
 * One base-fee sample per hour over the last `hours`, oldest first.
 *
 * Each chain is asked at its own pace: Ethereum's hour is ~300 blocks and
 * Taiko's ~1,800, and the pace comes from the chain clock rather than being
 * assumed. Samples below the contract's deployment block are not read (there
 * is nothing of ours down there), and a header the node will not serve is
 * dropped rather than failing the whole history — a sparkline with a gap in
 * it is still worth looking at.
 *
 * @param {{ clock: Function, io: object, feed: { floor: bigint } }} reader
 * @returns {Promise<Array<{ block: bigint, ts: number, baseFeePerGas: bigint }>>}
 */
export async function baseFeeHistory(reader, { hours = 24, samples = 25 } = {}) {
  const clock = await reader.clock();
  if (!clock?.block) return [];
  const pace = clock.secondsPerBlock || FALLBACK_SECONDS_PER_BLOCK;
  const perHour = BigInt(Math.max(1, Math.round(3600 / pace)));
  const step = (perHour * BigInt(hours)) / BigInt(Math.max(1, samples - 1));
  const floor = reader.feed?.floor ?? 0n;

  const wanted = [];
  for (let k = samples - 1; k >= 0; k--) {
    const back = step * BigInt(k);
    const at = clock.block > back ? clock.block - back : 0n;
    if (at < floor) continue;
    // A short chain (or a fast one early on) can round several samples onto
    // the same block; one header is one sample.
    if (wanted[wanted.length - 1] === at) continue;
    wanted.push(at);
  }

  const read = await mapLimit(wanted, IN_FLIGHT, (block) =>
    reader.io.block(block).catch(() => null),
  );
  return read
    .filter((b) => b && b.baseFeePerGas != null)
    .map((b) => ({ block: b.number, ts: Number(b.timestamp), baseFeePerGas: BigInt(b.baseFeePerGas) }));
}

/** The cheapest sample, or null when there are none. */
export function lowestSample(samples) {
  let best = null;
  for (const s of samples ?? []) {
    if (!best || s.baseFeePerGas < best.baseFeePerGas) best = s;
  }
  return best;
}

/** The newest sample, or null — what the history says "now" costs. */
export const latestSample = (samples) => (samples?.length ? samples[samples.length - 1] : null);

/**
 * The sparkline's shape: each sample as an { x, y } in a 0..1 box, oldest at
 * x=0, cheapest at y=0. A flat history draws a flat line rather than dividing
 * by zero.
 */
export function sparklinePoints(samples) {
  const list = samples ?? [];
  if (list.length === 0) return [];
  const fees = list.map((s) => Number(s.baseFeePerGas));
  const low = Math.min(...fees);
  const high = Math.max(...fees);
  const span = high - low;
  const lastX = Math.max(1, list.length - 1);
  return fees.map((fee, i) => ({
    x: i / lastX,
    y: span === 0 ? 0.5 : (fee - low) / span,
  }));
}
