// mergedFeed.js — one feed over several chains, ordered by time.
//
// Each chain keeps its own scan (feed.js): a store of rows inside swept
// ranges, and jobs that sweep more. This controller owns none of that. It
// reads every chain's covered rows, tags them with their chain and time
// (timeline.js), merges them newest first, and paginates the result — and
// when the page wants more, it decides WHICH chain to deepen.
//
// That decision is the frontier. A chain is completely known from its head
// down to the bottom of its head-contiguous range; the merged list is
// complete only above the newest of those bottoms, T*. Rows older than T*
// are shown under a marker (a chain that stopped above them may still hold
// posts there), and "load earlier posts" deepens the chain sitting at T* — the
// least-read one in time — until the complete zone has grown by a page.
//
// A view over ONE chain is the same controller with one chain: the frontier
// degenerates (nothing to be behind), gaps stay per chain, and the page
// paginates the same way.

import { useEffect, useSyncExternalStore } from 'react';
import * as seg from './segments';
import { estimateBlockTime } from './format';
import { makeRowTimeResolver } from './rowTimes';
import { compareMerged, countAbove, frontierOf, splitAtFrontier, timeRows, toSec } from './timeline';

/** Sweeps one "load earlier posts" may run before it settles for what it found. */
const MAX_SWEEPS_PER_MORE = 3;

export class MergedFeed {
  #chains;
  #pageSize;
  #shown;
  #job = null;
  #note = null;
  #clocks = new Map(); // chainId -> clock | null
  #clockPending = new Map(); // chainId -> Promise
  #bottomTs = new Map(); // chainId -> { block, ts }
  #bottomPending = new Map(); // chainId -> { block, promise }
  #resolvers = new Map(); // chainId -> row time resolver

