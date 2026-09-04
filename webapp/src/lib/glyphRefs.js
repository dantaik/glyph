// glyphRefs.js — cross-article references (§8.1 of the spec).
//
// In-article reference form — the publish tx hash itself is the target:
//   [text](0x<txhash>/<eventIndex>)
// - <txhash> is the publish() transaction of the target post (64 hex);
// - <eventIndex> is the 0-based ordinal of the Post event inside that
//   transaction (one tx can publish several posts) — optional, default 0;
// - an empty text []() resolves the target's title at read time and uses
//   it as the link text, falling back to the short tx hash.
//
// Refs are rewritten to the app's own canonical link for that post, built
// by the router — so it carries the chain segment, and the fragment form
// when the app is running from a downloaded file. The markdown sanitizer
// allows both, and the reader routes them in-app, so a stale ref lands on
// the normal "no such post" page.
//
// A ref names a transaction on the chain the article was read from, so both
// the title lookup and the link are bound to that chain (reader.js builds
// one resolver per chain with createRefResolver).

import { chainFromSlug, chainSlug } from './chains';
import { shortAddr } from './format';
import { hrefFor } from './router';

/**
 * A POST REFERENCE, as front-matter carries it (spec §5.1):
 *
 *     [<chainSlug>:]0x<64 hex>[/<eventIndex>]
 *
 * The transaction that published the post, an optional 0-based ordinal for
 * the Post event within it (default 0), and an optional chain prefix. With
 * no prefix the reference means the chain the referring post is on, which is
 * the common case and keeps the bytes short.
 */
const POST_REF_RE = /^(?:([a-z0-9-]+):)?(0x[0-9a-fA-F]{64})(?:\/(\d+))?$/;

/** The same post as a URL of this app, which is what a reader will paste. */
const POST_URL_RE = /\/(?:([a-z0-9-]+)\/)?tx\/(0x[0-9a-fA-F]{64})(?:\/(\d+))?\/?(?:[?#]|$)/;

/**
 * Read a post reference. Accepts the reference form above and a full or
 * partial URL of this app, so pasting a link from the address bar works.
 * @returns {{ chainId: number, txHash: string, eventIndex: number } | null}
 */
export function parsePostRef(value, defaultChainId = null) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = text.match(POST_REF_RE) ?? text.match(POST_URL_RE);
  if (!m) return null;
  const [, slug, txHash, index] = m;
  const chainId = slug ? chainFromSlug(slug) : (defaultChainId ?? null);
  if (chainId == null) return null; // a prefix we don't know, or no chain to assume
  return { chainId: Number(chainId), txHash: txHash.toLowerCase(), eventIndex: index != null ? Number(index) : 0 };
}

/**
 * Write a reference in its shortest honest form: no chain prefix when it is
 * the same chain as the post carrying it, and no `/0` for the usual case of
 * one post per transaction.
 */
export function formatPostRef({ chainId, txHash, eventIndex = 0 }, currentChainId = null) {
  const prefix = currentChainId != null && Number(chainId) === Number(currentChainId) ? '' : `${chainSlug(chainId)}:`;
  const suffix = eventIndex ? `/${eventIndex}` : '';
  return `${prefix}${String(txHash).toLowerCase()}${suffix}`;
}

// Only a full 64-hex tx hash (with optional event ordinal) counts as a
// reference — ordinary 0x…-ish links never match.
const REF_RE = /\[([^\]]*)\]\((0x[0-9a-fA-F]{64})(?:\/(\d+))?\)/g;

/**
 * Build the resolver for one chain. `findMetaByTx(hash, eventIndex)` is
 * that chain's post lookup (see reader.js), and `chainId` is the chain the
 * links resolve on.
 * @returns {(markdown: string) => Promise<string>} rewrite `0x…` article
 *   refs to canonical in-app markdown links
 */
export function createRefResolver(findMetaByTx, chainId) {
  // target -> Promise<title | null>. Posts are immutable on-chain, so a
  // failed or absent target stays null for the session — no point retrying.
  const titleCache = new Map();

  function titleFor(hash, eventIndex) {
    const key = `${hash.toLowerCase()}:${eventIndex}`;
    if (!titleCache.has(key)) {
      titleCache.set(
        key,
        findMetaByTx(hash, eventIndex)
          .then((meta) => meta?.title ?? null)
          .catch(() => null),
      );
    }
    return titleCache.get(key);
  }

  return async function resolveGlyphRefs(markdown) {
    if (!markdown) return markdown;
    const refs = [...markdown.matchAll(REF_RE)];
    if (refs.length === 0) return markdown;

    const replaced = await Promise.all(
      refs.map(async (m) => {
        const hash = m[2].toLowerCase();
        const eventIndex = m[3] != null ? Number(m[3]) : 0;
        const text = m[1].trim() || (await titleFor(hash, eventIndex)) || shortAddr(hash);
        const href = hrefFor({ chain: chainId, tx: hash, txEvent: eventIndex });
        return { from: m[0], to: `[${text}](${href})` };
      }),
    );

    let out = markdown;
    for (const r of replaced) out = out.split(r.from).join(r.to);
    return out;
  };
}
