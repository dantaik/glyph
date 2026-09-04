// images.js — the two forms an image reference takes, and moving between them.
//
// An image in Xueni is a transaction of its own: the WebP bytes go on chain
// as a plain self-transfer's calldata, and the body points at that
// transaction. So a body under composition says `![alt](upload:img1)` — a
// file not yet paid for — and a body on chain says `![alt](eth:0x<txhash>)`,
// which every reader can resolve from the chain alone, for ever, with no
// image host to outlive it.
//
// `publish` turns the first form into the second; `fetch --images` and
// `export` turn the second into a file on disk. The regular expressions are
// the app's (webapp/src/lib/publish.js and reader.js), so a body written in
// one place is understood in the other.

/** `![alt](eth:0x<64 hex>)` — an image the chain holds. */
const ETH_REF_RE = /!\[([^\]]*)\]\(eth:(0x[0-9a-fA-F]{64})[^)]*\)/g;

/**
 * `![alt](upload:KEY)` — a file waiting to be sent. Only image references
 * match: a plain `[text](upload:img1)` link is not an image, and the
 * lookahead keeps `img1` from matching inside `upload:img10`.
 */
export function uploadRefRe(key, flags) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(!\\[[^\\]]*\\]\\()upload:${escaped}(?=[\\s)])`, flags);
}

/** The images a body references on chain, deduplicated, in the order they appear. */
export function imageRefs(markdown) {
  const seen = new Set();
  const out = [];
  for (const m of String(markdown ?? '').matchAll(ETH_REF_RE)) {
    const txHash = m[2].toLowerCase();
    if (seen.has(txHash)) continue;
    seen.add(txHash);
    out.push(txHash);
  }
  return out;
}

/**
 * Point every `eth:0x…` reference at whatever `hrefFor(txHash)` gives back —
 * a path on disk, once the bytes have been saved there. A reference
 * `hrefFor` has no answer for (an image the node would not serve) is left
 * exactly as it was, so the document still says what it pointed at.
 */
export function rewriteImageRefs(markdown, hrefFor) {
  return String(markdown ?? '').replace(ETH_REF_RE, (whole, alt, hash) => {
    const href = hrefFor(hash.toLowerCase());
    return href ? `![${alt}](${href})` : whole;
  });
}

/** The keys of `files` the body actually shows — see `publish`, which pays per image. */
export function usedImageKeys(markdown, keys) {
  const md = markdown || '';
  return keys.filter((key) => uploadRefRe(key).test(md));
}
