/**
 * Tiny TTL cache for chain reads. `getTtlMs()` is evaluated per call, so
 * the Settings-configured TTL applies without touching the cache itself.
 * Concurrent calls for the same key share one in-flight promise.
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
