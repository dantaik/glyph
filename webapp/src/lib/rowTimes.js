// rowTimes.js — fill in timestamps on rows that predate them.
//
// Rows read since chainIO stamps them arrive with `ts`. Rows persisted
// before that exist in people's browsers without it, and a row whose header
// read failed is stored without it too. This resolver takes such rows a few
// blocks at a time, reads each block's time once, and hands it to the store
// (which stamps every row in the block and notifies) — so the merged feed
// re-sorts as exact times replace estimates, and the store persists them so
// it happens once.
//
// The store, not the rows, says what is still missing: the store replaces a
// row object when it stamps it, so an array of rows handed in earlier goes
// stale — asking it again would re-request blocks already answered, forever.

/**
 * @param blockTime async (block) => seconds
 * @param store     the chain's scan store (rememberBlockTs, knownBlockTs)
 * @param persist   () => void, called after each block that stamped a row
 * @param limit     blocks in flight at once
 */
export function makeRowTimeResolver({ blockTime, store, persist, limit = 3 }) {
  const inFlight = new Set(); // block (string)
  const failed = new Set(); // block (string) — left alone until forget()

  /** Blocks among `rows` whose time the store still lacks, oldest request first. */
  function missing(rows) {
    const out = [];
    for (const r of rows) {
      const b = String(r.block);
      if (out.includes(b) || inFlight.has(b) || failed.has(b)) continue;
      if (store.knownBlockTs(b) != null) continue;
      out.push(b);
    }
    return out;
  }

  /** Resolve times for the rows lacking one, up to `limit` blocks at a time. */
  function resolve(rows) {
    for (const b of missing(rows)) {
      if (inFlight.size >= limit) break;
      inFlight.add(b);
      Promise.resolve()
        .then(() => blockTime(BigInt(b)))
        .then((ts) => {
          if (ts == null) throw new Error('no timestamp');
          if (store.rememberBlockTs(b, ts)) persist?.();
        })
        .catch(() => {
          failed.add(b);
        })
        .finally(() => {
          inFlight.delete(b);
          if (missing(rows).length) resolve(rows);
        });
    }
  }

  /** Let failed blocks be tried again (the next refresh). */
  const forget = () => failed.clear();

  return {
    resolve,
    forget,
    get pending() {
      return inFlight.size;
    },
  };
}
