// hooks.js — small React hooks shared by the reading surfaces.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async read and expose its outcome:
 *   value  — `undefined` while resolving, the result once settled (`null`
 *            is a real result: "not found");
 *   error  — message, when the read threw;
 *   retry  — run it again.
 * A change in `deps` starts over, and a result from a superseded run is
 * dropped. Pass `null` as `fn` to skip (value settles to null).
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ value: undefined, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!fn) {
      setState({ value: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ value: undefined, error: null });
    Promise.resolve()
      .then(fn)
      .then(
        (value) => !cancelled && setState({ value: value ?? null, error: null }),
        (err) => !cancelled && setState({ value: undefined, error: err?.message || String(err) }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { value: state.value, error: state.error, loading: state.value === undefined && !state.error, retry };
}

/**
 * Load the bodies of `rows`, cache-first, a few at a time.
 *
 * The surfaces that search or filter by tag need what the posts SAY, which
 * lives inside the body. Most of those bodies are already in the local cache
 * — the feed reads them for its excerpts — so this is usually free; the ones
 * that are not are fetched a few at a time rather than in a burst that a
 * public node would rate-limit.
 *
 * Returns the bodies keyed the way `rowKey` keys a row, plus how many are
 * still outstanding, so a page can say it is still filling in.
 *
 * @param {(row) => Promise<{ body }>} loadBody usually `view.loadPostBody`
 * @param {Array} rows
 * @param {number} limit how many fetches may be in flight at once
 */
export function useBodiesFor(loadBody, rows, { limit = 4 } = {}) {
  const [bodies, setBodies] = useState(() => new Map());
  const [pending, setPending] = useState(0);
  // Every row ever asked for, so a re-render with the same rows does not
  // start the same reads again.
  const asked = useRef(new Set());

  useEffect(() => {
    if (!loadBody) return undefined;
    let cancelled = false;
    const queue = rows.filter((r) => {
      const key = `${r.chainId}:${String(r.txHash).toLowerCase()}`;
      if (asked.current.has(key)) return false;
      asked.current.add(key);
      return true;
    });
    if (queue.length === 0) return undefined;

    setPending((n) => n + queue.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= queue.length || cancelled) return;
        const row = queue[i];
        try {
          const res = await loadBody(row);
          if (cancelled) return;
          setBodies((cur) => {
            const out = new Map(cur);
            out.set(`${row.chainId}:${String(row.txHash).toLowerCase()}`, res?.body ?? null);
            return out;
          });
        } catch {
          // A body the node will not serve simply never joins the results.
        } finally {
          if (!cancelled) setPending((n) => n - 1);
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
    return () => {
      cancelled = true;
    };
  }, [loadBody, rows, limit]);

  return { bodies, pending };
}
