// index.js — the public surface of the Xueni post codec.
//
// Environment-agnostic: nothing here imports Node or the DOM, so the same
// module runs in a browser, in Node and in a worker. The only thing it does
// not bring is brotli itself — pass `{ brotli }` (see ./brotli/) or import
// `xueni-codec/node`, which binds Node's built-in one.
//
// The specification these functions implement is SPEC.md, next to this file.

export { CodecError, InvalidPostError, MalformedCallDataError, MalformedPayloadError, UnsupportedFormatVersionError } from './errors.js';

// The post, and what makes one writable.
export { normalisePost, postProblems, validatePost } from './post.js';

// The document: front-matter + Markdown.
export { FRONT_MATTER_KEYS, KEY_RE, RESERVED_KEYS, buildDocument, frontMatterEntries, parseDocument, parseTags, splitFrontMatter } from './document.js';

// The values of the defined keys.
export { LANG_RE, PART_RE, POST_REF_KEYS, POST_REF_RE, SERIES_MAX_CHARS, formatPostRef, parsePostRef } from './refs.js';

// The title as a bytes32.
export { TITLE_MAX_BYTES, decodeTitle, encodeTitle, fitTitle, titleByteLength, titleProblems } from './title.js';

// The payload, and the format version.
export {
  FORMAT_VERSION,
  REFERENCE_BROTLI,
  SUPPORTED_FORMAT_VERSIONS,
  VERSION_ENVELOPE_BYTE,
  decodePayload,
  detectFormatVersion,
  encodePayload,
} from './payload.js';

// The calldata.
export {
  POST_EVENT_SIGNATURE,
  POST_EVENT_TOPIC,
  PUBLISH_SELECTOR,
  PUBLISH_SIGNATURE,
  decodePublishCallData,
  encodePublishCallData,
  isPublishCallData,
} from './calldata.js';

// The whole trip.
export { callDataToPost, encodePost, postToCallData } from './convert.js';

// Bytes and hex, for callers that have one and need the other.
export { bytesToHex, hexToBytes, isHex } from './hex.js';
export { utf8ByteLength } from './utf8.js';

// The codec interface a browser binding implements.
export { fromBrotliWasm } from './brotli/wasm.js';
