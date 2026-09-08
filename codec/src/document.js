// document.js — the DOCUMENT: front-matter plus Markdown, as text.
//
// Decompressed, a payload is a human-readable Markdown document, with the
// post's metadata in an optional YAML-style front-matter block:
//
//   ---
//   tags: family, travel, mountains
//   lang: zh
//   ---
//
//   # A weekend in the hills
//   The body…
//
// This module is that text layer and nothing else — building the document
// and taking it apart — and it imports nothing that is not plain
// JavaScript. Front-matter is the format's extension mechanism: a reader
// ignores keys it does not know, and a key it does not know survives a
// decode/encode round trip untouched.
//
// THE READER IS LENIENT AND THE WRITER IS STRICT. Reading follows the rules
// every existing reader follows, byte for byte, because a document already
// on chain must read the same everywhere for ever. Writing is held to a
// grammar the reader is guaranteed to invert, so that what an author sees
// is exactly what a reader will see — and a post that cannot be written
// that way is refused with the reason, not written approximately.

import { InvalidPostError } from './errors.js';
import { isWellFormed } from './utf8.js';

/**
 * The keys this format defines, in the order a writer emits them. A key not
 * listed here is still read and still written — the list fixes the order of
 * the ones that are defined, so the same post always becomes the same bytes.
 *
 *   tags        free-form labels, comma-separated
 *   lang        the language the post is written in (BCP 47)
 *   re          the post this one replies to (a post reference)
 *   supersedes  the post this one replaces (a post reference)
 *   prev        the post this one continues (a post reference)
 *   series      the name of a series this post belongs to
 *   part        this post's number within that series
 */
export const FRONT_MATTER_KEYS = Object.freeze(['tags', 'lang', 're', 'supersedes', 'prev', 'series', 'part']);

/**
 * Keys a writer MUST NOT emit. `title` is the one: on chain the title is its
 * own bytes32 argument, and a copy in the front-matter would be paid for
 * twice and could disagree with it.
 */
export const RESERVED_KEYS = Object.freeze(['title']);

/** What a writer accepts as a key: a letter, then letters, digits, `_`, `-`. */
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const LINE_BREAK_RE = /[\r\n]/;
const DELIMITER = '---';

const str = (v) => String(v ?? '');

/**
 * Split an optional front-matter block from a document. THE READER.
 *
 * Conservative on purpose: the first line must be exactly `---` (after
 * trimming), a closing `---` line must exist, and every non-blank line
 * between must be `key: value` — otherwise the whole text is the body, so a
 * document that merely opens with a thematic break is not misread. Between
 * the delimiters, a key is what precedes the first `:` and a value what
 * follows it, both trimmed; a later line with the same key wins. One blank
 * line after the closing delimiter is the separator and is dropped.
 *
 * @param {string} text
 * @returns {{ matched: boolean, meta: Record<string, string>, body: string }}
 *   `matched` says whether a block was found; `meta` is every key as written.
 */
export function splitFrontMatter(text) {
  const whole = str(text);
  const lines = whole.split('\n');
  const none = { matched: false, meta: {}, body: whole };
  if (lines[0]?.trim() !== DELIMITER) return none;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === DELIMITER) {
      end = i;
      break;
    }
  }
  if (end === -1) return none;

  const meta = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) return none; // not key: value → not front-matter
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  let body = lines.slice(end + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1);
  return { matched: true, meta, body };
}

/**
 * `"a, b"` (or `"[a, b]"`) → `['a', 'b']`: split on commas, trimmed, empties
 * dropped. THE READER'S rule for the `tags` line: one leading `[` and one
 * trailing `]` are stripped first, because that is how a YAML list is often
 * written by hand. A writer never produces the brackets, and refuses a tag
 * that would lose one to this rule (see frontMatterEntries).
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTags(raw) {
  if (!raw) return [];
  return str(raw)
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Take a document apart.
 * @param {string} text
 * @returns {{ meta: Record<string, string>, tags: string[], markdown: string }}
 *   `tags` is the `tags` key parsed into a list; `meta` is every OTHER key
 *   as written, unknown and reserved ones included.
 */
export function parseDocument(text) {
  const { meta, body } = splitFrontMatter(text);
  const { tags: rawTags, ...rest } = meta;
  return { meta: rest, tags: parseTags(rawTags), markdown: body };
}

/**
 * One value as the line will hold it: a list joins with `, `; anything else
 * is its string, trimmed. `null` for a value that cannot be a value at all.
 */
function serializeValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? '' : str(v).trim()))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return str(value).trim();
  return null;
}

