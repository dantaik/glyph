// followFeed.js — a feed that costs almost nothing.
//
// The home feed has to sweep block ranges because the contract keeps no
// global head pointer: there is no way to ask "what did anyone publish
// lately". But it does keep a head pointer PER AUTHOR, and each post names
// the block of the author's previous one — a reverse linked list, walked one
// single-block query at a time.
//
// So a reader who follows a handful of people gets exactly what the design
// was built for: one `latestBlock` read per author per chain, then a walk,
// and not a single range scan. This controller is that feed: it takes the
// author-list walks the readers already own (authorList.js — which persist,
// survive navigation and are shared with the author pages), merges them by
// time, and decides which walk to deepen when the reader wants more.

import { useEffect, useSyncExternalStore } from 'react';
import { makeRowTimeResolver } from './rowTimes';
import { compareMerged, frontierOf, splitAtFrontier, timeRows, walkBound } from './timeline';

/** Walks one "load more" may deepen before it settles for what it found. */
const MAX_WALKS_PER_MORE = 3;

export class FollowFeed {
  #walks; // [{ chainId, author, list, store, clock, blockTime }]
  #pageSize;
  #shown;
  #job = null;
  #clocks = new Map(); // chainId -> clock | null
  #clockPending = new Map();
  #resolvers = new Map(); // chainId -> row time resolver

  #listeners = new Set();
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  /**
   * @param readers   one per chain, from data.js
   * @param addresses the authors being followed
   */
  constructor({ readers, addresses, pageSize }) {
    this.addresses = [...addresses];
    this.#pageSize = pageSize;
    this.#shown = pageSize;

    for (const reader of readers) {
      this.#resolvers.set(
        reader.chainId,
        makeRowTimeResolver({
          blockTime: reader.blockTime,
          store: reader.store,
          persist: () => reader.store.persistFeedScan(),
        }),
      );
    }

