// post.js — the POST, as a person sees it, and what makes one writable.
//
// The presentation of a post is four things: a title, a list of tags, a
// Markdown body, and the rest of its front-matter as a map of strings — the
// language, the relations, whatever a later version adds. Everything in this
// package converts between that shape and the bytes of a `publish()` call.
//
// `validatePost` says what is wrong with one, at two levels. An ERROR is
// something the writer cannot honour without changing the post — a title
// over 32 bytes, a value with a line break in it — and `encodePost` refuses
// on those. A WARNING is a value that will be written as given but that no
// reader will make sense of — a `part` that is not a number, a `re` that is
// not a reference — and the writer leaves that decision to the author.

import { FRONT_MATTER_KEYS, RESERVED_KEYS, bodyProblems, frontMatterEntries, parseTags } from './document.js';
import { InvalidPostError } from './errors.js';
import { LANG_RE, PART_RE, POST_REF_KEYS, SERIES_MAX_CHARS, parsePostRef } from './refs.js';
import { titleProblems } from './title.js';

/**
 * @typedef {object} Post
 * @property {string} title       at most 32 bytes of UTF-8
 * @property {string[]} tags      free-form labels, no commas
 * @property {string} markdown    the body, byte for byte
 * @property {Record<string, string>} meta  the other front-matter keys
 */

/**
 * @typedef {object} Problem
 * @property {'error' | 'warning'} level
 * @property {string} path   `title`, `tags`, `markdown`, or `meta.<key>`
 * @property {string} code   stable, for programs
 * @property {string} message  for people
 */

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Every problem `post` has, errors and warnings alike, in field order. Pure
 * and total: it never throws, whatever it is given.
 * @param {unknown} post
 * @returns {Problem[]}
 */
export function postProblems(post) {
  if (!isPlainObject(post)) {
    return [{ level: 'error', path: '', code: 'TYPE', message: 'a post is an object with title, tags, markdown and meta' }];
  }
  const problems = [...titleProblems(post.title ?? '')];

  // A field of the wrong type stops the checks that would read it; every
  // other problem is still collected, so a form can mark all of them at once.
  const shape = [];
  if (post.tags != null && !Array.isArray(post.tags) && typeof post.tags !== 'string') {
    shape.push({ level: 'error', path: 'tags', code: 'TYPE', message: 'must be a list of strings' });
  }
  if (post.markdown != null && typeof post.markdown !== 'string') {
    shape.push({ level: 'error', path: 'markdown', code: 'TYPE', message: 'must be a string' });
  }
  if (post.meta != null && !isPlainObject(post.meta)) {
    shape.push({ level: 'error', path: 'meta', code: 'TYPE', message: 'must be an object of string values' });
  }
  if (shape.length) return [...problems, ...shape];

  const merged = { ...(post.meta ?? {}) };
  if (post.tags != null) merged.tags = post.tags;
  const { entries, problems: metaProblems } = frontMatterEntries(merged);
  problems.push(...metaProblems);
  if (post.markdown != null) problems.push(...bodyProblems(post.markdown));

  // The advisory checks: the value of every DEFINED key has a shape.
  const written = Object.fromEntries(entries);
  if ('lang' in written && !LANG_RE.test(written.lang)) {
    problems.push({ level: 'warning', path: 'meta.lang', code: 'LANG_SHAPE', message: 'is not a language tag (BCP 47), such as zh or en-US' });
  }
  for (const key of POST_REF_KEYS) {
    if (key in written && !parsePostRef(written[key])) {
      problems.push({ level: 'warning', path: `meta.${key}`, code: 'REF_SYNTAX', message: 'is not a post reference ([chain:]0x<64 hex>[/n])' });
    }
  }
  if ('series' in written && [...written.series].length > SERIES_MAX_CHARS) {
    problems.push({ level: 'warning', path: 'meta.series', code: 'SERIES_LENGTH', message: `is longer than ${SERIES_MAX_CHARS} characters` });
  }
  if ('part' in written && !PART_RE.test(written.part)) {
    problems.push({ level: 'warning', path: 'meta.part', code: 'PART_SHAPE', message: 'is not a positive integer' });
  }
  if ('part' in written && !('series' in written)) {
    problems.push({ level: 'warning', path: 'meta.part', code: 'PART_WITHOUT_SERIES', message: 'names a part of no series' });
  }
  return problems;
}

/**
 * Is `post` writable, and what is wrong with it?
 * @param {unknown} post
 * @returns {{ ok: boolean, problems: Problem[] }} `ok` when there is no error
 *   (warnings do not count against it)
 */
export function validatePost(post) {
  const problems = postProblems(post);
  return { ok: !problems.some((p) => p.level === 'error'), problems };
}

/**
 * The canonical form of a post: what a reader will get back after a round
 * trip. Tags trimmed with the empties gone, every meta value a trimmed
 * string with the empties gone, `meta.tags` folded into `tags`, numbers
 * written as their decimal string. The title and the body are untouched —
 * both go on chain byte for byte.
 *
 * Idempotent, and the identity on a post that is already canonical.
 * @param {Post | { title?: string, tags?: string[] | string, markdown?: string, meta?: Record<string, unknown> }} post
 * @returns {Post}
 * @throws {InvalidPostError} when `post` has an error-level problem
 */
export function normalisePost(post) {
  const problems = postProblems(post);
  if (problems.some((p) => p.level === 'error')) throw new InvalidPostError(problems);
  const merged = { ...(post.meta ?? {}) };
  if (post.tags != null) merged.tags = post.tags;
  const { entries } = frontMatterEntries(merged);
  const meta = {};
  let tags = [];
  for (const [key, value] of entries) {
    if (key === 'tags') tags = parseTags(value);
    else meta[key] = value;
  }
  return { title: post.title ?? '', tags, markdown: post.markdown ?? '', meta };
}

export { FRONT_MATTER_KEYS, RESERVED_KEYS };
