// mergedHelpers.js — readers over the fixture worlds (or a fake chain) with
// their own stores, and a way to wait for a merged controller to settle.

import { createReader } from '../../src/lib/reader';
import { createScanStore } from '../../src/lib/scanStore';
import { createFixtureIO } from '../../src/lib/fixtures';
import { until } from './helpers';

export const NOW = 1_800_000_000;

/**
 * A reader over the demo world of `chainId`, on a fresh store. `tweak`
 * gets the fixture I/O before the reader sees it (override scanBlocks,
 * windowSize, break a method…).
 */
export function worldReader(chainId, { ioOpts = {}, tweak = null } = {}) {
  return createReader(chainId, {
    makeIO: (id) => {
      const io = createFixtureIO(id, '1', { now: NOW, delay: 0, ...ioOpts });
      tweak?.(io);
      return io;
    },
    store: createScanStore(chainId),
  });
}

/** A reader over any I/O with the reader's surface (test/unit/helpers fakeChain). */
export function ioReader(chainId, io) {
  return createReader(chainId, { makeIO: () => io, store: createScanStore(chainId) });
}

/**
 * Wait until nothing is in flight: no jobs, every chain's bound exact (or
 * infinite), every shown row stamped, and — when clocks are expected —
 * every chain's clock read.
 */
export function settle(controller, { timeout = 3000 } = {}) {
  return until(
    () => {
      const s = controller.getSnapshot();
      if (s.scanning) return false;
      if (s.chains.some((c) => Number.isFinite(c.bound) && c.boundExact === false)) return false;
      if (s.rows.some((r) => !r.tsExact)) return false;
      return s;
    },
    { timeout },
  );
}
