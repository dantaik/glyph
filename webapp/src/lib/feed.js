// feed.js — the home feed of one chain: a scan that outlives the page
// showing it.
//
// The rows themselves live in the chain's scan store — every post inside a
// swept range — and what the page shows is the merged feed's business
// (mergedFeed.js, over one chain or several): this controller only decides
// what to sweep next. Sweeps are jobs owned here, not by a component: a job
// started on the home page keeps running after the reader opens a post, an
// author, the settings, and every window it fetches lands in the store (and
// localStorage) the moment it arrives. Whoever is showing the feed re-reads
// the store on each change, so posts appear as they are found rather than
// when the whole scan is done — and a page that comes back later finds
// everything the scan read in the meantime.
//
// Three kinds of job, one at a time per chain:
//   refresh  — from the chain head down, until PAGE_SIZE posts are in hand
//              (ranges already read are free, so usually only the blocks
//              mined since the last visit are fetched);
//   more     — from the bottom of the head-contiguous range down, for
//              another page of coverage (extend);
//   gap      — the unswept blocks between two ranges the page straddles.
// Each reads at most the chain's `scanBlocks` from the node (chains.js).

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

  /** The running job, or null. */
  #job = null;
  /** The running job's latest window, for the scanning indicator. */
  #progress = null;
  #error = null;
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
    // Coverage comes from the store; any change there (this chain's sweeps,
    // an author walk, a /tx lookup) may change what the feed shows.
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
   * The scan's state: what has been read, and what is being read. Stable
   * between changes (useSyncExternalStore relies on that), recomputed from
   * the store after any change.
   */
  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const coverage = this.#store.feedCoverage();
    // The range read continuously from the head down: everything the chain
    // published between its bottom and the head is known. Lower ranges sit
    // below a gap and don't extend that claim — a hole may hold posts, so
    // the chain is `exhausted` only when that one range reaches the floor.
    const top = coverage.length ? coverage[coverage.length - 1] : null;
    const exhausted = top != null && top[0] <= this.#floor;

    this.#snapshot = {
      job: this.#job?.kind ?? null,
      progress: this.#progress,
      error: this.#error,
      head: this.#store.feedScanHead(),
      coverage,
      top,
      exhausted,
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

  /**
   * Deepen coverage by a page: sweep from the bottom of the head-contiguous
   * range down. Resolves to `{ fetched, found, reachedFloor }`, or to
   * whatever a job already running resolves to when it joins one.
   */
  extend() {
    return this.#run('more', () => this.#extend());
  }

  /** Sweep the unswept blocks between two ranges the page straddles (`{ from, to }`). */
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
      let out;
      try {
        out = await fn();
      } catch (err) {
        this.#error = err?.message || String(err);
      } finally {
        if (this.#job === job) {
          this.#job = null;
          this.#progress = null;
        }
        this.#bump();
      }
      return out;
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

  async #extend() {
    const coverage = this.#store.feedCoverage();
    const top = coverage.length ? coverage[coverage.length - 1] : null;
    if (!top) {
      await this.#refresh(); // nothing swept yet: the head is the place to start
      return { fetched: 0n, found: 0, reachedFloor: false };
    }
    if (top[0] <= this.#floor) return { fetched: 0n, found: 0, reachedFloor: true };
    const before = this.#store.coveredPosts().length;
    // The cursor is the first uncovered block; a lower range met on the way
    // is served from the store, and the two ranges merge into one.
    const swept = await this.#sweep({ cursor: top[0] - 1n, n: this.#pageSize, floor: this.#floor });
    this.#store.persistFeedScan();
    return {
      fetched: swept.fetched,
      found: this.#store.coveredPosts().length - before,
      reachedFloor: swept.reachedFloor,
    };
  }

  async #gap({ from, to }) {
    await this.#sweep({ cursor: BigInt(to), n: Infinity, floor: BigInt(from) });
    this.#store.persistFeedScan();
  }
}
