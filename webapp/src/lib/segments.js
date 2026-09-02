// segments.js — sorted, disjoint, inclusive block ranges `[from, to]`.
//
// The reader records which block ranges it has already read from the chain.
// A single `[frontier, head]` range could only ever grow downwards from the
// tip, so a deep read had to re-read everything between the tip and the
// depth it wanted. A *set* of ranges lets coverage be discontinuous: blocks
// 1–100 read on Monday and 200–300 read on Tuesday are two segments, and a
// read that later sweeps 200 down to 50 fetches only 199–101 — blocks 100–1
// are answered from the rows already cached for that segment.
//
// Every function takes and returns BigInt ranges; `toPlain`/`fromPlain`
// convert at the localStorage boundary (heights stay far below 2^53).

const big = (v) => (typeof v === 'bigint' ? v : BigInt(v));

/** Sort, clamp to >= 0 and merge overlapping *or touching* ranges. */
export function normalize(segments) {
  const list = [];
  for (const seg of segments ?? []) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    let from = big(seg[0]);
    const to = big(seg[1]);
    if (from < 0n) from = 0n;
    if (to < from) continue;
    list.push([from, to]);
  }
  list.sort((a, b) => (a[0] === b[0] ? (a[1] <= b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const out = [];
  for (const [from, to] of list) {
    const last = out[out.length - 1];
    // `[1,100]` and `[101,200]` describe one uninterrupted stretch.
    if (last && from <= last[1] + 1n) {
      if (to > last[1]) last[1] = to;
      continue;
    }
    out.push([from, to]);
  }
  return out;
}

/** Coverage plus one more range. */
export function add(segments, from, to) {
  return normalize([...(segments ?? []), [from, to]]);
}

/** The segment containing `block`, or null. */
export function segmentAt(segments, block) {
  const b = big(block);
  for (const seg of segments) {
    if (seg[0] <= b && b <= seg[1]) return seg;
  }
  return null;
}

/**
 * The highest covered block strictly below `block`, or null — where a
 * downward fetch window must stop so it doesn't re-read covered ground.
 */
export function topBelow(segments, block) {
  const b = big(block);
  let best = null;
  for (const [, to] of segments) {
    if (to < b && (best === null || to > best)) best = to;
  }
  return best;
}

/** Lowest covered block, or null. */
export const lowest = (segments) => (segments.length ? segments[0][0] : null);

/** Highest covered block, or null. */
export const highest = (segments) =>
  segments.length ? segments[segments.length - 1][1] : null;

/**
 * Drop every claim below `floor`. Called when the row cache is trimmed:
 * coverage may only be claimed for ranges whose rows are still retained
 * in full, or the reader would silently skip posts it no longer holds.
 */
export function clipBelow(segments, floor) {
  const f = big(floor);
  const out = [];
  for (const [from, to] of segments) {
    if (to < f) continue;
    out.push([from < f ? f : from, to]);
  }
  return out;
}

/** Total number of blocks covered. */
export function blockCount(segments) {
  let total = 0n;
  for (const [from, to] of segments) total += to - from + 1n;
  return total;
}

/** BigInt ranges → JSON-safe number pairs (localStorage can't hold BigInt). */
export const toPlain = (segments) =>
  (segments ?? []).map(([from, to]) => [Number(from), Number(to)]);

/** JSON number pairs → normalized BigInt ranges; garbage entries are dropped. */
export function fromPlain(value) {
  if (!Array.isArray(value)) return [];
  const raw = [];
  for (const seg of value) {
    if (!Array.isArray(seg) || seg.length < 2) continue;
    try {
      raw.push([BigInt(seg[0]), BigInt(seg[1])]);
    } catch {
      /* not a number pair — skip */
    }
  }
  return normalize(raw);
}
