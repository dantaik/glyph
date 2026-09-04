// bodyIndex.js — what the bodies this browser has read actually say.
//
// The contract indexes one thing: an author. Everything else a reader might
// want to find something by — a tag, a reply, a series — lives inside the
// compressed body, where no node can filter on it. Building that index on a
// server is exactly the off-chain dependency this project refuses to have.
//
// So the index is local and is made of what has already been read. Every body
// the reader decodes is filed here, and the surfaces built on it (tags,
// search, the reply lists under a post) say plainly that they cover the posts
// this browser has read, and offer the ordinary "load earlier posts" as the
// way to cover more. That honesty is the feature: a claim of completeness
// would be a lie, and an index that fetched more would be a crawler.
//
// One index per chain, like everything else: a transaction hash means nothing
// across chains.

import { getCachedBodies } from './cache';
import { parsePostRef } from './glyphRefs';
import { getScanStore } from './scanStore';

/** The relations a post can declare about another post (spec §5.1). */
export const RELATION_KEYS = ['re', 'supersedes', 'prev'];

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** The key a backlink is filed under: chain, transaction, event. */
const targetKey = ({ chainId, txHash, eventIndex = 0 }) =>
  `${Number(chainId)}:${String(txHash).toLowerCase()}:${Number(eventIndex)}`;


