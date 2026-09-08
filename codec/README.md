# `xueni-codec` — the post codec

The conversion between a [Xueni](../README.md) post as a person sees it — a title, some tags, a
Markdown body, a little front-matter — and the call data of the `publish(bytes32,bytes)` call that
stores it on chain, in both directions, as **pure functions**: no wallet, no node, no I/O, no
dependencies. A post in, `0x…` out; `0x…` in, the post out. Given the same compressor, the same
input always gives the same bytes.

**The specification is [`SPEC.md`](./SPEC.md).** It is normative and versioned; this package is its
reference implementation, and the test suite here is the conformance suite. The design of the whole
system — why a post is shaped like this — is [`../glyph-spec.md`](../glyph-spec.md).

## The four forms of a post

```
   Post ─────buildDocument────▶ Document ─────encodePayload────▶ Payload ──┐
        ◀────parseDocument────          ◀────decodePayload────            │  encodePublishCallData
   title ────encodeTitle─────▶ bytes32 ───────────────────────────────────┴──▶ Call data
        ◀────decodeTitle─────                                                   decodePublishCallData
```

| Form | What it is | Where you meet it |
| --- | --- | --- |
| **Post** | `{ title, tags, markdown, meta }` | the write tab, a `.md` import, a reader's view |
| **Document** | front-matter + Markdown, one UTF-8 text | "Raw" on a post page, `Download .md`, an archive bundle, `xueni verify` |
| **Payload** | the document, brotli-compressed (format version 1) | the second argument of `publish()`; its size is what the post cost |
| **Call data** | selector + ABI(`bytes32`, `bytes`) | `tx.input`, what a wallet signs |

Each hop is its own pair of functions, and `postToCallData` / `callDataToPost` are the composition.

## Using it

Node 22 or newer. The package is plain ECMAScript modules; there is nothing to build.

```bash
cd codec && npm install      # dev dependencies only — the library itself has none
```

**In Node**, `xueni-codec/node` has Node's built-in brotli already bound:

```js
import { postToCallData, callDataToPost, encodePost, validatePost } from 'xueni-codec/node';

const post = {
  title: '关于外婆的香樟木箱',
  tags: ['letters home', '冬'],
  markdown: '# 冬至\n\n正文。\n',
  meta: { lang: 'zh', series: 'Letters to Xiaoman', part: '3' },
};

const { ok, problems } = validatePost(post);   // errors the writer refuses on, warnings it does not
const callData = postToCallData(post);         // '0x70a74532…' — hand it to writeContract / sendTransaction
const back = callDataToPost(tx.input);         // { version: 1, title, tags, markdown, meta, text, compressedBytes }

const { text, payload, title, callData: same } = encodePost(post);   // every layer at once: a dry run
```

**In a browser**, the compressor is injected. brotli-wasm is what the web app uses; wrap the
initialised module once and pass it as `{ brotli }`:

```js
import init from 'brotli-wasm';
import { postToCallData, callDataToPost, fromBrotliWasm } from 'xueni-codec';

const brotli = fromBrotliWasm(await init);
const callData = postToCallData(post, { brotli });
const back = callDataToPost(tx.input, { brotli });
```

Any object with `compress(bytes) → bytes` and `decompress(bytes) → bytes` over `Uint8Array` will do,
as long as `compress` is brotli at quality 11 with no dictionary (`REFERENCE_BROTLI` names the
parameters). `xueni-codec/node` and `xueni-codec/brotli-wasm` are the two bindings shipped here, and
the test suite checks that they produce identical bytes.

This repository has no workspace, so from inside it the import is a relative path —
`../codec/src/node.js` from `cli/`, `../codec/src/index.js` from `webapp/src/lib/` — exactly the way
the command-line tool already imports the web app's modules.

## The API

Everything below is exported from `xueni-codec`; `xueni-codec/node` re-exports it all and binds
`brotli` on the five functions that need one.

**The whole trip**

| Function | |
| --- | --- |
| `postToCallData(post, { brotli, version?, maxDocumentBytes? })` | `0x…` call data. Throws `InvalidPostError` with every problem, `UnsupportedFormatVersionError`, or `DocumentTooLargeError`. |
| `callDataToPost(callData, { brotli, maxDocumentBytes? })` | `{ version, title, tags, markdown, meta, text, compressedBytes }`. Throws `MalformedCallDataError`, `MalformedPayloadError`, `UnsupportedFormatVersionError`, `DocumentTooLargeError`. |
| `encodePost(post, { brotli, version?, maxDocumentBytes? })` | `{ version, title, text, payload, callData }` — every intermediate form, for a dry run or a cost estimate. |

**The post** — `validatePost(post)` → `{ ok, problems }`, every problem at once, each
`{ level: 'error' | 'warning', path, code, message }`; `postProblems(post)` the list alone;
`normalisePost(post)` the canonical form a reader gets back (trimmed, empties dropped, `meta.tags`
folded into `tags`). `parsePostRef` / `formatPostRef` read and write the `[chain:]0x…[/n]` references
that `re`, `supersedes` and `prev` carry.

**The title** — `encodeTitle(string)` → bytes32 hex; `decodeTitle(hex | bytes)` → string;
`titleByteLength`; `fitTitle` (cut to 32 bytes at a grapheme boundary — for editors; the encoder
never cuts on its own); `TITLE_MAX_BYTES`.

