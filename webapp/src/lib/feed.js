// feed.js — the home feed of one chain: a scan that outlives the page
// showing it.
//
// The feed is derived from the chain's scan store — every post inside a
// swept range, newest first — and this controller only decides what to
// sweep next. Sweeps are jobs owned here, not by a component: a job started
// on the home page keeps running after the reader opens a post, an author,
// the settings, or another chain, and every window it fetches lands in the
// store (and localStorage) the moment it arrives. Whoever is showing the
// feed re-reads the store on each change, so posts appear as they are found
// rather than when the whole scan is done — and a page that comes back
// later finds everything the scan read in the meantime.
//
// Three kinds of job, one at a time per chain:
//   refresh  — from the chain head down, until PAGE_SIZE posts are in hand
//              (ranges already read are free, so usually only the blocks
//              mined since the last visit are fetched);
//   more     — from the oldest post on the page down, for another page;
//   gap      — the unswept blocks between two ranges the page straddles.
// Each reads at most the chain's `scanBlocks` from the node (chains.js).

import { useEffect, useSyncExternalStore } from 'react';
import * as seg from './segments';
import * as scanner from './scanner';

/**
 * How far below the reported head a refresh starts. Public gateways answer
 * eth_blockNumber and eth_getLogs from different nodes; the newest block is
 * routinely unknown to the one serving logs, and asking for it costs a
 * failed request (or a failover) on every refresh. The block is read on the
 * next refresh instead — nothing is skipped, only deferred by one round.
 */
const HEAD_LAG = 1n;

export class FeedController {
  #store;
  #io;
  #log;
  #windowSize;
  #floor;
  #scanBlocks;
  #pageSize;
  #getTtlMs;

  /** Rows the page shows (the newest `shown` of every covered post). */
  #shown;
  /** The running job, or null. */
  #job = null;
  /** The running job's latest window, for the scanning indicator. */
  #progress = null;
  #error = null;
  /** After a `more` that found nothing: how many blocks it read. */
  #note = null;
  #refreshedAt = 0;