    this.#walks = [];
    for (const reader of readers) {
      for (const author of this.addresses) {
        // The SAME controller the author page uses: one walk per (author,
        // chain) for the whole page, so opening an author after following
        // them costs nothing.
        const list = reader.authorList(author);
        this.#walks.push({
          chainId: reader.chainId,
          author,
          list,
          store: reader.store,
          blockTime: reader.blockTime,
          clock: reader.clock,
        });
        list.subscribe(() => {
          this.#resolvers.get(reader.chainId).resolve(list.getSnapshot().rows);
          this.#bump();
        });
      }
    }
  }

  get chainIds() {
    return [...new Set(this.#walks.map((w) => w.chainId))];
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

  #perWalk() {
    return this.#walks.map((w) => {
      const s = w.list.getSnapshot();
      const rows = timeRows(s.rows, w.chainId, this.#clocks.get(w.chainId) ?? null);
      return { w, s, rows, bound: walkBound(s, rows) };
    });
  }

  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const per = this.#perWalk();
    const all = per
      .flatMap((p) => p.rows)
      .filter((r) => r.ts != null)
      .sort(compareMerged);
    const rows = all.slice(0, this.#shown);
    const { tStar, leaders } = frontierOf(per.map((p) => p.bound));

    // Nobody followed, or every walk read to the author's first post: there is
    // no frontier, because nothing is missing.
    const frontier =
      per.length === 0 || tStar === -Infinity
        ? null
        : {
            after: splitAtFrontier(rows, tStar),
            ts: tStar,
            leaders: leaders.map((i) => ({
              chainId: per[i].w.chainId,
              author: per[i].w.author,
              state: per[i].rows.length ? 'covered' : per[i].s.job ? 'scanning' : per[i].s.error ? 'error' : 'idle',
              error: per[i].s.error ?? null,
              exact: per[i].rows.length ? Boolean(per[i].rows[per[i].rows.length - 1].tsExact) : false,
            })),
          };

    const chains = this.chainIds.map((chainId) => {
      const mine = per.filter((p) => p.w.chainId === chainId);
      return {
        chainId,
        job: mine.find((p) => p.s.job)?.s.job ?? null,
        progress: mine.find((p) => p.s.progress)?.s.progress ?? null,
        error: mine.find((p) => p.s.error)?.s.error ?? null,
      };
    });

    this.#snapshot = {
      rows,
      shown: this.#shown,
      total: all.length,
      frontier,
      // Authors who have answered and have nothing at all: worth saying, so a
      // sparse page does not look broken.
      silent: this.addresses.filter((author) =>
        per
          .filter((p) => p.w.author === author)
          .every((p) => p.rows.length === 0 && p.s.refreshedAt > 0 && !p.s.error),
      ),
      done: per.every((p) => p.bound === -Infinity) && all.length <= this.#shown,
      job: this.#job?.kind ?? null,
      scanning: this.#job != null || per.some((p) => p.s.job != null),
      chains,
      anyError: per.some((p) => p.s.error),
      allErrored: per.length > 0 && per.every((p) => p.s.error),
    };
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  };

  /** Read whatever each followed author has published since the last visit. */
  ensureFresh() {
    for (const w of this.#walks) w.list.ensureFresh();
    this.#refreshClocks();
    for (const chainId of this.chainIds) this.#resolvers.get(chainId).forget();
    for (const w of this.#walks) this.#resolvers.get(w.chainId).resolve(w.list.getSnapshot().rows);
  }

  refresh() {
    this.#refreshClocks();
    return Promise.allSettled(this.#walks.map((w) => w.list.refresh()));
  }

  retry(chainId = null) {
    const wanted = this.#walks.filter((w) =>
      chainId == null ? w.list.getSnapshot().error : w.chainId === Number(chainId),
    );
    return Promise.allSettled(wanted.map((w) => w.list.retry()));
  }

  /** Show another page, deepening whichever walk is furthest behind in time. */
  loadMore() {
    return this.#run('more', async () => {
      const target = this.#shown + this.#pageSize;
      this.#shown = target;
      this.#bump();
      let walks = 0;
      while (this.#completeCount() < target && walks < MAX_WALKS_PER_MORE) {
        const leader = this.#leader();
        if (!leader) break;
        await (leader.rows.length ? leader.w.list.loadMore() : leader.w.list.refresh());
        walks += 1;
        if (leader.w.list.getSnapshot().error) break; // no point hammering a failing node
      }
    });
  }

  /** The walk sitting at the frontier — the one to deepen — or null. */
  #leader() {
    let best = null;
    for (const p of this.#perWalk()) {
      if (p.bound === -Infinity) continue;
      if (!best || p.bound > best.bound) best = p;
    }
    return best;
  }

  /** Rows on the complete side of the frontier, right now. */
  #completeCount() {
    const per = this.#perWalk();
    const { tStar } = frontierOf(per.map((p) => p.bound));
    const all = per
      .flatMap((p) => p.rows)
      .filter((r) => r.ts != null)
      .sort(compareMerged);
    if (tStar === -Infinity) return all.length;
    return splitAtFrontier(all, tStar) + 1;
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
    for (const chainId of this.chainIds) {
      if (this.#clockPending.has(chainId)) continue;
      const walk = this.#walks.find((w) => w.chainId === chainId);
      const p = Promise.resolve()
        .then(() => walk.clock())
        .then((clock) => {
          this.#clocks.set(chainId, clock ?? null);
          this.#bump();
        })
        .catch(() => {})
        .finally(() => {
          if (this.#clockPending.get(chainId) === p) this.#clockPending.delete(chainId);
        });
      this.#clockPending.set(chainId, p);
    }
  }
}

/** React hook: the following feed, refreshed on mount when stale. */
export function useFollowFeed(feed) {
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  useEffect(() => {
    feed.ensureFresh();
  }, [feed]);
  return snapshot;
}
