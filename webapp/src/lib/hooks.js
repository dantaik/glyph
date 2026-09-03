// hooks.js — small React hooks shared by the reading surfaces.

import { useCallback, useEffect, useState } from 'react';

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
