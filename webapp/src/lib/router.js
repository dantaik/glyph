// router.js — tiny URL-state hook. No deps.
//
// Reads and writes the URL as a key/value map. The state lives at module
// level and every hook instance subscribes to the same updates, so a
// navigate() from ANY component (Header, Reader, …) re-renders all of them
// — history.replaceState fires no popstate, so a per-instance state would
// silently drift apart.
//
// The first path segment may name a chain: `/` reads every chain at once,
// `/taiko` reads Taiko alone — a FILTER, carried by the URL and nothing
// else. Post routes always name their chain (`/taiko/tx/0x…/0`): the same
// hash means different things on different chains, and a shared link has
// to say which. That segment is an address, not a choice: opening a post
// from the merged feed doesn't switch the reader to that chain, so the
// choice — which chain the reader asked to look at — is remembered here
// and inherited by every route that doesn't say otherwise.
//
// Two URL shapes, one route vocabulary. Served over http(s) the routes are
// real paths (`/taiko/tx/0x…/0?tab=write`) that the host rewrites to
// index.html. In the downloadable single-file build there is no host to
// rewrite anything — and off a file:// page pushState is refused on the
// opaque origin anyway — so the very same routes live in the fragment
// (`#/taiko/tx/0x…/0?tab=write`) and navigation goes through location.hash.

import { useEffect, useState, useCallback } from 'react';
import { chainFromSlug, chainSlug } from './chains';
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

export function readParams() {
  if (typeof window === 'undefined') return {};
  const { path, search } = currentUrl();
  const sp = new URLSearchParams(search);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;

  // A chain segment comes off the front; what is left is the route. `chain`
  // is null when the URL names none — every chain, or a chainless post link.
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
 * The chain the reader chose to look at (null: every chain). A post URL's
 * chain is where the post is, not a choice, so it leaves this alone — a
 * post opened by its link, with no choice made yet, leads back to every
 * chain.
 */
let choice = null;
let state = readParams();
choice = choiceFrom(state);

function choiceFrom(s) {
  return s.tx ? choice : (s.chain ?? null);
}

/** The filter a route inherits: given `chain` (null clears it), else the choice. */
export const inheritedChain = (next) =>
  Object.prototype.hasOwnProperty.call(next, 'chain') ? next.chain ?? null : choice;

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
  const route = next.tx
    ? `/tx/${next.tx}${next.txEvent != null ? '/' + next.txEvent : ''}`
    : next.author
      ? `/author/${next.author}`
      : next.scan
        ? '/scan'
        : next.settings
          ? '/settings'
          : '/';
  // A post is on one chain: its URL must say which. Everything else carries
  // the chain only as a filter.
  const chain = next.tx ? (next.chain ?? null) : inheritedChain(next);
  if (next.tx && chain == null && import.meta.env.DEV) {
    throw new Error('a post route must name its chain: navigate({ chain, tx, txEvent })');
  }
  const prefix = chain != null ? `/${chainSlug(chain)}` : '';
  const path = `${prefix}${route === '/' ? (prefix ? '' : '/') : route}`;
  return `${path}${search ? `?${search}` : ''}`;
}

/** The href an <a> should carry for `next` — `#`-prefixed off a file:// page. */
export function hrefFor(next) {
  const url = buildUrl(next);
  return HASH_MODE ? `#${url}` : url;
}

function readState() {
  const next = readParams();
  choice = choiceFrom(next);
  return next;
}

/** Go to the route `next` describes (the hook's navigate, usable outside React). */
export function navigateTo(next, { replace = false } = {}) {
  const url = buildUrl(next);
  if (!next.tx) choice = inheritedChain(next);
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
}

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

  const navigate = useCallback((next, opts) => navigateTo(next, opts), []);

  return [state, navigate];
}

/** A query param off the current URL, wherever the query lives. */
export function queryParam(name) {
  return new URLSearchParams(currentUrl().search).get(name);
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
