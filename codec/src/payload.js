// payload.js — the PAYLOAD: the document as the bytes `publish()` carries.
//
// Format version 1, the one on chain: the payload is one raw brotli stream
// (RFC 7932) of the UTF-8 document, and nothing else — no header, no
// version byte, no dictionary, so a decoder needs no side data.
//
// VERSIONS. A version-1 payload carries no marker, and never will: it is
// what every existing post is. A later version is told apart by an
// ENVELOPE in front of it —
//
//     0x91  <version byte>  <version-specific bytes…>
//
// — where 0x91 is a byte no brotli stream can begin with: its low seven bits
// are the one window-size code RFC 7932 §9.1 declares invalid, so every
// brotli decoder refuses it, and it is a UTF-8 continuation byte, so no text
// begins with it either. A version-1 reader that meets one fails on the
// first byte, loudly, rather than showing garbage; this library reads the
// version and says which one it cannot handle.
//
// COMPRESSION IS INJECTED. The package depends on nothing, so the brotli
// codec — `{ compress, decompress }` over Uint8Array — is an argument: Node
// binds `node:zlib` (./brotli/node.js), a browser binds brotli-wasm
// (./brotli/wasm.js). Given the same codec the functions here are pure.

import { MalformedPayloadError, UnsupportedFormatVersionError } from './errors.js';
import { toBytes } from './hex.js';
import { utf8Decode, utf8Encode } from './utf8.js';

/** The format version this library writes. */
export const FORMAT_VERSION = 1;

/** The format versions this library reads. */
export const SUPPORTED_FORMAT_VERSIONS = Object.freeze([1]);

/** The first byte of every payload of a version later than 1. */
export const VERSION_ENVELOPE_BYTE = 0x91;

/**
 * The brotli parameters of the reference writer. Quality 11 is the format's
 * one stated parameter; the rest are the encoder's defaults, named here so
 * that a binding for another brotli library can match them.
 */
export const REFERENCE_BROTLI = Object.freeze({ quality: 11, lgwin: 22, mode: 'generic' });

/**
 * @typedef {object} BrotliCodec
 * @property {(bytes: Uint8Array) => Uint8Array} compress   a raw brotli stream
 * @property {(bytes: Uint8Array) => Uint8Array} decompress the bytes it held
 */

/** @param {unknown} brotli @returns {BrotliCodec} */
export function assertBrotli(brotli) {
  if (!brotli || typeof brotli.compress !== 'function' || typeof brotli.decompress !== 'function') {
    throw new TypeError(
      'a brotli codec is required: pass { brotli } with compress() and decompress() over Uint8Array ' +
        '— `xueni-codec/node` binds node:zlib, `xueni-codec/brotli-wasm` wraps a brotli-wasm module',
    );
  }
  return brotli;
}

/**
 * The format version `payload` declares: 1 for an unmarked payload, else
 * the envelope's version byte.
 * @param {Uint8Array | string} payload
 * @returns {number}
 * @throws {MalformedPayloadError} for an empty payload or a truncated envelope
 */
export function detectFormatVersion(payload) {
  const bytes = toBytes(payload, 'payload');
  if (bytes.length === 0) throw new MalformedPayloadError('an empty payload is not a post');
  if (bytes[0] !== VERSION_ENVELOPE_BYTE) return 1;
  if (bytes.length < 2) throw new MalformedPayloadError('a version envelope with no version byte');
  const version = bytes[1];
  if (version < 2) {
    throw new MalformedPayloadError(`a version envelope naming version ${version}, which is never enveloped`, { version });
  }
  return version;
}

/**
 * The payload for a document.
 * @param {string} text the document (see document.js)
 * @param {{ brotli: BrotliCodec, version?: number }} options
 * @returns {Uint8Array}
 * @throws {UnsupportedFormatVersionError} for a version this library does not write
 */
export function encodePayload(text, { brotli, version = FORMAT_VERSION } = {}) {
  if (version !== 1) throw new UnsupportedFormatVersionError(version, SUPPORTED_FORMAT_VERSIONS);
  const codec = assertBrotli(brotli);
  return codec.compress(utf8Encode(String(text ?? '')));
}

/**
 * The document a payload holds, and the version it was written in.
 * @param {Uint8Array | string} payload
 * @param {{ brotli: BrotliCodec }} options
 * @returns {{ version: number, text: string }}
 * @throws {UnsupportedFormatVersionError} for a version this library does not read
 * @throws {MalformedPayloadError} for bytes that are not a payload of a known version
 */
export function decodePayload(payload, { brotli } = {}) {
  const bytes = toBytes(payload, 'payload');
  const version = detectFormatVersion(bytes);
  if (!SUPPORTED_FORMAT_VERSIONS.includes(version)) {
    throw new UnsupportedFormatVersionError(version, SUPPORTED_FORMAT_VERSIONS);
  }
  const codec = assertBrotli(brotli);
  let document;
  try {
    document = codec.decompress(bytes);
  } catch (cause) {
    throw new MalformedPayloadError(`not a brotli stream: ${cause?.message ?? cause}`, { cause });
  }
  return { version, text: utf8Decode(document) };
}