**The document** — `buildDocument({ markdown, tags, meta })` → text; `parseDocument(text)` →
`{ meta, tags, markdown }`; `splitFrontMatter(text)` → `{ matched, meta, body }` (the reader, exactly
as every existing reader behaves); `parseTags`; `FRONT_MATTER_KEYS`, `RESERVED_KEYS`, `KEY_RE`.

**The payload** — `encodePayload(text, { brotli, version?, maxDocumentBytes? })` → bytes;
`decodePayload(bytes, { brotli, maxDocumentBytes? })` → `{ version, text }`; `detectFormatVersion(bytes)`;
`FORMAT_VERSION` (written by default), `SUPPORTED_FORMAT_VERSIONS` (read), `VERSION_ENVELOPE_BYTE`,
`REFERENCE_BROTLI`, `MAX_DOCUMENT_BYTES` (4 MiB, the default bound on both sides).

**The call data** — `encodePublishCallData({ title, payload })` → hex; `decodePublishCallData(hex | bytes)`
→ `{ title, payload }`; `isPublishCallData`; `PUBLISH_SELECTOR` (`0x70a74532`), `PUBLISH_SIGNATURE`,
`POST_EVENT_TOPIC`, `POST_EVENT_SIGNATURE`.

**Errors** — all `CodecError`s with a stable `.code`: `InvalidPostError` (`.problems`),
`UnsupportedFormatVersionError` (`.version`, `.supported`), `MalformedPayloadError`,
`MalformedCallDataError`, `DocumentTooLargeError` (`.limit`).

## Security

Every byte of a post is put on chain by a stranger, so the codec treats every field as hostile
input and never as code; SPEC §10 says what that means for the codec and for whoever renders what
it returns. Three things the library does about it:

- **Decompression is bounded, while decompressing.** Brotli turns 106 bytes into 64 MiB, so a
  payload that fits any transaction can decompress into more memory than a browser tab has. Every
  reading function takes `maxDocumentBytes` (default `MAX_DOCUMENT_BYTES`, 4 MiB) and refuses with
  `DocumentTooLargeError` the moment the output passes it — `node:zlib` stops at `maxOutputLength`,
  and the brotli-wasm binding decodes through the streaming API a chunk at a time — rather than
  decompressing first and measuring after. The writer refuses a document over the same bound, so a
  conforming writer cannot produce a post a conforming reader refuses. Pass `Infinity` only for bytes
  you trust, which bytes from the chain never are.
- **Control characters are refused.** A title, a tag or a front-matter value with a C0 control
  (other than TAB), DEL or a C1 control is an error (`CONTROL_CHAR`) — a terminal printing a list of
  titles would obey an escape sequence in one — and so is a body with one other than TAB, LF, FF or
  CR. Bidirectional controls (U+202A–U+202E, U+2066–U+2069), which can make a title or a code block
  read differently from how it is stored, are reported as a warning (`BIDI_CONTROL`), because some
  scripts use them honestly.
- **Nothing is executed or interpreted.** The codec's outputs are strings and bytes; what a reader
  must do before putting them into a page (an allowlist sanitizer over the *rendered* HTML, text
  nodes for the title and the values, a fixed MIME type for images) is SPEC §10.2–§10.5. In this
  repository that reader is `webapp/src/lib/renderMarkdown.js`, and its test file is the corpus of
  injections it has to neutralise.

## Versions

The bytes on chain carry a **format version** (SPEC §5.2). Version 1 — every post so far — is a bare
brotli stream with no marker. A later version begins with the byte `0x91`, which no brotli stream and
no UTF-8 text can begin with, followed by its version number; so a reader of this version fails
loudly on a newer post rather than showing garbage, and `callDataToPost` names the version it cannot
read. `postToCallData(post, { version })` chooses what to write; the default is the latest this
library implements. A new front-matter key is **not** a new version — unknown keys survive every
reader untouched, which is the format's extension mechanism.

## What it does not do

- **Talk to anything.** No RPC, no wallet, no file. The web app's `publish.js` and `chainIO.js` and
  the CLI's `walk.js` are where those live; this package is the pure function they call.
- **Handle images.** An image is a transaction of its own and the body references it as
  `![alt](eth:0x<txhash>)`; that reference is just text to the codec.
- **Enforce size.** The transaction pool's 128 KiB ceiling (`webapp/src/lib/limits.js`) is a policy
  of nodes, not of the format; measure `encodePost(post).payload.length` against it before signing.
- **Cut titles or drop keys on its own.** A title over 32 bytes and a value with a line break are
  refused with the reason; what to do about them is the author's decision.

## Tests

```bash
cd codec && npm test
```

`node --test` over `test/`. Besides each layer on its own, three suites are worth knowing about:

- **`vectors.test.js`** checks the specification's vectors (`test/vectors.json`): the document and
  the bytes32 are normative; the call data pins the reference encoder's bytes. If a future Node ships
  a brotli whose output changes, only that last check fails, and `npm run vectors` rewrites the file
  once a human has decided that is what happened.
- **`interop.test.js`** holds this package to the web app's `payloadText.js` and `title.js` — the
  code that has written every post so far — byte for byte, on fuzzed input, and checks that
  `brotli-wasm` (the browser) and `node:zlib` (the CLI) compress identically. It needs the web app's
  dependencies installed (`cd webapp && npm ci`); without them those tests are skipped, not failed.
- **`payload.test.js`** checks the version envelope's claim: across inputs, qualities and window
  sizes, no brotli stream begins with `0x91`, and both decoders refuse one that does.
