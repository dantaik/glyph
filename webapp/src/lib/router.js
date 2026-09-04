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
// Routes are real paths (`/taiko/tx/0x…/0?tab=write`) that the host
// rewrites to index.html (vercel.json; test/e2e/serve.mjs does the same).
//
// One query param is read here rather than by a component: `?headless=1`
// on a post route, which takes the app chrome off (see `isHeadless`).

import { useEffect, useState, useCallback } from 'react';
import { chainFromSlug, chainSlug } from './chains';

const EVT = 'cairn:urlstate';

/** The route path and query string of the current URL. */
function currentUrl() {
  if (typeof window === 'undefined') return { path: '/', search: '' };
  return { path: window.location.pathname, search: window.location.search };
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
  // Finding things among what this browser has read.
  const mTag = route.match(/^\/tag\/(.+?)\/?$/);
  if (mTag) {
    try {
      out.tag = decodeURIComponent(mTag[1]).trim();
    } catch {
      out.tag = mTag[1].trim(); // a malformed escape is still a tag to try
    }
  }
  if (route.match(/^\/search\/?$/)) out.search = '1';
  if (route.match(/^\/following\/?$/)) out.following = '1';
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
      k === 'tag' ||
      k === 'search' ||
      k === 'following' ||
      k === 'authorFromQuery'
    )
      continue;
    if (v != null && v !== '') sp.set(k, String(v));
  }
  // Dev demo mode (fixtures) follows in-app navigation.
  if (next.fixtures == null && state.fixtures) sp.set('fixtures', state.fixtures);
  const search = sp.toString();
  // The path a state map describes. These are mutually exclusive surfaces,
  // so this reads as a list rather than as a nest of ternaries.
  const route = (() => {
    if (next.tx) return `/tx/${next.tx}${next.txEvent != null ? `/${next.txEvent}` : ''}`;
    if (next.author) return `/author/${next.author}`;
    if (next.tag) return `/tag/${encodeURIComponent(next.tag)}`;
    if (next.following) return '/following';
    if (next.search) return '/search';
    if (next.scan) return '/scan';
    if (next.settings) return '/settings';
    return '/';
  })();
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

/** The href an <a> should carry for `next`. */
export function hrefFor(next) {
  return buildUrl(next);
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
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
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
    window.addEventListener(EVT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVT, sync);
    };
  }, []);

  const navigate = useCallback((next, opts) => navigateTo(next, opts), []);

  return [state, navigate];
}

/** A query param off the current URL. */
export function queryParam(name) {
  return new URLSearchParams(currentUrl().search).get(name);
}

/**
 * `?headless=1` on a post route: the page is the letter and nothing else —
 * no masthead, no site footer, no back button, no prev/next cards. It is
 * there so a post can be embedded (an iframe, a preview pane, a print
 * view) without the app around it.
 *
 * Scoped to post routes, because a feed with no way to move is not a page
 * anyone wants; and it does not stick — `buildUrl` only writes the keys a
 * navigate() is given, so following a link out of a headless post lands in
 * the ordinary UI. The two canonicalising replaces that stay on the same
 * post (Reader, PostLocator) pass it along by hand.
 */
export const isHeadless = (params) => params.headless === '1' && Boolean(params.tx);

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
