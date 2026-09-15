// renderMarkdown.js — Convert Markdown subset to sanitized HTML.
// Covers the subset defined in §8 of the spec:
// headings, bold, italic, links, images, lists, blockquotes, code (inline + fenced),
// tables (GFM), paragraphs.
//
// The whole body is attacker-controlled: it is brotli-compressed calldata that
// anyone can publish(), decompressed and injected with dangerouslySetInnerHTML.
// So there are TWO layers of defence, and the second is the one that has to hold:
//
//   1. marked's renderer drops raw HTML and blanks disallowed URL schemes. This
//      is a convenience, not a guarantee — marked does not escape every sink
//      (e.g. it leaves a `"` in image `alt` text unescaped, which breaks out of
//      the attribute into an `onerror=` handler).
//   2. DOMPurify sanitizes the rendered HTML against a strict allowlist of the
//      tags/attributes this subset can legitimately produce. This is the
//      authoritative pass: anything the first layer misses is stripped here.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Links may navigate the browser → allow only safe navigation schemes.
const ALLOWED_LINK_SCHEME = /^(https?:|mailto:|#|\/)/i;
// Images may load arbitrary bytes → allow only http(s), blob: (resolved on-chain images),
// and data:image/ (small inline placeholders). No javascript:, no data:text/html, etc.
const ALLOWED_IMG_SCHEME = /^(https?:|blob:|data:image\/)/i;

function sanitizeHref(href, allow) {
  if (typeof href !== 'string') return '';
  const trimmed = href.trim();
  return allow.test(trimmed) ? trimmed : '';
}

marked.use({
  renderer: {
    // Drop any raw HTML the author might have written.
    html() { return '<!-- raw html stripped -->'; },
  },
  // walkTokens runs before rendering — rewrite href/src to a safe value so the
  // standard renderer can serialize it normally (with marked's own escaping).
  walkTokens(token) {
    if (token.type === 'link') {
      token.href = sanitizeHref(token.href, ALLOWED_LINK_SCHEME);
    } else if (token.type === 'image') {
      token.href = sanitizeHref(token.href, ALLOWED_IMG_SCHEME);
    }
  },
  breaks: true,
  gfm: true,
});

// The authoritative allowlist: only the tags and attributes the Markdown subset
// (spec §8) can produce, and only the URL schemes the reader legitimately needs.
// blob: and data:image/ are re-permitted for images (DOMPurify's defaults would
// otherwise drop the on-chain and placeholder image sources); # and / keep the
// in-app post links postRefs rewrites. Anything outside this set — a <script>,
// an on* handler, a javascript: URL — is removed.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'em', 'strong', 'del', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'img', 'hr', 'br',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'align'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|blob:|data:image\/)/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

/**
 * Render a Markdown string to safe HTML.
 * @param {string} markdown — Markdown with eth: image refs already resolved to blob: URLs
 * @returns {string} HTML that is safe to inject with dangerouslySetInnerHTML
 */
export function renderMarkdown(markdown) {
  if (!markdown) return '';
  return DOMPurify.sanitize(marked.parse(markdown), PURIFY_CONFIG);
}
