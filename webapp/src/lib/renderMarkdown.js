// renderMarkdown.js — Convert Markdown subset to sanitized HTML.
// Strips raw HTML and disallows dangerous URL schemes (javascript:, data:, vbscript:, ...).
// Covers the subset defined in §7 of the spec:
// headings, bold, italic, links, images, lists, blockquotes, code (inline + fenced), paragraphs.

import { marked } from 'marked';

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

/**
 * Render a Markdown string to safe HTML.
 * @param {string} markdown — Markdown with eth: image refs already resolved to blob: URLs
 * @returns {string} HTML
 */
export function renderMarkdown(markdown) {
  if (!markdown) return '';
  return marked.parse(markdown);
}
