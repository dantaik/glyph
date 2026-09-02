// payload.js — YAML-style front-matter schema for the publish payload.
//
// The decompressed payload is a human-readable Markdown document with an
// optional YAML-ish front-matter block carrying tags:
//
//   ---
//   tags: 家庭, 旅行, 山
//   ---
//
//   # 周末爬山
//   正文...
//
// When there are no tags, the payload is *pure Markdown* — no wrapper at
// all — so it stays maximally portable ("any editor, decades later").
// Final on-chain bytes = brotli(quality=11)(utf8(text)).
//
// Front-matter is the extensibility mechanism: future keys can be added and
// older readers simply ignore the ones they don't recognise. No version byte.

import { getBrotli } from './brotli';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Split optional front-matter from a Markdown document.
 * Conservative: the first line must be exactly `---`, a closing `---` must
 * exist, and every line between must be `key: value` — otherwise the text
 * is treated as plain Markdown (so a doc that legitimately starts with a
 * `---` horizontal rule isn't misparsed).
 */
function splitFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { meta: {}, body: text };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { meta: {}, body: text };

  const meta = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) return { meta: {}, body: text }; // not key:value → not front-matter
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  let body = lines.slice(end + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1); // drop one separator blank line
  return { meta, body };
}

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, '') // tolerate `[a, b]` array style
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build the human-readable document and brotli-compress it.
 * @param {{ tags?: string[], markdown: string }} payload
 * @returns {Promise<Uint8Array>} brotli-compressed bytes
 */
export async function encodePayload({ tags = [], markdown }) {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  const text = clean.length
    ? `---\ntags: ${clean.join(', ')}\n---\n\n${markdown || ''}`
    : markdown || '';
  const brotli = await getBrotli();
  return brotli.compress(enc.encode(text), { quality: 11 });
}

/**
 * Decompress + parse a publish payload.
 * @param {Uint8Array} compressed brotli-compressed bytes
 * @returns {Promise<{ tags: string[], markdown: string }>}
 */
export async function decodePayload(compressed) {
  const brotli = await getBrotli();
  const text = dec.decode(brotli.decompress(compressed));
  const { meta, body } = splitFrontMatter(text);
  return { tags: parseTags(meta.tags), markdown: body };
}


