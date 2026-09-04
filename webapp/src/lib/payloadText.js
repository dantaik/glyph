// payloadText.js — the payload as TEXT: front-matter and Markdown, no brotli.
//
// The decompressed payload is a human-readable Markdown document with an
// optional YAML-ish front-matter block:
//
//   ---
//   tags: family, travel, mountains
//   lang: zh
//   ---
//
//   # A weekend in the hills
//   The body…
//
// This module is the text layer alone — building that document and taking it
// apart — deliberately free of every import that is not plain JavaScript, so
// that Node can load it directly: the e2e mock node builds bodies with it,
// and the command-line tool shares it with the app. `payload.js` sits on top
// and adds the brotli boundary.
//
// Front-matter is the extensibility mechanism: unknown keys survive a round
// trip untouched, and a reader that does not know a key ignores it. No
// version byte, ever.

/**
 * The keys this app writes, in the order it writes them. A key not listed
 * here is still parsed and still preserved — the list only fixes the order
 * of the ones we emit, so the same draft always compresses to the same bytes.
 *
 * `tags`      free-form labels, comma-separated
 * `lang`      the language the post is written in (BCP 47)
 * `re`        the post this one replies to
 * `supersedes` the post this one replaces
 * `prev`      the post this one continues from
 * `series`    the name of a series this post belongs to
 * `part`      this post's number within that series
 */
export const FRONT_MATTER_KEYS = ['tags', 'lang', 're', 'supersedes', 'prev', 'series', 'part'];

/**
 * Split optional front-matter from a Markdown document.
 * Conservative: the first line must be exactly `---`, a closing `---` must
 * exist, and every line between must be `key: value` — otherwise the text
 * is treated as plain Markdown (so a doc that legitimately starts with a
 * `---` horizontal rule isn't misparsed).
 */
export function splitFrontMatter(text) {
  const lines = String(text ?? '').split('\n');
  if (lines[0]?.trim() !== '---') return { meta: {}, body: String(text ?? '') };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { meta: {}, body: String(text ?? '') };

  const meta = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) return { meta: {}, body: String(text ?? '') }; // not key:value → not front-matter
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  let body = lines.slice(end + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1); // drop one separator blank line
  return { meta, body };
}

/** `"a, b"` (or `"[a, b]"`) → `['a', 'b']`; empty for anything blank. */
export function parseTags(raw) {
  if (!raw) return [];
  return String(raw)
    .replace(/^\[|\]$/g, '') // tolerate `[a, b]` array style
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One front-matter value as the line holds it: an array joins with `, `. */
function serializeValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(', ');
  }
  return String(value).trim();
}

/**
 * Build the document a payload holds.
 *
 * `meta` values may be strings or arrays of strings; empty ones are left
 * out, and when nothing is left the result is the bare Markdown with NO
 * front-matter block at all — which is the point: a post with no metadata
 * is pure Markdown, openable in any editor decades from now.
 *
 * Known keys are written in FRONT_MATTER_KEYS order and anything else after
 * them, alphabetically, so the same draft always produces the same bytes.
 *
 * @param {{ markdown?: string, meta?: Record<string, string|string[]> }} doc
 * @returns {string}
 */
export function buildPayloadText({ markdown = '', meta = {} } = {}) {
  const entries = [];
  const seen = new Set();
  for (const key of FRONT_MATTER_KEYS) {
    seen.add(key);
    const value = serializeValue(meta?.[key]);
    if (value) entries.push([key, value]);
  }
  const extra = Object.keys(meta ?? {})
    .filter((k) => !seen.has(k))
    .sort();
  for (const key of extra) {
    const value = serializeValue(meta[key]);
    if (value) entries.push([key, value]);
  }
  const body = markdown || '';
  if (entries.length === 0) return body;
  const block = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${block}\n---\n\n${body}`;
}

/**
 * Take a payload document apart.
 * @param {string} text
 * @returns {{ meta: Record<string,string>, tags: string[], markdown: string }}
 *   `meta` is every front-matter key as written (unknown ones included);
 *   `tags` is `meta.tags` parsed into a list.
 */
export function parsePayloadText(text) {
  const { meta, body } = splitFrontMatter(text);
  return { meta, tags: parseTags(meta.tags), markdown: body };
}
