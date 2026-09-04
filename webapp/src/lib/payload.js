// payload.js — the brotli boundary around the payload document.
//
// The document itself — front-matter plus Markdown — is payloadText.js,
// which is plain JavaScript so Node can share it. This module is only the
// compression: final on-chain bytes = brotli(quality=11)(utf8(text)).

import { getBrotli } from './brotli';
import { buildPayloadText, parsePayloadText } from './payloadText';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Build the human-readable document and brotli-compress it.
 *
 * `tags` is folded into `meta` (it is one front-matter key among several),
 * so a caller may pass either, and `meta.tags` wins only when `tags` is not
 * given — the dedicated argument is the one the editor uses.
 *
 * @param {{ tags?: string[], markdown: string, meta?: Record<string, string|string[]> }} payload
 * @returns {Promise<Uint8Array>} brotli-compressed bytes
 */
export async function encodePayload({ tags, markdown, meta = {} } = {}) {
  const merged = { ...meta };
  if (tags != null) merged.tags = tags;
  const text = buildPayloadText({ markdown, meta: merged });
  const brotli = await getBrotli();
  return brotli.compress(enc.encode(text), { quality: 11 });
}

/**
 * Decompress + parse a publish payload.
 * @param {Uint8Array} compressed brotli-compressed bytes
 * @returns {Promise<{ meta: Record<string,string>, tags: string[], markdown: string, text: string }>}
 *   `text` is the exact document the chain holds, front-matter included —
 *   what the raw view shows and what an archive or a `.md` download carries.
 */
export async function decodePayload(compressed) {
  const brotli = await getBrotli();
  const text = dec.decode(brotli.decompress(compressed));
  return { ...parsePayloadText(text), text };
}
