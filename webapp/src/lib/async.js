// async.js — the little concurrency helper the chain reads share.

/**
 * Run `fn` over `items` with at most `limit` in flight; results in order.
 *
 * Public nodes are happier with a few requests at a time than with a burst
 * of thirty, and the caller usually wants the answers lined up with the
 * questions, so this keeps the order regardless of which finished first.
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
