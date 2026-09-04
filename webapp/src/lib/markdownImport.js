// markdownImport.js — a `.md` file becoming a draft.
//
// The other half of the round trip: a post can be downloaded as the exact
// text the chain holds, edited in any editor, and brought back here. It is
// also the way to write somewhere else entirely and publish from a file.
//
// Pure: it takes text and gives back fields. The file reading, and the
// question of whether to overwrite the current draft, belong to the UI.

import { parsePayloadText, FRONT_MATTER_KEYS } from './payloadText';
import { TITLE_MAX_BYTES, titleByteLength } from './title';

/**
 * `title` is accepted from a file's front-matter as a convenience — it is how
 * every static-site generator writes one — but it is NOT a Glyph front-matter
 * key: on chain the title is its own `bytes32` argument, so importing it here
 * fills the title field and nothing is written under that name.
 */
const TITLE_KEY = 'title';

/** Cut `title` to what a bytes32 can hold, without splitting a character. */
export function fitTitle(title) {
  let out = String(title ?? '').trim();
  while (titleByteLength(out) > TITLE_MAX_BYTES) out = out.slice(0, -1);
  return out;
}

/**
 * A title for this document: the front-matter's, else the first heading,
 * else the file name. Always trimmed to fit the on-chain field.
 */
export function titleFromMarkdown(text, { meta = {}, fileName = '' } = {}) {
  if (meta[TITLE_KEY]) return fitTitle(meta[TITLE_KEY]);
  const heading = String(text ?? '').match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (heading) return fitTitle(heading[1]);
  return fitTitle(String(fileName).replace(/\.(md|markdown|txt)$/i, ''));
}

/**
 * Read a Markdown document into the fields the write tab holds.
 *
 * Keys this version knows are kept; anything else is reported in `dropped`
 * rather than smuggled on chain, so the writer is told what will not survive.
 * (A post already on chain keeps its unknown keys — decoding preserves them —
 * but writing one back out is a new post, and this app only writes what it
 * understands.)
 *
 * @returns {{ title: string, tags: string[], meta: object, markdown: string, dropped: string[] }}
 */
export function importMarkdown(text, { fileName = '' } = {}) {
  const { meta, tags, markdown } = parsePayloadText(text ?? '');
  const kept = {};
  const dropped = [];
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'tags' || key === TITLE_KEY) continue; // handled on their own
    if (FRONT_MATTER_KEYS.includes(key)) kept[key] = value;
    else dropped.push(key);
  }
  return {
    title: titleFromMarkdown(markdown, { meta, fileName }),
    tags,
    meta: kept,
    markdown,
    // Sorted, so the message a writer sees does not depend on the order the
    // keys happened to be written in.
    dropped: dropped.sort(),
  };
}
