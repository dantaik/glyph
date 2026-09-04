// search.js — finding a word in what this browser has read.
//
// Substring matching, not tokens. A tokeniser would have to know where words
// begin, and Chinese does not put spaces between them: the posts this app was
// written for would be the ones it could not search. A plain case-folded
// substring finds 香樟木箱 and "camphorwood chest" alike, costs nothing to
// maintain, and is honest about being simple.
//
// Pure and synchronous. What to search over — and the fact that it is only
// what has been read — is the caller's business.

/** Case-folded for comparison, in whatever script the query is written in. */
export const normalizeQuery = (q) => String(q ?? '').trim().toLocaleLowerCase();

/** Characters of context to show on either side of a match. */
const SNIPPET_WIDTH = 160;

/**
 * A run of text around `index`, cut at a space where there is one nearby so a
 * snippet does not start mid-word. Ellipses mark where it was cut.
 * @returns {{ text: string, from: number }} the snippet and where it starts
 */
export function snippetAround(text, index, width = SNIPPET_WIDTH) {
  const source = String(text ?? '');
  if (source.length <= width) return { text: source, from: 0 };
  const half = Math.floor(width / 2);
  let from = Math.max(0, index - half);
  let to = Math.min(source.length, from + width);
  from = Math.max(0, to - width);

  // Prefer a space near the cut — but only near it: a Chinese paragraph has
  // no spaces at all, and hunting for one would swallow the whole snippet.
  if (from > 0) {
    const space = source.indexOf(' ', from);
    if (space !== -1 && space - from < 24) from = space + 1;
  }
  if (to < source.length) {
    const space = source.lastIndexOf(' ', to);
    if (space !== -1 && to - space < 24 && space > from) to = space;
  }
  const head = from > 0 ? '…' : '';
  const tail = to < source.length ? '…' : '';
  return { text: `${head}${source.slice(from, to).trim()}${tail}`, from };
}

/**
 * Does this post match `query`, and where?
 *
 * The title and the tags are searched as well as the body, because that is
 * what a reader means by "find": a post called "Winter by the sea" should be
 * found by "winter" even if the word never appears in the prose.
 *
 * @param {{ title?: string, tags?: string[], markdown?: string }} post
 * @param {string} query already normalized (see normalizeQuery)
 * @returns {{ where: 'title'|'tags'|'body', snippet: string, match: string } | null}
 */
export function matchPost(post, query) {
  if (!query) return null;
  const title = String(post?.title ?? '');
  if (title.toLocaleLowerCase().includes(query)) {
    return { where: 'title', snippet: title, match: query };
  }
  const tag = (post?.tags ?? []).find((tg) => String(tg).toLocaleLowerCase().includes(query));
  if (tag) return { where: 'tags', snippet: tag, match: query };

  const body = String(post?.markdown ?? '');
  const at = body.toLocaleLowerCase().indexOf(query);
  if (at === -1) return null;
  return { where: 'body', snippet: snippetAround(body, at).text, match: query };
}

/**
 * Split `text` around every occurrence of `query`, so a component can mark
 * the matches without building HTML: `[{ text, hit }]`.
 */
export function highlightParts(text, query) {
  const source = String(text ?? '');
  if (!query) return [{ text: source, hit: false }];
  const folded = source.toLocaleLowerCase();
  const parts = [];
  let at = 0;
  for (;;) {
    const found = folded.indexOf(query, at);
    if (found === -1) break;
    if (found > at) parts.push({ text: source.slice(at, found), hit: false });
    parts.push({ text: source.slice(found, found + query.length), hit: true });
    at = found + query.length;
  }
  if (at < source.length) parts.push({ text: source.slice(at), hit: false });
  return parts.length ? parts : [{ text: source, hit: false }];
}