  #listeners = new Set();
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  constructor({ chainId, store, io, log, windowSize, floor, scanBlocks, pageSize, getTtlMs }) {
    this.chainId = chainId;
    this.#store = store;
    this.#io = io;
    this.#log = log;
    this.#windowSize = BigInt(windowSize);
    this.#floor = BigInt(floor);
    this.#scanBlocks = BigInt(scanBlocks);
    this.#pageSize = pageSize;
    this.#getTtlMs = getTtlMs;
    this.#shown = pageSize;
    // Rows come from the store; any change there (this chain's sweeps, an
    // author walk, a /tx lookup) may change what the feed shows.
    store.subscribe(() => this.#bump());
  }

  get pageSize() {
    return this.#pageSize;
  }

  /** The most blocks one job reads from the node. */
  get scanBlocks() {
    return this.#scanBlocks;
  }

  /** The lowest block worth reading (the contract's deployment block). */
  get floor() {
    return this.#floor;
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

  /**
   * What the page renders. Stable between changes (useSyncExternalStore
   * relies on that), recomputed from the store after any change.
   */
  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const all = this.#store.coveredPosts();
    const coverage = this.#store.feedCoverage();
    const rows = all.slice(0, this.#shown);

    // Consecutive rows from different covered ranges have unswept blocks
    // between them — usually because a scan ran out of budget before it
    // reached ground read on an earlier visit. The page shows a marker
    // there rather than pretending the list is continuous.
    const gaps = [];
    for (let i = 0; i + 1 < rows.length; i++) {
      const upper = seg.segmentAt(coverage, rows[i].block);
      const lower = seg.segmentAt(coverage, rows[i + 1].block);
      if (upper && lower && upper !== lower) {
        gaps.push({ after: i, from: lower[1] + 1n, to: upper[0] - 1n });
      }
    }

    const oldest = rows[rows.length - 1];
    const bottom = oldest
      ? seg.segmentAt(coverage, oldest.block)
      : coverage.length
        ? coverage[coverage.length - 1]
        : null;
    const done = all.length <= this.#shown && bottom != null && bottom[0] <= this.#floor;

    this.#snapshot = {
      rows,
      total: all.length,
      shown: this.#shown,
      gaps,
      job: this.#job?.kind ?? null,
      progress: this.#progress,
      error: this.#error,
      note: this.#note,
      done,
      head: this.#store.feedScanHead(),
      coverage,
      floor: this.#floor,
      scanBlocks: this.#scanBlocks,
      refreshedAt: this.#refreshedAt,
    };
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  };

  // --- Jobs --------------------------------------------------------------

  /** Refresh unless a job is running or the last refresh is still fresh. */
  ensureFresh() {
    if (this.#job) return;
    if (Date.now() - this.#refreshedAt < this.#getTtlMs()) return;
    this.refresh();
  }

  /** Read whatever was mined since the last refresh (joins a running job). */
  refresh() {
    return this.#run('refresh', () => this.#refresh());
  }

  /** Show another page, sweeping older blocks if the store runs out. */
  loadMore() {
    return this.#run('more', () => this.#more());
  }

  /** Sweep the unswept blocks between two ranges the page straddles. */
  fillGap(gap) {
    return this.#run('gap', () => this.#gap(gap));
  }

  retry() {
    this.#error = null;
    return this.refresh();
  }

  #run(kind, fn) {
    if (this.#job) return this.#job.promise;
    this.#error = null;
    const job = { kind, promise: null };
    job.promise = (async () => {
      try {
        await fn();
      } catch (err) {
        this.#error = err?.message || String(err);
      } finally {
        if (this.#job === job) {
          this.#job = null;
          this.#progress = null;
        }
        this.#bump();
      }
    })();
    this.#job = job;
    this.#bump();
    return job.promise;
  }

  /**
   * How many blocks a sweep from `cursor` can fetch before it meets ground
   * already read (or the floor), capped by the budget — the denominator of
   * the progress bar. An estimate: only the first stretch of fresh ground
   * below the cursor is counted.
   */
  #reach(cursor, floor) {
    const coverage = this.#store.feedCoverage();
    const held = seg.segmentAt(coverage, cursor);
    const top = held ? held[0] - 1n : cursor;
    const below = seg.topBelow(coverage, top);
    const bottom = below != null && below + 1n > floor ? below + 1n : floor;
    const span = top - bottom + 1n;
    if (span <= 0n) return 0n;
    return span < this.#scanBlocks ? span : this.#scanBlocks;
  }

  #sweep(opts) {
    const cursor = BigInt(opts.cursor);
    const floor = BigInt(opts.floor ?? this.#floor);
    const reach = this.#reach(cursor, floor);
    return scanner.sweepFeed({
      store: this.#store,
      log: this.#log,
      windowSize: this.#windowSize,
      maxBlocks: this.#scanBlocks,
      fetchRange: (from, to) => this.#io.postsInRange(from, to),
      onProgress: (p) => {
        const fraction = reach > 0n ? Math.min(1, Number(p.fetched) / Number(reach)) : 1;
        this.#progress = { ...p, budget: this.#scanBlocks, fraction };
        // Persist after every window: an interrupted scan keeps its reads.
        if (p.phase === 'fetched') this.#store.persistFeedScan();
        this.#bump();
      },
      ...opts,
    });
  }

  async #refresh() {
    const head = await this.#io.blockNumber();
    const top = head - HEAD_LAG > this.#floor ? head - HEAD_LAG : this.#floor;
    const known = this.#store.feedScanHead();
    if (known != null && top <= BigInt(known)) {
      this.#log.fromCache(
        'feed',
        `head unchanged at ${this.#log.b(known)}`,
        `${this.#store.coveredPosts().length} posts`,
      );
      this.#refreshedAt = Date.now();
      return;
    }
    await this.#sweep({ cursor: top, n: this.#pageSize, floor: this.#floor });
    // The head is recorded only once the sweep completes: a sweep that
    // failed part-way keeps its coverage but is retried from the head next
    // time, so the blocks it didn't reach are not written off.
    this.#store.setFeedScanHead(seg.highest(this.#store.feedCoverage()) ?? top);
    this.#store.persistFeedScan();
    this.#refreshedAt = Date.now();
  }

  async #more() {
    this.#note = null;
    const all = this.#store.coveredPosts();
    const target = this.#shown + this.#pageSize;
    if (all.length >= target) {
      this.#shown = target; // already in the store — no scan needed
      return;
    }
    const displayed = all.slice(0, this.#shown);
    const oldest = displayed[displayed.length - 1] ?? null;
    const coverage = this.#store.feedCoverage();
    // Start AT the oldest shown post's block, not below it: posts published
    // in the same block but earlier within it are still unread, and that
    // block is already covered so revisiting it costs nothing. With nothing
    // shown yet, walk down from the top of coverage (covered ground is free).
    const cursor = oldest ? oldest.block : seg.highest(coverage);
    if (cursor == null) return this.#refresh(); // nothing swept yet
    this.#shown = target; // rows show up as the sweep finds them
    const swept = await this.#sweep({
      cursor,
      n: target - displayed.length,
      olderThan: oldest,
      floor: this.#floor,
    });
    const found = this.#store.coveredPosts().length - all.length;
    if (found === 0 && !swept.reachedFloor) this.#note = { fetched: swept.fetched };
    this.#store.persistFeedScan();
  }

  async #gap({ from, to }) {
    const before = this.#store.coveredPosts().length;
    await this.#sweep({ cursor: BigInt(to), n: Infinity, floor: BigInt(from) });
    // Posts found in a gap belong in the middle of the page; widen the page
    // by that many so nothing at the bottom is pushed out of view.
    this.#shown += this.#store.coveredPosts().length - before;
    this.#store.persistFeedScan();
  }
}

/** React hook: a chain's feed snapshot, refreshed on mount when stale. */
export function useFeed(feed) {
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  useEffect(() => {
    feed.ensureFresh();
  }, [feed]);
  return snapshot;
}
