// shared.js — the webapp modules the command-line tool is allowed to import.
//
// The payload layer, the title encoding, the contract surface, the chain
// registry and the byte ceilings are the app's, not the CLI's: a post
// published from a terminal has to be byte-for-byte what the web app would
// have written, and a post read here has to decode exactly as it does in a
// browser. The only way to guarantee that is to run the same code, so these
// five modules are imported straight out of `webapp/src/lib/` rather than
// copied — the e2e mock node does the same thing for the same reason.
//
// The list is deliberately short, and this file is the one place it lives so
// that widening it is a visible act. Every module below is plain JavaScript:
// no `import.meta.env`, no `window`, no React, no brotli-wasm. Everything
// else under `webapp/src/lib/` touches at least one of those and would throw
// the moment plain Node loaded it — `config.js` reads Vite's environment,
// `payload.js` pulls in the WASM brotli build, `publish.js` wants a browser
// wallet. `test/shared.test.js` imports each of the five here in plain Node,
// so a change that makes one of them browser-only fails loudly in this
// package instead of quietly at a user's terminal.

export { abi, POST_EVENT } from '../../webapp/src/lib/abi.js';
export {
  CHAINS,
  DEFAULT_GLYPH_ADDRESS,
  SELECTABLE_CHAIN_IDS,
  chainFromSlug,
  chainSlug,
  defaultRpcs,
  getChain,
  isKnownChain,
} from '../../webapp/src/lib/chains.js';
export { MAX_CALLDATA_BYTES, MAX_TX_BYTES } from '../../webapp/src/lib/limits.js';
export {
  FRONT_MATTER_KEYS,
  buildPayloadText,
  parsePayloadText,
  parseTags,
  splitFrontMatter,
} from '../../webapp/src/lib/payloadText.js';
export {
  TITLE_MAX_BYTES,
  decodeTitle,
  encodeTitle,
  titleByteLength,
} from '../../webapp/src/lib/title.js';
