// authorList.js — one author's title list on one chain: a walk that
// outlives the page showing it.
//
// The contract keeps a reverse block-linked list per author, so a list is
// read block by block from `latestBlock(author)` down. This controller owns
// that walk the way feed.js owns the feed's sweeps: it runs to completion
// whether or not the author page is still mounted, hands over each block's
// rows as they arrive, and persists after every fetched block. Coming back
// to the author later in the session shows everything the walk found.
//
// The rows here are the walked chain itself — contiguous from the author's
// newest post down — never "every post the store happens to know", which
// could have holes where a feed sweep saw one post and not its neighbours.

import { useEffect, useSyncExternalStore } from 'react';
import * as scanner from './scanner';
import { indexCompare } from './scanStore';

export class AuthorListController {
  #author;
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
  #version = 0;
  #snapshot = null;
  #snapshotVersion = -1;

  constructor({ author, store, io, log, pageSize, getTtlMs }) {
    this.author = author;
    this.#author = author;
    this.#store = store;
    this.#io = io;
    this.#log = log;
    this.#pageSize = pageSize;
    this.#getTtlMs = getTtlMs;
    // What an earlier, completed walk left behind — instantly, no I/O.
    const head = store.authorScanHead(author);
    this.#rows = head != null ? store.knownChain(author, head) : [];
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

  getSnapshot = () => {
    if (this.#snapshot && this.#snapshotVersion === this.#version) return this.#snapshot;
    const rows = this.#rows;
    const oldest = rows[rows.length - 1];
    this.#snapshot = {
      rows,
      job: this.#job?.kind ?? null,
      progress: this.#progress,
      // Index 0 is the author's first post: once it is on the page there is
      // nothing older to walk to.
      hasMore: oldest ? oldest.index > 0n : false,
      error: this.#error,
      refreshedAt: this.#refreshedAt,
    };
    this.#snapshotVersion = this.#version;
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
    const head = await this.#io.latestBlock(author);
    if (head === 0n) {
      this.#rows = []; // the author has never published
      this.#refreshedAt = Date.now();
      return;
    }
    const known = this.#store.authorScanHead(author);
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
    this.#store.setAuthorScanHead(author, head);
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
    const store = this.#store;
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
      const held = store.authorPostsInBlock(author, block).length > 0;
      const rows = await scanner.authorRowsAt({
        store,
        log: this.#log,
        author,
        block,
        fetchBlock,
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

/** React hook: an author list's snapshot, refreshed on mount when stale. */
export function useAuthorList(list) {
  const snapshot = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  useEffect(() => {
    list.ensureFresh();
  }, [list]);
  return snapshot;
}
