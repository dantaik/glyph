// convert.js — the whole trip: a post to its calldata, and back.
//
//     Post ──buildDocument──▶ Document ──encodePayload──▶ Payload ─┐
//      title ──encodeTitle──▶ bytes32 ───────────────────────────────┴─▶ encodePublishCallData ──▶ 0x…
//
// and the reverse, layer by layer. Each layer is its own module and can be
// used on its own; these two functions are the composition, which is what
// most callers want.

import { decodePublishCallData, encodePublishCallData, encodePublishForCallData } from './calldata.js';
import { buildDocument, parseDocument } from './document.js';
import { FORMAT_VERSION, MAX_DOCUMENT_BYTES, decodePayload, encodePayload } from './payload.js';
import { normalisePost } from './post.js';
import { decodeTitle, encodeTitle } from './title.js';

/**
 * @typedef {object} EncodedPost
 * @property {number} version     the format version written
 * @property {string} title       the bytes32, `0x` + 64 hex
 * @property {string} text        the document, exactly as the chain will hold it
 * @property {Uint8Array} payload the compressed document
 * @property {string} callData    the `publish()` calldata, `0x`-prefixed — the
 *   plain form, or the hooked form when `hook` or `hookData` was given
 */

/**
 * Every form of a post on its way to the chain. What a dry run, a cost
 * estimate and a raw view all need at once.
 * @param {import('./post.js').Post} post
 * @param {{ brotli: import('./payload.js').BrotliCodec, version?: number, maxDocumentBytes?: number, hook?: string | null, hookData?: Uint8Array | string | null }} options
 *   `hook` and `hookData` put the post through a hook (v2's four-argument call)
 * @returns {EncodedPost}
 * @throws {import('./errors.js').InvalidPostError} for a post that cannot be written
 * @throws {import('./errors.js').UnsupportedFormatVersionError} for a version this library does not write
 * @throws {import('./errors.js').DocumentTooLargeError} for a document over the bound
 */
export function encodePost(
  post,
  { brotli, version = FORMAT_VERSION, maxDocumentBytes = MAX_DOCUMENT_BYTES, hook = null, hookData = null } = {},
) {
  const canonical = normalisePost(post);
  const title = encodeTitle(canonical.title);
  const text = buildDocument(canonical);
  const payload = encodePayload(text, { brotli, version, maxDocumentBytes });
  return { version, title, text, payload, callData: encodePublishCallData({ title, payload, hook, hookData }) };
}

/**
 * The calldata of a `publish()` call that would publish `post`.
 * @param {import('./post.js').Post} post
 * @param {{ brotli: import('./payload.js').BrotliCodec, version?: number, hook?: string | null, hookData?: Uint8Array | string | null }} options
 * @returns {string} `0x`-prefixed hex
 */
export const postToCallData = (post, options) => encodePost(post, options).callData;

/**
 * The calldata of a `publishFor()` call that would publish `post` on
 * `author`'s behalf. The signature is the author's, over the digest
 * `Xueni.publishDigest(author, title, keccak256(payload), hook,
 * keccak256(hookData), index, deadline)`; making it is a wallet's business,
 * so this takes the finished bytes.
 * @param {import('./post.js').Post} post
 * @param {{ brotli: import('./payload.js').BrotliCodec, version?: number, maxDocumentBytes?: number, author: string, hook?: string | null, hookData?: Uint8Array | string | null, deadline: number | bigint | string, signature: Uint8Array | string }} options
 * @returns {EncodedPost & { author: string }}
 */
export function encodeRelayedPost(post, { author, deadline, signature, hook = null, hookData = null, ...options } = {}) {
  const { version, title, text, payload } = encodePost(post, { ...options, hook, hookData });
  const callData = encodePublishForCallData({ author, title, payload, hook, hookData, deadline, signature });
  return { version, title, text, payload, callData, author };
}

/**
 * @typedef {object} DecodedPost
 * @property {number} version           the format version the payload was written in
 * @property {string} title             from the bytes32 argument
 * @property {string[]} tags
 * @property {string} markdown
 * @property {Record<string, string>} meta  every other front-matter key, as written
 * @property {string} text              the document exactly as the chain holds it
 * @property {number} compressedBytes   the payload's size — what it cost to store
 * @property {import('./calldata.js').DecodedCall} call  which call carried it: the form, the hook and its data, and for a relayed post the author of record, the deadline and the signature
 */

/**
 * The post a `publish()` or `publishFor()` call published.
 * @param {string | Uint8Array} callData the transaction's `input`
 * @param {{ brotli: import('./payload.js').BrotliCodec, maxDocumentBytes?: number }} options
 * @returns {DecodedPost}
 * @throws {import('./errors.js').MalformedCallDataError} for calldata that is not such a call
 * @throws {import('./errors.js').MalformedPayloadError} for a payload that is not a post
 * @throws {import('./errors.js').UnsupportedFormatVersionError} for a version this library does not read
 * @throws {import('./errors.js').DocumentTooLargeError} for a payload that would decompress past the bound
 */
export function callDataToPost(callData, { brotli, maxDocumentBytes = MAX_DOCUMENT_BYTES } = {}) {
  const call = decodePublishCallData(callData);
  const { title, payload } = call;
  const { version, text } = decodePayload(payload, { brotli, maxDocumentBytes });
  const { meta, tags, markdown } = parseDocument(text);
  return { version, title: decodeTitle(title), tags, markdown, meta, text, compressedBytes: payload.length, call };
}
