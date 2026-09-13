// authorList.js — one author's title list on one chain: walks that outlive
// the page showing them.
//
// The contracts keep a reverse block-linked list per author — one on v1,
// one on v2 — so a list is read block by block from `latestBlock(author)`
// down, once per contract. An AuthorStreamController owns one such walk
// the way feed.js owns the feed's sweeps: it runs to completion whether or
// not the author page is still mounted, hands over each block's rows as
// they arrive, and persists after every fetched block. Coming back to the
// author later in the session shows everything the walk found.
//
// The rows of a stream are the walked chain itself — contiguous from the
// author's newest post on that contract down — never "every post the store
// happens to know", which could have holes where a feed sweep saw one post
// and not its neighbours.
//
// AuthorListController is what the rest of the app sees: one controller per
// (author, chain), owning one stream per contract and merging them by block.
// Within a chain, block heights order posts exactly, so the merge needs no
// clock; what it needs is honesty about completeness. A stream walked to
// block 500 says nothing about its posts below 500, so a row of the other
// stream below 500 is held back until that stream catches up — "load more"
// deepens whichever stream stopped highest, and the rows come out in order.

import * as scanner from './scanner';
import { feedCompare, indexCompare } from './scanStore';

class AuthorStreamController {
  #author;
  #version;
  #store;
  #io;
  #log;
  #pageSize;
  #getTtlMs;

  /** The walked chain, newest first. */
  #rows;
  #job = null;
  /** The running walk's latest block and tally, for the scanning indicator. */
  #progress = null;
  #error = null;
  #refreshedAt = 0;

  #listeners = new Set();
  #version_ = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  constructor({ author, version, store, io, log, pageSize, getTtlMs }) {
    this.author = author;
    this.version = Number(version);
    this.#author = author;
    this.#version = Number(version);
    this.#store = store;
    this.#io = io;
    this.#log = log;
    this.#pageSize = pageSize;
    this.#getTtlMs = getTtlMs;
    // What an earlier, completed walk left behind — instantly, no I/O.
    const head = store.authorScanHead(author, this.#version);
    this.#rows = head != null ? store.knownChain(author, head, this.#version) : [];
  }

  subscribe = (fn) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  #bump() {
    this.#version_ += 1;
    for (const fn of this.#listeners) fn();
  }

  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version_) return this.#snapshot;
    const rows = this.#rows;
    const oldest = rows[rows.length - 1];
    this.#snapshot = {
      version: this.#version,
      rows,
      job: this.#job?.kind ?? null,
      progress: this.#progress,
      // Index 0 is the author's first post on this contract: once it is on
      // the page there is nothing older to walk to.
      hasMore: oldest ? oldest.index > 0n : false,
      error: this.#error,
      refreshedAt: this.#refreshedAt,
    };
    this.#snapshotVersion = this.#version_;
    return this.#snapshot;
  };

  ensureFresh() {
    if (this.#job) return;
    if (Date.now() - this.#refreshedAt < this.#getTtlMs()) return;
    this.refresh();
  }

  refresh() {
    return this.#run('refresh', () => this.#refresh());
  }

  loadMore() {
    return this.#run('more', () => this.#more());
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

  async #refresh() {
    const author = this.#author;
    const head = await this.#io.latestBlock(author, this.#version);
    if (head === 0n) {
      this.#rows = []; // the author has never published on this contract
      this.#refreshedAt = Date.now();
      return;
    }
    const known = this.#store.authorScanHead(author, this.#version);
    if (known != null && head <= BigInt(known) && this.#rows.length > 0) {
      this.#log.fromCache(
        'author',
        `head unchanged at ${this.#log.b(known)}`,
        `${this.#rows.length} posts`,
      );
      this.#refreshedAt = Date.now();
      return;
    }
    // Walk from the new head until the chain meets what is already on the
    // page (`connectTo`): everything mined since the last visit, however
    // much, plus enough of the rest for a full first page.
    await this.#walk({
      from: head,
      target: Math.max(this.#pageSize, this.#rows.length),
      connectTo: known != null ? BigInt(known) : null,
    });
    this.#store.setAuthorScanHead(author, head, this.#version);
    this.#store.persistAuthorScan(author);
    this.#refreshedAt = Date.now();
  }

  async #more() {
    const oldest = this.#rows[this.#rows.length - 1];
    if (!oldest || oldest.index === 0n) return;
    await this.#walk({
      from: oldest.block,
      skipIndex: oldest.index,
      target: this.#rows.length + this.#pageSize,
    });
    this.#store.persistAuthorScan(this.#author);
  }

  /**
   * Follow the chain from `from` (skipping posts at or above `skipIndex`
   * in that first block) until the page holds `target` rows — and, when
   * `connectTo` is given, at least until the walk reaches that block, so
   * the new rows join the old ones without a hole between them.
   */
  async #walk({ from, skipIndex = null, target, connectTo = null }) {
    const author = this.#author;
    const version = this.#version;
    const store = this.#store;
    // One fetch reads the block for every contract; the store keeps them
    // all, and this walk takes its own.
    const fetchBlock = (block) => this.#io.authorPostsInBlock(author, block);
    let block = BigInt(from);
    let skip = skipIndex == null ? null : BigInt(skipIndex);
    const startCount = this.#rows.length;
    const wanted = target - startCount;
    while (block > 0n) {
      const connected = connectTo == null || block <= connectTo;
      if (connected && this.#rows.length >= target) break;
      this.#progress = {
        block,
        found: this.#rows.length - startCount,
        target: wanted > 0 ? wanted : null,
      };
      this.#bump();
      const held = store.authorPostsInBlock(author, block, version).length > 0;
      const rows = await scanner.authorRowsAt({
        store,
        log: this.#log,
        author,
        block,
        fetchBlock,
        version,
      });
      if (!held) store.persistAuthorScan(author); // keep what was just read
      if (rows.length === 0) break;
      const fresh = skip == null ? rows : rows.filter((m) => m.index < skip);
      skip = null;
      if (fresh.length) this.#merge(fresh);
      // The chain must strictly descend; anything else (a truncated cache,
      // a reorg, an inconsistent node) would loop forever.
      const next = rows[rows.length - 1].prevBlock;
      if (next >= block) break;
      block = next;
    }
  }

  #merge(fresh) {
    const byIndex = new Map(this.#rows.map((r) => [r.index, r]));
    for (const row of fresh) byIndex.set(row.index, row);
    this.#rows = [...byIndex.values()].sort(indexCompare);
    this.#bump();
  }
}

