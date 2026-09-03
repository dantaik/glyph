/**
 * Tiny TTL cache for chain reads. `getTtlMs()` is evaluated per call, so a
 * changed setting applies without touching the cache itself. Concurrent
 * calls for the same key share one in-flight promise.
 *
 * Reserved for the few reads that genuinely change on-chain — the head
 * block and an author's post count. Everything else a reader caches is
 * immutable once mined; see `makeForeverCache`.
 */
export function makeTtlCache(getTtlMs) {
  const store = new Map(); // key -> { at, promise }
  return function cached(key, fn) {
    const ttl = getTtlMs();
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.promise;
    const entry = { at: Date.now(), promise: null };
    entry.promise = Promise.resolve().then(fn);
    store.set(key, entry);
    entry.promise.catch(() => {
      if (store.get(key) === entry) store.delete(key);
    });
    return entry.promise;
  };
}

/**
 * The same cache with no expiry, for reads whose answer cannot change: a
 * post's metadata is fixed by the transaction that carries it, so once this
 * page has read it, asking the node again can only ever return the same
 * bytes. Failures are still dropped, so a retry re-reads.
 */
export function makeForeverCache() {
  const store = new Map(); // key -> Promise
  return function cached(key, fn) {
    const hit = store.get(key);
    if (hit) return hit;
    const promise = Promise.resolve().then(fn);
    store.set(key, promise);
    promise.catch(() => {
      if (store.get(key) === promise) store.delete(key);
    });
    return promise;
  };
}
