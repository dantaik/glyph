// archive.js — the bundle `xueni export` writes.
//
// One JSON document holding everything needed to read an author's work with
// no node at all: the exact stored text of every post, the images those posts
// reference, and a note of which author lists were walked to their end. It is
// the practical answer to history expiry (EIP-4444) — a reader years from now
// loads a bundle instead of needing an archive node — and it is the same
// format the web app exports and imports, so a backup taken at a terminal
// seeds a browser and the other way round.
//
// The shape is fixed by the plan (§11.1) and by the app's importer. Field
// names and nesting are load-bearing: every number is a plain JSON number
// (block heights and timestamps sit far below 2^53), images are base64
// because the format must stay ONE PLAIN JSON FILE that any future tool can
// read, and `authors[].complete` is what lets an importing browser claim it
// has the whole of that author rather than a sample.

/** The format version, as `glyph.archive`. Bumping it is breaking the file. */
export const ARCHIVE_FORMAT = 1;

/** Every image on chain is WebP — the writers only ever produce that. */
export const IMAGE_MIME = 'image/webp';

/**
 * Base64 for a Uint8Array. `Buffer` would be shorter, but this is the same
 * chunked walk the browser side does with `btoa`, and keeping the two the
 * same means a bundle written here and one written there are byte-identical
 * for the same image.
 */
export function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

/** A post as the bundle carries it: the row, plus the document itself. */
export const archivePost = ({ chainId, row, body }) => ({
  chainId: Number(chainId),
  txHash: row.txHash,
  eventIndex: Number(row.eventIndex),
  author: row.author,
  index: Number(row.index),
  block: Number(row.block),
  prevBlock: Number(row.prevBlock),
  logIndex: Number(row.logIndex),
  ts: row.ts == null ? null : Number(row.ts),
  title: row.title,
  text: body.text,
  compressedBytes: Number(body.compressedBytes),
});

/** An image as the bundle carries it. */
export const archiveImage = ({ chainId, txHash, bytes }) => ({
  chainId: Number(chainId),
  txHash: String(txHash).toLowerCase(),
  mime: IMAGE_MIME,
  base64: bytesToBase64(bytes),
});

/**
 * The document itself.
 *
 * `contract` is checked on import: a bundle from a different deployment of
 * the contract describes a different journal, and merging the two silently
 * would be worse than refusing.
 *
 * @param {{ contract: string, scope: object, posts: object[], images: object[], authors: object[] }} parts
 */
export function buildArchive({ contract, scope, posts, images, authors, now = new Date() }) {
  return {
    glyph: { archive: ARCHIVE_FORMAT },
    exportedAt: now.toISOString(),
    contract,
    scope,
    posts,
    images,
    authors,
  };
}