/**
 * Within one chain: newest block first, then newest in the block, then the
 * older contract first — the order two streams of one author interleave in.
 */
function chainCompare(a, b) {
  const byBlock = feedCompare(a, b);
  if (byBlock !== 0) return byBlock;
  return (a.version ?? 1) - (b.version ?? 1);
}

export class AuthorListController {
  #streams;
  #listeners = new Set();
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  /**
   * @param versions the contract versions to walk; by default what the
   *   chain's I/O reads (`io.versions`), else what the store was told, else
   *   v1 alone
   */
  constructor({ author, store, io, log, pageSize, getTtlMs, versions = null }) {
    this.author = author;
    const list = versions ?? io?.versions ?? store?.versions ?? [1];
    this.#streams = [...new Set(list.map(Number))]
      .sort((a, b) => a - b)
      .map((version) => new AuthorStreamController({ author, version, store, io, log, pageSize, getTtlMs }));
    for (const s of this.#streams) s.subscribe(() => this.#bump());
  }

  /** The walk on one contract, for tests and for callers that need one stream. */
  stream(version) {
    return this.#streams.find((s) => s.version === Number(version)) ?? null;
  }

  get versions() {
    return this.#streams.map((s) => s.version);
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

  /**
   * How far down a stream is known: the block of its oldest walked row
   * while it has more, 0 once it holds the author's first post on that
   * contract. A stream that has not answered yet claims nothing either way,
   * so the page shows what the others hold rather than wait for it.
   */
  static #bound(s) {
    return s.hasMore && s.rows.length ? s.rows[s.rows.length - 1].block : 0n;
  }

  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const snaps = this.#streams.map((s) => s.getSnapshot());
    // Below the highest bound a stream may still hold posts nobody has read,
    // so rows down there wait — and only ever come out in order.
    let frontier = 0n;
    for (const s of snaps) {
      const b = AuthorListController.#bound(s);
      if (b > frontier) frontier = b;
    }
    const merged = snaps.flatMap((s) => s.rows).sort(chainCompare);
    const rows = merged.filter((r) => r.block >= frontier);
    const running = snaps.find((s) => s.job);
    const failed = snaps.find((s) => s.error);
    this.#snapshot = {
      rows,
      job: running?.job ?? null,
      progress: running?.progress ?? null,
      hasMore: snaps.some((s) => s.hasMore) || rows.length < merged.length,
      error: failed?.error ?? null,
      // Stale as soon as any stream is: the TTL is the oldest answer's.
      refreshedAt: Math.min(...snaps.map((s) => s.refreshedAt)),
      streams: snaps,
    };
    this.#snapshotVersion = this.#version;
    return this.#snapshot;
  };

  ensureFresh() {
    for (const s of this.#streams) s.ensureFresh();
  }

  /** Read every stream from its head. Never rejects: failures land in `error`. */
  refresh() {
    return Promise.all(this.#streams.map((s) => s.refresh())).then(() => undefined);
  }

  /**
   * Deepen the stream that stopped highest — the one holding the rest of
   * the list back — by a page. Nothing to do once every stream has reached
   * the author's first post.
   */
  loadMore() {
    let leader = null;
    let best = -1n;
    for (const s of this.#streams) {
      const snap = s.getSnapshot();
      if (!snap.hasMore) continue;
      const b = AuthorListController.#bound(snap);
      if (leader == null || b > best) {
        leader = s;
        best = b;
      }
    }
    return leader ? leader.loadMore() : Promise.resolve();
  }

  /** Retry the streams that failed; with none failed, refresh them all. */
  retry() {
    const failed = this.#streams.filter((s) => s.getSnapshot().error);
    const wanted = failed.length ? failed : this.#streams;
    return Promise.all(wanted.map((s) => s.retry())).then(() => undefined);
  }
}
