// mergedAuthorList.js — one author's posts across chains, ordered by time.
//
// An author has an independent post list on every chain (their own index
// sequence, their own reverse-linked walk, see authorList.js). This merges
// the walks: rows tagged with their chain, newest first by time, and the
// same frontier idea as the feed — a chain whose walk hasn't reached the
// author's first post is complete only down to its oldest walked row, so
// rows older than the newest such row sit under a marker, and 加载更早
// walks that chain further.

import { useEffect, useSyncExternalStore } from 'react';
import { makeRowTimeResolver } from './rowTimes';
import { compareMerged, frontierOf, splitAtFrontier, timeRows } from './timeline';

export class MergedAuthorList {
  #author;
  #chains;
  #job = null;
  #clocks = new Map();
  #clockPending = new Map();
  #resolvers = new Map();

  #listeners = new Set();
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  /**
   * @param chains [{ chainId, list, store, clock, blockTime }] — the
   *   author's list on each chain, from that chain's reader.
   */
  constructor({ author, chains }) {
    this.author = author;
    this.#author = author;
    this.#chains = chains
      .map((c) => ({ ...c, chainId: Number(c.chainId) }))
      .sort((a, b) => a.chainId - b.chainId);
    for (const c of this.#chains) {
      this.#resolvers.set(
        c.chainId,
        makeRowTimeResolver({
          blockTime: c.blockTime,
          store: c.store,
          persist: () => c.store.persistAuthorScan(author),
        }),
      );
      c.list.subscribe(() => {
        this.#resolvers.get(c.chainId).resolve(c.list.getSnapshot().rows);
        this.#bump();
      });
    }
  }

  get chainIds() {
    return this.#chains.map((c) => c.chainId);
  }

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

  #perChain() {
    return this.#chains.map((c) => {
      const s = c.list.getSnapshot();
      const clock = this.#clocks.get(c.chainId) ?? null;
      const rows = timeRows(s.rows, c.chainId, clock);
      return { c, s, rows, bound: this.#bound(s, rows) };
    });
  }

  /**
   * How far down in time the author's list on this chain is known: to its
   * oldest walked row while more remain; all the way when the walk reached
   * their first post (or they never wrote here); not at all until the
   * first walk answers.
   */
  #bound(s, rows) {
    if (rows.length) {
      if (!s.hasMore) return -Infinity;
      const oldest = rows[rows.length - 1];
      return oldest.ts ?? Infinity;
    }
    if (s.job) return Infinity;
    if (s.error) return Infinity;
    if (s.refreshedAt === 0) return Infinity; // never asked yet
    return -Infinity; // asked, and the author has nothing on this chain
  }

  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const per = this.#perChain();
    const rows = per
      .flatMap((p) => p.rows)
      .filter((r) => r.ts != null)
      .sort(compareMerged);
    const { tStar, leaders } = frontierOf(per.map((p) => p.bound));
    const frontier =
      this.#chains.length === 1 || tStar === -Infinity
        ? null
        : {
            after: splitAtFrontier(rows, tStar),
            ts: tStar,
            leaders: leaders.map((i) => ({
              chainId: per[i].c.chainId,
              state: per[i].rows.length ? 'covered' : per[i].s.job ? 'scanning' : per[i].s.error ? 'error' : 'idle',
              error: per[i].s.error ?? null,
            })),
          };
    const chains = per.map((p) => ({
      chainId: p.c.chainId,
      job: p.s.job,
      progress: p.s.progress,
      error: p.s.error,
      hasMore: p.s.hasMore,
      count: p.rows.length,
      bound: p.bound,
      refreshedAt: p.s.refreshedAt,
    }));
    this.#snapshot = {
      rows,
      frontier,
      hasMore: per.some((p) => p.bound !== -Infinity),
      job: this.#job?.kind ?? null,
      scanning: this.#job != null || chains.some((c) => c.job != null),
      chains,
      anyError: chains.some((c) => c.error),
      allErrored: chains.length > 0 && chains.every((c) => c.error),
    };
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  };

  ensureFresh() {
    for (const c of this.#chains) c.list.ensureFresh();
    this.#refreshClocks();
    for (const c of this.#chains) {
      this.#resolvers.get(c.chainId).forget();
      this.#resolvers.get(c.chainId).resolve(c.list.getSnapshot().rows);
    }
  }

  refresh() {
    this.#refreshClocks();
    return Promise.allSettled(this.#chains.map((c) => c.list.refresh()));
  }

  retry(chainId = null) {
    const wanted = this.#chains.filter((c) =>
      chainId == null ? c.list.getSnapshot().error : c.chainId === Number(chainId),
    );
    return Promise.allSettled(wanted.map((c) => c.list.retry()));
  }

  /** Walk the chain sitting at the frontier one page further. */
  loadMore() {
    return this.#run('more', async () => {
      let best = null;
      for (const p of this.#perChain()) {
        if (p.bound === -Infinity) continue;
        if (!best || p.bound > best.bound) best = p;
      }
      if (!best) return;
      await (best.rows.length ? best.c.list.loadMore() : best.c.list.refresh());
    });
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
}

/** React hook: the merged author list, refreshed on mount when stale. */
export function useMergedAuthorList(list) {
  const snapshot = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  useEffect(() => {
    list.ensureFresh();
  }, [list]);
  return snapshot;
}
