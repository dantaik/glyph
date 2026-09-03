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

import { shortAddr } from './format';
import { hrefFor } from './router';

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
