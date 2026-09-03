// glyphRefs.js — cross-article references (the `glyph:` scheme, §8.1 of the spec).
//
// In-article reference form:
//   [文字](glyph:0x<txhash>/<eventIndex>)
// - <txhash> is the publish() transaction of the target post (64 hex);
// - <eventIndex> is the 0-based ordinal of the Post event inside that
//   transaction (one tx can publish several posts) — optional, default 0;
// - an empty text []() resolves the target's title at read time and uses
//   it as the link text, falling back to the short tx hash.
//
// Refs are rewritten to the app's own canonical path /tx/<hash>/<n>,
// which the markdown sanitizer already allows and the reader routes
// in-app, so a stale ref lands on the normal 没有找到这篇文章 page.

import { findMetaByTx } from './data';
import { shortAddr } from './format';

const REF_RE = /\[([^\]]*)\]\(glyph:(0x[0-9a-fA-F]{64})(?:\/(\d+))?\)/g;

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

/**
 * Rewrite `glyph:` refs to canonical /tx/<hash>/<n> markdown links.
 * @returns {Promise<string>} rewritten markdown
 */
export async function resolveGlyphRefs(markdown) {
  if (!markdown) return markdown;
  const refs = [...markdown.matchAll(REF_RE)];
  if (refs.length === 0) return markdown;

  const replaced = await Promise.all(
    refs.map(async (m) => {
      const hash = m[2].toLowerCase();
      const eventIndex = m[3] != null ? Number(m[3]) : 0;
      const text = m[1].trim() || (await titleFor(hash, eventIndex)) || shortAddr(hash);
      return { from: m[0], to: `[${text}](/tx/${hash}/${eventIndex})` };
    }),
  );

  let out = markdown;
  for (const r of replaced) out = out.split(r.from).join(r.to);
  return out;
}