export function createBodyIndex(chainId, { store = null } = {}) {
  const id = Number(chainId);
  const scan = store ?? getScanStore(id);

  const bodies = new Map(); // txHash -> body
  const rows = new Map(); // txHash -> the post row, once known
  const byTag = new Map(); // tag -> Set<txHash>
  const backlinks = new Map(); // targetKey -> Map<txHash, kind>
  // txHash -> { name, part }. Filed by transaction rather than by author,
  // because who wrote a post is often not known at the moment its body is
  // read — a body fetched by deep link arrives before any list has said
  // whose it is — while the row that says so may turn up later. The author
  // is therefore matched when the question is asked, not when the body is
  // filed.
  const series = new Map();

  const listeners = new Set();
  let version = 0;
  const notify = () => {
    version += 1;
    for (const fn of listeners) fn();
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  /** The row for a transaction, from whatever the scan store knows now. */
  const rowFor = (txHash) => rows.get(txHash) ?? scan.knownPostByTx(txHash, 0) ?? null;

  // A row arriving is as much a change as a body arriving: the answers below
  // resolve rows when they are asked, so whoever is watching has to be told.
  scan.subscribe(() => notify());

  /**
   * File one body. `post` may be null — a body can be fetched by hash alone,
   * before any list has told us whose it is — and the row is picked up later
   * from the scan store, which is why queries resolve rows at read time.
   */
  function add(post, body) {
    const txHash = String(post?.txHash ?? body?.txHash ?? '').toLowerCase();
    if (!txHash || !body) return;
    const known = bodies.has(txHash);
    bodies.set(txHash, body);
    if (post) rows.set(txHash, post);
    if (known) {
      notify(); // the row may have arrived even though the body had not changed
      return;
    }

    for (const tag of body.tags ?? []) {
      const key = norm(tag);
      if (!key) continue;
      if (!byTag.has(key)) byTag.set(key, new Set());
      byTag.get(key).add(txHash);
    }

    const meta = body.meta ?? {};
    for (const kind of RELATION_KEYS) {
      const ref = parsePostRef(meta[kind], id);
      if (!ref) continue;
      const key = targetKey(ref);
      if (!backlinks.has(key)) backlinks.set(key, new Map());
      backlinks.get(key).set(txHash, kind);
    }

    if (meta.series) series.set(txHash, { name: meta.series, part: Number(meta.part) || null });
    notify();
  }

  // --- Warming from what earlier visits already read ---------------------

  let warmed = null;

  /**
   * Fold every body this browser has cached for this chain into the index.
   * Done once per session, lazily: the index is only interesting when
   * something asks it a question.
   */
  /**
   * Read the cached bodies into the index. `force` re-reads: an archive
   * import writes bodies straight into the cache, and the index has to be
   * told rather than wait for the next visit.
   */
  function warm({ force = false } = {}) {
    if (force) warmed = null;
    if (!warmed) {
      warmed = getCachedBodies(id)
        .then((entries) => {
          for (const { txHash, body } of entries) add(scan.knownPostByTx(txHash, 0), { ...body, txHash });
        })
        .catch(() => {}); // no IndexedDB: the session's own reads still index
    }
    return warmed;
  }

  // --- Questions ----------------------------------------------------------

  /** Every post this browser has read that carries `tag`, newest first. */
  function rowsWithTag(tag) {
    const hits = byTag.get(norm(tag));
    if (!hits) return [];
    return [...hits].map(rowFor).filter(Boolean).sort(byBlockDesc);
  }

  /** Every tag seen, with how many posts carry it, most used first. */
  function tagsWithCounts() {
    return [...byTag.entries()]
      .map(([tag, set]) => ({ tag, count: set.size }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /**
   * Posts that point at this one: `[{ kind, post }]`, newest first. `kind` is
   * how they point — a reply, a replacement, a continuation.
   */
  function backlinksTo(txHash, eventIndex = 0) {
    const hits = backlinks.get(targetKey({ chainId: id, txHash, eventIndex }));
    if (!hits) return [];
    return [...hits.entries()]
      .map(([from, kind]) => ({ kind, post: rowFor(from) }))
      .filter((entry) => entry.post)
      .sort((a, b) => byBlockDesc(a.post, b.post));
  }

  /**
   * One author's series, in reading order: `[{ part, post }]`.
   *
   * A series belongs to whoever writes it, so two authors may use the same
   * name for different things and neither should see the other's parts.
   */
  function seriesOf(author, name) {
    const wanted = norm(name);
    const who = norm(author);
    const out = [];
    for (const [txHash, entry] of series) {
      if (norm(entry.name) !== wanted) continue;
      const post = rowFor(txHash);
      if (!post || norm(post.author) !== who) continue;
      out.push({ part: entry.part, post });
    }
    return out.sort((a, b) => (a.part ?? Infinity) - (b.part ?? Infinity));
  }

  /**
   * The transactions related to this post whose ROW this browser does not
   * know yet.
   *
   * The index learns relations from bodies, which can be read long before
   * anything says who wrote them or when — a body cached on an earlier
   * visit, for instance. Until the row is known there is nothing to show,
   * and the row is one cheap receipt read away. So the page asks for this
   * list and resolves it; the answers below then fill in on their own.
   */
  function unresolvedRelated(txHash, eventIndex = 0, seriesName = null) {
    const wanted = new Set();
    const hits = backlinks.get(targetKey({ chainId: id, txHash, eventIndex }));
    for (const from of hits?.keys() ?? []) wanted.add(from);
    if (seriesName) {
      const name = norm(seriesName);
      for (const [hash, entry] of series) if (norm(entry.name) === name) wanted.add(hash);
    }
    return [...wanted].filter((hash) => !rowFor(hash));
  }

  /** The body held for a transaction, if this browser has read it. */
  const bodyOf = (txHash) => bodies.get(String(txHash).toLowerCase()) ?? null;

  /** How many posts the answers above are drawn from. */
  const size = () => bodies.size;

  return {
    chainId: id,
    add,
    warm,
    subscribe,
    getVersion: () => version,
    rowsWithTag,
    tagsWithCounts,
    backlinksTo,
    seriesOf,
    unresolvedRelated,
    bodyOf,
    size,
  };
}

const byBlockDesc = (a, b) => {
  if (a.block !== b.block) return b.block > a.block ? 1 : -1;
  return (b.logIndex ?? 0) - (a.logIndex ?? 0);
};

const indexes = new Map(); // chainId -> index

/** The index for `chainId`, created on first use and kept for the page. */
export function getBodyIndex(chainId) {
  const id = Number(chainId);
  let index = indexes.get(id);
  if (!index) {
    index = createBodyIndex(id);
    indexes.set(id, index);
  }
  return index;
}
