// router.js — tiny URL-state hook. No deps.
//
// Reads and writes `window.location.search` as a key/value map. The state
// lives at module level and every hook instance subscribes to the same
// updates, so a navigate() from ANY component (Header, Reader, …) re-renders
// all of them — history.replaceState fires no popstate, so a per-instance
// state would silently drift apart.
//
// Every route names the chain it is read on, as its first segment:
// /ethereum, /taiko/tx/0x…/0, /taiko/author/0x…. The same post hash means
// different things on different chains, so an address that omits the chain
// is ambiguous — and the address bar, not a stored preference, is what a
// shared link carries. The chain segment is therefore the source of truth:
// App follows it into the chain switcher, and everything that changes the
// chain navigates rather than setting it directly.
//
// Two URL shapes, one route vocabulary. Served over http(s) the routes are
// real paths (`/tx/0x…/0?tab=write`) that the host rewrites to index.html.
// In the downloadable single-file build there is no host to rewrite anything
// — and off a file:// page pushState is refused on the opaque origin anyway —
// so the very same routes live in the fragment (`#/tx/0x…/0?tab=write`) and
// navigation goes through location.hash instead.

import { useEffect, useState, useCallback } from 'react';
import { chainFromSlug, chainSlug } from './chains';
import { getActiveChainId, setActiveChain } from './config';
import { IS_OFFLINE_BUILD } from './offline';

const EVT = 'cairn:urlstate';

/**
 * Whether routes live in the fragment. True whenever nothing is going to
 * rewrite `/tx/…` back to the app: opened from disk, or the single-file
 * build however it is being served.
 */
export const HASH_MODE =
  IS_OFFLINE_BUILD || (typeof window !== 'undefined' && window.location.protocol === 'file:');

/** The route path and query string of the current URL, whichever mode. */
function currentUrl() {
  if (typeof window === 'undefined') return { path: '/', search: '' };
  if (!HASH_MODE) return { path: window.location.pathname, search: window.location.search };
  const raw = window.location.hash.slice(1) || '/';
  const q = raw.indexOf('?');
  return q === -1 ? { path: raw, search: '' } : { path: raw.slice(0, q), search: raw.slice(q) };
}

function readParams() {
  if (typeof window === 'undefined') return {};
  const { path, search } = currentUrl();
  const sp = new URLSearchParams(search);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;

  // The chain segment comes off the front; what is left is the route. A URL
  // that names no chain — a bare `/`, or a link from before the prefix —
  // parses as the route alone, with `chain` null for App to canonicalise.
  const [, head = '', tail = ''] = path.match(/^\/([^/]*)(.*)$/) ?? [];
  const chain = chainFromSlug(head);
  out.chain = chain;
  const route = chain ? tail || '/' : path;

  // Path deep links: /tx/0x<hash> → tx; /author/0x<addr> → author.
  const mTx = route.match(/^\/tx\/(0x[0-9a-fA-F]{64})(?:\/(\d+))?\/?$/);
  if (mTx) {
    out.tx = mTx[1];
    if (mTx[2] != null) out.txEvent = mTx[2];
  }
  const mAuthor = route.match(/^\/author\/(0x[0-9a-fA-F]{40})\/?$/);
  if (mAuthor) {
    out.author = mAuthor[1];
  } else if (out.author) {
    out.authorFromQuery = true; // legacy ?author= link
  }
  // Local status / configuration pages.
  if (route.match(/^\/scan\/?$/)) out.scan = '1';
  if (route.match(/^\/settings\/?$/)) out.settings = '1';
  return out;
}

/**
 * The route `next` describes, as a path + query string — the single place
 * that knows how a state map becomes a URL. `navigate` writes it; `hrefFor`
 * hands it to an <a> so middle-click and "open in new tab" land in the
 * same place the click handler would.
 */
function buildUrl(next) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    // These live in the path, never in the query.
    if (
      k === 'chain' ||
      k === 'tx' ||
      k === 'txEvent' ||
      k === 'author' ||
      k === 'scan' ||
      k === 'settings' ||
      k === 'authorFromQuery'
    )
      continue;
    if (v != null && v !== '') sp.set(k, String(v));
  }
  // Dev demo mode (fixtures) follows in-app navigation.
  if (next.fixtures == null && state.fixtures) sp.set('fixtures', state.fixtures);
  const search = sp.toString();
  // Deep links use their paths; everything else is the root path
  // with query params.
  const route = next.tx
    ? `/tx/${next.tx}${next.txEvent != null ? '/' + next.txEvent : ''}`
    : next.author
      ? `/author/${next.author}`
      : next.scan
        ? '/scan'
        : next.settings
          ? '/settings'
          : '/';
  // Always prefixed: a URL the app writes always says which chain it is on.
  const prefix = `/${chainSlug(next.chain ?? getActiveChainId())}`;
  return `${prefix}${route === '/' ? '' : route}${search ? `?${search}` : ''}`;
}

/** The href an <a> should carry for `next` — `#`-prefixed off a file:// page. */
export function hrefFor(next) {
  const url = buildUrl(next);
  return HASH_MODE ? `#${url}` : url;
}

/**
 * Read the URL and adopt the chain it names — before anything renders.
 *
 * It has to happen here rather than in an effect: a post is looked up on the
 * chain the address names, and an effect runs after the first render, so the
 * lookup would go to last session's chain, miss, and bounce to the feed.
 */
function readState() {
  const next = readParams();
  if (next.chain != null) setActiveChain(next.chain);
  return next;
}

let state = readState();

export function useUrlState() {
  const [, force] = useState(0);

  useEffect(() => {
    const sync = () => {
      state = readState();
      force((n) => n + 1);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener(EVT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener(EVT, sync);
    };
  }, []);

  const navigate = useCallback((next, { replace = false } = {}) => {
    const url = buildUrl(next);
    if (HASH_MODE) {
      // pushState is refused on file://'s opaque origin, so the fragment is
      // written directly. A same-value assignment fires no hashchange — the
      // explicit re-read below covers that.
      if (replace) window.location.replace(`#${url}`);
      else window.location.hash = url;
    } else if (replace) {
      window.history.replaceState({}, '', url);
    } else {
      window.history.pushState({}, '', url);
    }
    state = readState();
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return [state, navigate];
}

/** A query param off the current URL, wherever the query lives. */
export function queryParam(name) {
  return new URLSearchParams(currentUrl().search).get(name);
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
