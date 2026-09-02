// rpcLog.js — one console line per chain read.
//
// The whole point of the scan cache is that most reads DON'T reach the node,
// and that is only visible if both sides are logged: `node` lines carry the
// request and its latency, `cache` lines carry what was served locally and
// what it saved. A sweep also logs a one-line summary — windows fetched vs.
// blocks reused — so skipped ranges can be read off the console directly.
//
// On by default. Silence it with `localStorage['glyph.log.v1'] = '0'` (or
// `?log=0`); `?log=1` turns it back on.

const KEY = 'glyph.log.v1';

function enabled() {
  try {
    const q = new URLSearchParams(window.location.search).get('log');
    if (q === '0' || q === '1') {
      localStorage.setItem(KEY, q);
      return q === '1';
    }
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return false; // non-browser context (tests, SSR) — stay quiet
  }
}

const TAG = 'background:#4f46e5;color:#fff;border-radius:3px;padding:0 5px';
const NODE = 'color:#b45309;font-weight:600';
const HIT = 'color:#059669;font-weight:600';
const FAIL = 'color:#dc2626;font-weight:600';
const DIM = 'color:#9ca3af';
const TEXT = 'color:inherit';

/** `22540123n` → `"22,540,123"` — BigInt-safe, locale-independent. */
export const b = (v) => (v == null ? '' : BigInt(v).toLocaleString('en-US'));

/** `[from, to]` → `"blocks 22,540,001–22,540,800 (800)"`. */
export const range = (from, to) =>
  `blocks ${b(from)}–${b(to)} (${b(BigInt(to) - BigInt(from) + 1n)})`;

function line(kindStyle, kind, method, detail, summary, tail) {
  if (!enabled()) return;
  console.log(
    `%c glyph %c${kind}%c ${method} %c${detail}%c ${summary}%c${tail ? ' ' + tail : ''}`,
    TAG,
    kindStyle,
    DIM,
    TEXT,
    DIM,
    DIM,
  );
}

/**
 * Run a chain call, logging what was asked and what came back.
 *
 * @param method  RPC method or contract call, e.g. 'eth_getLogs'
 * @param detail  what was asked for, e.g. range(from, to)
 * @param fn      the call itself
 * @param summarize  result → short summary, e.g. '12 posts'
 */
export async function fromNode(method, detail, fn, summarize) {
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    line(NODE, 'node ', method, detail, `→ ${summarize ? summarize(out) : 'ok'}`, `· ${ms}ms`);
    return out;
  } catch (err) {
    const ms = Date.now() - started;
    line(FAIL, 'node ', method, detail, `✗ ${err?.shortMessage || err?.message || err}`, `· ${ms}ms`);
    throw err;
  }
}

/** A read the local caches answered — no node round trip. */
export function fromCache(method, detail, summary, saving = 'no RPC') {
  line(HIT, 'cache', method, detail, `→ ${summary}`, `· ${saving}`);
}

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

/** One line at startup: the chain being read and its endpoints, in order. */
export function endpoints(chainName, urls) {
  line(
    HIT,
    'chain',
    chainName,
    `${urls.length} endpoint${urls.length === 1 ? '' : 's'}`,
    `→ ${urls.map(host).join(' → ')}`,
    '· first one wins, rest are fallbacks',
  );
}

/**
 * An endpoint failed and the next one in the list is taking over — the whole
 * point of keeping more than one. `cooled` marks a node failure (network,
 * timeout, rate limit), which also benches that endpoint for a short while;
 * without it the endpoint merely couldn't answer this particular request.
 */
export function endpointFailed(url, method, err, { cooled, next }) {
  line(
    FAIL,
    'rpc  ',
    host(url),
    method,
    `\u2717 ${err?.shortMessage || err?.message || err}`,
    `\u00b7 ${cooled ? 'benched 30s, ' : ''}trying ${host(next)}`,
  );
}

/** The answering node refused the range; the sweep retries with less. */
export function windowShrunk(span) {
  line(FAIL, 'rpc  ', 'eth_getLogs', 'range refused', `↓ window now ${b(span)} blocks`, '· retrying');
}

/** One line closing a feed sweep: what it fetched against what it reused. */
export function sweepDone({ from, to, posts, windows, fetched, reused }) {
  line(
    windows ? NODE : HIT,
    'sweep',
    `${b(from)} → ${b(to)}`,
    `${windows} window${windows === 1 ? '' : 's'} fetched (${b(fetched)} blocks)`,
    `→ ${posts} posts`,
    `· ${b(reused)} blocks reused`,
  );
}