  #listeners = new Set();
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  /**
   * @param chains [{ chainId, feed, store, clock, blockTime, floor }] — one
   *   per chain, from that chain's reader.
   */
  constructor({ chains, pageSize }) {
    this.#chains = chains
      .map((c) => ({ ...c, chainId: Number(c.chainId), floor: BigInt(c.floor ?? 0) }))
      .sort((a, b) => a.chainId - b.chainId);
    this.#pageSize = pageSize;
    this.#shown = pageSize;
    for (const c of this.#chains) {
      this.#resolvers.set(
        c.chainId,
        makeRowTimeResolver({
          blockTime: c.blockTime,
          store: c.store,
          persist: () => c.store.persistFeedScan(),
        }),
      );
      // A chain's feed bumps on every store change too, so this covers new
      // rows, new coverage, job starts and ends.
      c.feed.subscribe(() => {
        this.#onChainChange(c);
        this.#bump();
      });
    }
  }

  get chainIds() {
    return this.#chains.map((c) => c.chainId);
  }

  get pageSize() {
    return this.#pageSize;
  }

  // --- Subscription ----------------------------------------------------

  subscribe = (fn) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  #bump() {
    this.#version += 1;
    for (const fn of this.#listeners) fn();
  }

  // --- The merge ---------------------------------------------------------

  /** A chain's rows, tagged; and how far down in time it is completely known. */
  #perChain() {
    return this.#chains.map((c) => {
      const s = c.feed.getSnapshot();
      const clock = this.#clocks.get(c.chainId) ?? null;
      const rows = timeRows(c.store.coveredPosts(), c.chainId, clock);
      return { c, s, rows, ...this.#bound(c, s, clock) };
    });
  }

  #bound(c, s, clock) {
    if (!s.top) return { bound: Infinity, boundExact: false };
    if (s.top[0] <= c.floor) return { bound: -Infinity, boundExact: true };
    const bottom = this.#bottomTs.get(c.chainId);
    if (bottom && bottom.block === s.top[0]) return { bound: bottom.ts, boundExact: true };
    const est = estimateBlockTime(clock, s.top[0]);
    // Until the bottom block's time is read, an estimate stands in; with no
    // clock yet, nothing is claimed complete.
    return { bound: est ? toSec(est) : Infinity, boundExact: false };
  }

  #merged(per) {
    return per
      .flatMap((p) => p.rows)
      .filter((r) => r.ts != null)
      .sort(compareMerged);
  }

  /** What the page renders. Memoized until something changes. */
  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const per = this.#perChain();
    const all = this.#merged(per);
    const rows = all.slice(0, this.#shown);
    const total = per.reduce((n, p) => n + p.rows.length, 0);
    const { tStar, leaders } = frontierOf(per.map((p) => p.bound));

    const frontier =
      this.#chains.length === 1 || tStar === -Infinity
        ? null
        : {
            after: splitAtFrontier(rows, tStar),
            ts: tStar,
            leaders: leaders.map((i) => leaderState(per[i])),
          };

    // A chain's consecutive rows on the page that sit in different covered
    // ranges have unswept blocks between them — marked per chain.
    const gaps = [];
    for (const p of per) {
      const coverage = p.s.coverage;
      let prev = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.chainId !== p.c.chainId) continue;
        if (prev) {
          const upper = seg.segmentAt(coverage, prev.row.block);
          const lower = seg.segmentAt(coverage, r.block);
          if (upper && lower && upper !== lower) {
            gaps.push({ chainId: p.c.chainId, after: prev.i, from: lower[1] + 1n, to: upper[0] - 1n });
          }
        }
        prev = { row: r, i };
      }
    }
    gaps.sort((a, b) => a.after - b.after);

    const chains = per.map((p) => ({
      chainId: p.c.chainId,
      job: p.s.job,
      progress: p.s.progress,
      error: p.s.error,
      head: p.s.head,
      coverage: p.s.coverage,
      top: p.s.top,
      floor: p.s.floor,
      scanBlocks: p.s.scanBlocks,
      exhausted: p.s.exhausted,
      bound: p.bound,
      boundExact: p.boundExact,
      total: p.rows.length,
      refreshedAt: p.s.refreshedAt,
    }));

    this.#snapshot = {
      rows,
      shown: this.#shown,
      total,
      frontier,
      gaps,
      done: per.every((p) => p.s.exhausted) && all.length <= this.#shown,
      job: this.#job?.kind ?? null,
      scanning: this.#job != null || chains.some((c) => c.job != null),
      note: this.#note,
      chains,
      anyError: chains.some((c) => c.error),
      allErrored: chains.length > 0 && chains.every((c) => c.error),
    };
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  };

  // --- Jobs --------------------------------------------------------------

  /** Refresh every chain that is stale; keep clocks and times current. */
  ensureFresh() {
    for (const c of this.#chains) c.feed.ensureFresh();
    this.#refreshClocks();
    for (const c of this.#chains) {
      this.#resolvers.get(c.chainId).forget();
      this.#onChainChange(c);
    }
  }

  /** Re-read every chain from its head. */
  refresh() {
    this.#refreshClocks();
    return Promise.allSettled(this.#chains.map((c) => c.feed.refresh()));
  }

  /** Retry the chains that failed (or the one named). */
  retry(chainId = null) {
    const wanted = this.#chains.filter((c) =>
      chainId == null ? c.feed.getSnapshot().error : c.chainId === Number(chainId),
    );
    return Promise.allSettled(wanted.map((c) => c.feed.retry()));
  }

  /** Show another page, deepening the least-read chain until it is complete. */
  loadMore() {
    return this.#run('more', () => this.#more());
  }

  /** Sweep one chain's gap; the page widens by what turns up so nothing is pushed off. */
  fillGap(chainId, gap) {
    const c = this.#chain(chainId);
    return this.#run('gap', async () => {
      const before = c.store.coveredPosts().length;
      await c.feed.fillGap(gap);
      this.#shown += c.store.coveredPosts().length - before;
    });
  }

  #chain(chainId) {
    const c = this.#chains.find((x) => x.chainId === Number(chainId));
    if (!c) throw new Error(`chain ${chainId} is not in this view`);
    return c;
  }

  #run(kind, fn) {
    if (this.#job) return this.#job.promise;
    const job = { kind, promise: null };
    job.promise = (async () => {
      try {
        await fn();
      } finally {
        if (this.#job === job) this.#job = null;
        this.#bump();
      }
    })();
    this.#job = job;
    this.#bump();
    return job.promise;
  }

  /** The chain sitting at the frontier — the one to deepen — or null. */
  #leader() {
    let best = null;
    for (const p of this.#perChain()) {
      if (p.bound === -Infinity) continue;
      if (!best || p.bound > best.bound) best = p;
    }
    return best?.c ?? null;
  }

  /** Rows on the complete side of the frontier, right now. */
  #completeCount() {
    const per = this.#perChain();
    const { tStar } = frontierOf(per.map((p) => p.bound));
    const all = this.#merged(per);
    return tStar === -Infinity ? all.length : countAbove(all, tStar);
  }

  async #more() {
    this.#note = null;
    const target = this.#shown + this.#pageSize;
    this.#shown = target; // rows show up as they are found, like a single chain
    this.#bump();
    let sweeps = 0;
    let fetched = 0n;
    let found = 0;
    let last = null;
    while (this.#completeCount() < target && sweeps < MAX_SWEEPS_PER_MORE) {
      const leader = this.#leader();
      if (!leader) break;
      const swept = await leader.feed.extend();
      await this.#ensureBottomTs(leader, { wait: true });
      sweeps += 1;
      last = leader;
      if (swept) {
        fetched += swept.fetched ?? 0n;
        found += swept.found ?? 0;
      }
      if (leader.feed.getSnapshot().error) break; // no point hammering a failing node
    }
    if (this.#completeCount() < target && last && found === 0 && fetched > 0n) {
      this.#note = { chainId: last.chainId, fetched };
    }
  }

  // --- Times ---------------------------------------------------------------

  #onChainChange(c) {
    this.#ensureBottomTs(c);
    const rows = c.store.coveredPosts().slice(0, this.#shown + this.#pageSize);
    this.#resolvers.get(c.chainId).resolve(rows);
  }

  #refreshClocks() {
    for (const c of this.#chains) {
      if (this.#clockPending.has(c.chainId)) continue;
      const p = Promise.resolve()
        .then(() => c.clock())
        .then((clock) => {
          this.#clocks.set(c.chainId, clock ?? null);
          this.#bump();
        })
        .catch(() => {})
        .finally(() => {
          if (this.#clockPending.get(c.chainId) === p) this.#clockPending.delete(c.chainId);
        });
      this.#clockPending.set(c.chainId, p);
    }
  }

  /** Read the exact time of a chain's coverage bottom, once per bottom. */
  #ensureBottomTs(c, { wait = false } = {}) {
    const top = c.feed.getSnapshot().top;
    if (!top) return Promise.resolve();
    const block = top[0];
    const have = this.#bottomTs.get(c.chainId);
    if (have && have.block === block) return Promise.resolve();
    const pending = this.#bottomPending.get(c.chainId);
    if (pending && pending.block === block) return wait ? pending.promise : Promise.resolve();
    const promise = Promise.resolve()
      .then(() => c.blockTime(block))
      .then((ts) => {
        if (ts != null) {
          this.#bottomTs.set(c.chainId, { block, ts: Number(ts) });
          this.#bump();
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.#bottomPending.get(c.chainId)?.promise === promise) this.#bottomPending.delete(c.chainId);
      });
    this.#bottomPending.set(c.chainId, { block, promise });
    return wait ? promise : Promise.resolve();
  }
}

/** Why a chain sits at the frontier: covered to here, still scanning, or broken. */
function leaderState(p) {
  const state = p.s.top ? 'covered' : p.s.job ? 'scanning' : p.s.error ? 'error' : 'idle';
  return { chainId: p.c.chainId, state, error: p.s.error ?? null, exact: p.boundExact };
}

/** React hook: the merged snapshot, refreshed on mount when stale. */
export function useMergedFeed(feed) {
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  useEffect(() => {
    feed.ensureFresh();
  }, [feed]);
  return snapshot;
}
