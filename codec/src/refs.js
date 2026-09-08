// refs.js — the grammar of a front-matter VALUE, key by key.
//
// A document's front-matter is `key: value` lines, and the codec carries any
// value that fits on a line. But the keys this format DEFINES give their
// values a shape — a post reference, a language tag, a positive integer —
// and a writer that checks the shape before paying for the bytes saves an
// author from publishing a relation nobody can follow. These checks are
// advisory (`validatePost` reports them as warnings): a reader never refuses
// a post over one of them, because the post is on chain whatever it says.

/**
 * A POST REFERENCE names another post by the transaction that published it:
 *
 *     [<chain>:]0x<64 hex>[/<eventIndex>]
 *
 * `chain` is a lowercase slug of the chain the transaction is on (`taiko`,
 * `ethereum`); left out, it means the chain of the post that carries the
 * reference. `eventIndex` is the 0-based ordinal of the Post event inside
 * that transaction — one transaction can publish several — and defaults to
 * 0. What a slug resolves to is the application's business, not this
 * package's: the codec keeps the text of the slug and nothing more.
 */
export const POST_REF_RE = /^(?:([a-z0-9-]+):)?(0x[0-9a-fA-F]{64})(?:\/(0|[1-9][0-9]*))?$/;

/**
 * Read a post reference.
 * @param {string} value
 * @returns {{ chain: string | null, txHash: string, eventIndex: number } | null}
 *   `null` when `value` is not a reference; `txHash` is lower-cased so the
 *   same post is always the same reference.
 */
export function parsePostRef(value) {
  const m = String(value ?? '').match(POST_REF_RE);
  if (!m) return null;
  const [, chain, txHash, index] = m;
  return { chain: chain ?? null, txHash: txHash.toLowerCase(), eventIndex: index == null ? 0 : Number(index) };
}

/**
 * Write a reference in its shortest honest form: no chain when it is the
 * chain of the post carrying it (`ownChain`), and no `/0` for the usual case
 * of one post per transaction.
 * @param {{ chain?: string | null, txHash: string, eventIndex?: number }} ref
 * @param {{ ownChain?: string | null }} [options]
 */
export function formatPostRef({ chain = null, txHash, eventIndex = 0 }, { ownChain = null } = {}) {
  const prefix = chain && chain !== ownChain ? `${chain}:` : '';
  const suffix = eventIndex ? `/${eventIndex}` : '';
  return `${prefix}${String(txHash).toLowerCase()}${suffix}`;
}

/** The keys whose value is a post reference. */
export const POST_REF_KEYS = Object.freeze(['re', 'supersedes', 'prev']);

/**
 * The shape of a language tag (BCP 47), loosely: subtags of letters and
 * digits joined by hyphens. Loose on purpose — the point is to catch a
 * sentence typed where a tag belongs, not to validate against the registry.
 */
export const LANG_RE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** A positive integer in decimal, with no leading zeros. */
export const PART_RE = /^[1-9][0-9]*$/;

/** The longest a series name may be, in Unicode code points. */
export const SERIES_MAX_CHARS = 64;