/**
 * The front-matter entries a writer will emit for `meta`, in order, with
 * every problem found on the way. Pure; `buildDocument` refuses on errors.
 * @param {Record<string, unknown>} meta
 * @returns {{ entries: [string, string][], problems: import('./post.js').Problem[] }}
 */
export function frontMatterEntries(meta) {
  const problems = [];
  const entries = [];
  const push = (key, value) => {
    const path = key === 'tags' ? 'tags' : `meta.${key}`;
    if (RESERVED_KEYS.includes(key)) {
      problems.push({
        level: 'error',
        path: `meta.${key}`,
        code: 'KEY_RESERVED',
        message: `is not a front-matter key — the title is the bytes32 argument of publish()`,
      });
      return;
    }
    if (!KEY_RE.test(key)) {
      problems.push({ level: 'error', path, code: 'KEY_SYNTAX', message: 'a key is a letter followed by letters, digits, _ or -' });
      return;
    }
    const line = serializeValue(value);
    if (line === null) {
      problems.push({ level: 'error', path, code: 'TYPE', message: 'must be a string, a number or a list of strings' });
      return;
    }
    if (!line) return; // an empty value is not written at all
    if (!isWellFormed(line)) {
      problems.push({ level: 'error', path, code: 'MALFORMED_UNICODE', message: 'contains a lone surrogate' });
      return;
    }
    if (LINE_BREAK_RE.test(line)) {
      problems.push({ level: 'error', path, code: 'VALUE_LINE_BREAK', message: 'a value fits on one line' });
      return;
    }
    if (key === 'tags') {
      const tags = (Array.isArray(value) ? value.map((v) => str(v)) : line.split(',')).map((v) => v.trim()).filter(Boolean);
      for (const tag of tags) {
        if (tag.includes(',')) {
          problems.push({ level: 'error', path: 'tags', code: 'TAG_COMMA', message: `"${tag}" contains a comma, which separates tags` });
        }
      }
      // The reader strips one leading `[` and one trailing `]` from the
      // line, to tolerate the bracketed list form; a tag that begins or ends
      // with one would lose it.
      if (tags.length && (tags[0].startsWith('[') || tags[tags.length - 1].endsWith(']'))) {
        problems.push({ level: 'error', path: 'tags', code: 'TAG_BRACKET', message: 'the first tag must not start with [ and the last must not end with ]' });
      }
      if (problems.some((p) => p.path === 'tags')) return;
      if (tags.length === 0) return;
      entries.push([key, tags.join(', ')]);
      return;
    }
    entries.push([key, line]);
  };

  const seen = new Set();
  for (const key of FRONT_MATTER_KEYS) {
    seen.add(key);
    if (key in meta) push(key, meta[key]);
  }
  for (const key of Object.keys(meta).filter((k) => !seen.has(k)).sort()) push(key, meta[key]);
  return { entries, problems };
}

/**
 * Build the document a payload holds. THE WRITER.
 *
 * Known keys are written in FRONT_MATTER_KEYS order and the rest after them
 * in ASCII order, empty values are left out, and when nothing is left the
 * result is the bare Markdown with no front-matter block at all — a post
 * with no metadata is pure Markdown, openable in any editor decades from
 * now. The one exception: a body that would itself be read as beginning
 * with a front-matter block gets an explicit empty block in front of it, so
 * the reader's split lands where the writer meant.
 *
 * `tags` may be given on its own or as `meta.tags`; the argument wins. A
 * list is a list; a string is split on commas, the way the line will be read.
 *
 * @param {{ markdown?: string, tags?: string[] | string, meta?: Record<string, unknown> }} post
 * @returns {string}
 * @throws {InvalidPostError} for a document the reader could not invert
 */
export function buildDocument({ markdown, tags, meta } = {}) {
  const problems = [];
  if (markdown == null) markdown = '';
  if (typeof markdown !== 'string') {
    problems.push({ level: 'error', path: 'markdown', code: 'TYPE', message: 'must be a string' });
  } else if (!isWellFormed(markdown)) {
    problems.push({ level: 'error', path: 'markdown', code: 'MALFORMED_UNICODE', message: 'contains a lone surrogate' });
  }
  const merged = { ...(meta ?? {}) };
  if (tags != null) merged.tags = tags;
  const { entries, problems: metaProblems } = frontMatterEntries(merged);
  problems.push(...metaProblems);
  if (problems.length) throw new InvalidPostError(problems);

  const body = markdown;
  if (entries.length === 0) {
    return splitFrontMatter(body).matched ? `${DELIMITER}\n${DELIMITER}\n\n${body}` : body;
  }
  const block = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  return `${DELIMITER}\n${block}\n${DELIMITER}\n\n${body}`;
}
