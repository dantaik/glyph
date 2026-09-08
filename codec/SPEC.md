# Xueni post codec — specification

**Format version 1 · specification revision 1.0 · 2026-09**

This document states, normatively, how a **post** as a person sees it — a title, some tags, a
Markdown body, a little metadata — becomes the **call data** of the `publish(bytes32,bytes)` call
that stores it on chain, and how that call data becomes the post again. The library beside this
file (`xueni-codec`, see [`README.md`](./README.md)) is the reference implementation, and its test
suite, with the vectors in [`test/vectors.json`](./test/vectors.json), is the conformance suite.

[`../glyph-spec.md`](../glyph-spec.md) is the design document of the whole system: why the contract
is shaped as it is, how a reader finds posts, what the Markdown subset is. This specification is the
normative statement of one seam in it — its §5 (the payload) and the calldata around it — written so
that a second implementation, in another language or decades from now, can be checked against it.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as in RFC 2119.

## Contents

0. [Status and versions](#0-status-and-versions)
1. [Scope and terms](#1-scope-and-terms)
2. [Format version 1 at a glance](#2-format-version-1-at-a-glance)
3. [The post](#3-the-post)
4. [The document](#4-the-document)
5. [The payload](#5-the-payload)
6. [The call data](#6-the-call-data)
7. [Errors](#7-errors)
8. [Versioning](#8-versioning)
9. [Conformance](#9-conformance)
- [Appendix A — test vectors](#appendix-a--test-vectors)
- [Appendix B — grammar summary](#appendix-b--grammar-summary)
- [Appendix C — the reference implementation](#appendix-c--the-reference-implementation)

---

## 0. Status and versions

Two numbers, kept apart on purpose:

- **The format version** is an integer carried by the bytes themselves (§5.2) and names the wire
  format. **Version 1** is the format of every post published since the contract was deployed
  (2026-09-02), and is what this document specifies. A version-1 payload carries no marker, and
  never will; every later version is enveloped so that a version-1 reader can tell it from a
  corrupt post (§5.2, §8).
- **The specification revision** is this document's own number. A new *defined key* (§3.4), a new
  advisory rule, a clarification: a new revision. A change to the bytes of an existing post or to how
  a reader must read them: a new format version (§8).

| Revision | Format | Date | Change |
| --- | --- | --- | --- |
| 1.0 | 1 | 2026-09 | First normative statement of the format in use since deployment. |

## 1. Scope and terms

A post exists in four forms. This specification defines each and the conversion between neighbours:

```
   Post ────(§4.1 build)────▶ Document ────(§5.1 compress)────▶ Payload ──┐
        ◀───(§4.2 parse)────           ◀───(§5.4 decompress)──            │  (§6 encode / decode)
   title ──(§3.1 encode)──▶ bytes32 ───────────────────────────────────────┴──▶ Call data
        ◀─(§3.1 decode)───
```

- **Post** (the *presentation*) — what an author writes and a reader is shown: `title`, `tags`,
  `markdown`, `meta` (§3).
- **Document** — one UTF-8 text: an optional front-matter block followed by the Markdown body (§4).
  It is what the raw view shows, what a `.md` download holds and what an archive bundle carries.
- **Payload** — bytes: the document, compressed (§5). The second argument of `publish()`.
- **Call data** — bytes: the transaction's `input`: the function selector followed by the ABI
  encoding of `(bytes32 title, bytes payload)` (§6).

A **writer** turns a post into call data; a **reader** turns call data into a post. An
implementation MAY provide one direction only. Both directions are pure: they depend on nothing but
their input (and, for a writer, the compressor it is given).

Out of scope, and specified elsewhere: images (each one its own transaction, referenced from the body
as `eth:0x…`, glyph-spec §6); the Markdown subset and its rendering (glyph-spec §8); what a chain
slug in a post reference resolves to (the application's registry, glyph-spec §5.1); transaction size
and gas ceilings (glyph-spec §11 — informative note in §6.4).

## 2. Format version 1 at a glance

```
call data  =  0x70a74532                                     selector of publish(bytes32,bytes)
           ‖  title      32 bytes   UTF-8, right-padded with 0x00
           ‖  0x…40      32 bytes   offset of the payload (64, counted after the selector)
           ‖  length     32 bytes   byte length of the payload
           ‖  payload    length bytes
           ‖  0x00 …     0–31 bytes right-padding to a multiple of 32

payload    =  brotli( utf8( document ) )                     RFC 7932, quality 11, no dictionary

document   =  [ "---" LF  ( key ": " value LF )*  "---" LF LF ]  body
```

A post with no metadata is stored as its bare Markdown, with no front-matter block at all.

## 3. The post

A post is an object of four fields. Every string in it MUST be well-formed Unicode: a lone surrogate
cannot be encoded as UTF-8, and a writer that let the encoder replace it with U+FFFD would store a
document the author did not write. A writer MUST refuse such a post.

```
Post = {
  title:    string                  §3.1
  tags:     string[]                §3.2
  markdown: string                  §3.3
  meta:     { [key: string]: string }   §3.4
}
```

### 3.1 The title

The title is the one part of a post the contract sees: it is the first argument of `publish()`, and
the contract copies it into the `Post` event so that a list of titles can be read from logs without
decompressing anything.

- **Encoding.** The UTF-8 bytes of the title, right-padded with `0x00` to 32 bytes, as a `bytes32`.
- **Constraints.** The UTF-8 encoding MUST be at most **32 bytes** (32 ASCII letters, about ten
  Chinese characters, eight four-byte emoji). The title MUST NOT contain U+0000, because the padding
  is zero bytes and a reader cannot tell a NUL inside the title from the padding after it. A title
  MAY be empty (32 zero bytes). A writer MUST NOT truncate a title on its own: a title silently cut is
  a title nobody meant. An editor that offers to cut one SHOULD cut at a grapheme boundary, never
  inside a character or an emoji sequence.
- **Decoding.** Strip every trailing `0x00` byte; decode the rest as UTF-8 in **replacement mode**
  (one U+FFFD per maximal invalid subpart, as the WHATWG Encoding Standard defines it), keeping a
  leading byte-order mark. A reader MUST NOT fail on a title that is not valid UTF-8 — a foreign
  writer that cut a title mid-character has still published a post, and the post must read.

### 3.2 The tags

A list of free-form labels, in the order the author gave them. A writer MUST trim each tag and drop
the empty ones, and MUST refuse a tag that contains a comma (the separator) or a line break. Because
of the reader's bracket rule (§4.2, step 6), the **first tag MUST NOT begin with `[`** and the
**last tag MUST NOT end with `]`**; a writer MUST refuse such a list. Tags are not deduplicated and
their case is not changed.

### 3.3 The body

The Markdown body, as a string. It is carried **byte for byte**: a writer MUST NOT alter it in any
way — not its line endings, not its trailing whitespace, not a byte-order mark it begins with. What
the body may contain is the Markdown subset of glyph-spec §8; this specification does not check it.

### 3.4 The metadata

Every other piece of the front-matter, as a map from key to value.

**Keys.** A writer MUST only emit keys matching `[A-Za-z][A-Za-z0-9_-]*`. The key `tags` is
represented by the `tags` list (§3.2), never by `meta`. The key **`title` is reserved**: the title is
the bytes32 argument, a copy in the front-matter would be paid for twice and could disagree with it,
so a writer MUST refuse a post whose `meta` contains it. (A reader MAY still encounter one, written
by a tool that follows a static-site convention; it is treated as any other unknown key.)

**Values.** A value is a string; a writer MUST trim it, MUST omit a key whose trimmed value is empty,
and MUST refuse a value containing CR or LF. A writer MAY accept a number (written in decimal) or a
list of strings (written joined with `", "`) where a caller's convenience wants it; on the wire and
in the canonical post they are strings.

**Defined keys.** This revision defines the following keys. The value grammars are **advisory**: a
writer SHOULD warn its author when a value does not fit, MAY refuse to write it, and a reader MUST
NOT fail over one — the post is on chain whatever it says.

| Key | Value | Meaning |
| --- | --- | --- |
| `tags` | tags joined with `", "` | free-form labels (§3.2) |
| `lang` | a BCP 47 language tag, e.g. `zh`, `en-GB` | the language the post is written in |
| `re` | a post reference | this post replies to that one |
| `supersedes` | a post reference | this post replaces that one — the only honest edit on an immutable chain |
| `prev` | a post reference | this post continues that one |
| `series` | text of at most 64 Unicode code points | the name of a series, belonging to this author |
| `part` | a positive integer, decimal, no leading zeros | this post's number within `series`; meaningless without it |

A **post reference** names another post by the transaction that published it:

```
post-ref   = [ chain ":" ] tx-hash [ "/" event-index ]
chain      = 1*( %x61-7A / DIGIT / "-" )          a lowercase slug: taiko, ethereum, …
tx-hash    = "0x" 64HEXDIG                        the publish() transaction, either case
event-index = "0" / ( %x31-39 *DIGIT )            0-based ordinal of the Post event in it; default 0
```

With no chain, the reference means the chain of the post that carries it. A writer SHOULD write the
shortest form: no chain when it is the post's own, no `/0`. What a slug resolves to is out of scope.

**Unknown keys are the extension mechanism.** A reader MUST keep every key it does not know, as
written, and MUST NOT fail over one. A writer MUST write the keys it is given whether it knows them or
not (after the defined ones, §4.1). A new defined key is a new specification revision, not a new
format version — an older reader ignores what it does not recognise, and loses nothing.

### 3.5 The canonical post, and the round trip

The **canonical form** of a post is: the title and the body unchanged; the tags trimmed with the
empties dropped; the metadata with every value trimmed, the empties dropped, and any `tags` entry
folded into the tags list. Writing normalises: for every post `p` a writer accepts,

```
parse( build( p ) )   =  canonical( p )         the reader gets the canonical post back
build( canonical(p) ) =  build( p )             normalising changes no bytes
canonical( canonical(p) ) = canonical( p )
```

and consequently `read( write( p ) )` yields `canonical(p)` and the document `build(p)` exactly. A
conforming writer MUST satisfy these for every post it accepts; the way to satisfy them is to refuse
what §3 forbids.

## 4. The document

The document is one UTF-8 text with, optionally, a front-matter block at its very beginning. Its
grammar is deliberately a small, hand-parsable subset of the YAML front-matter every static-site
generator uses, so that any editor opens it and any person reads it, decades from now.

### 4.1 Writing (build)

Given a canonical post (§3.5), with `tags` and `meta` already validated:

1. Form the list of **entries** `(key, line)`:
   1. For each defined key, in this exact order — `tags`, `lang`, `re`, `supersedes`, `prev`,
      `series`, `part` — if the post has a non-empty value for it, append the entry. The `tags`
      line is the tags joined with `", "` (comma, space).
   2. Then every other key of `meta`, sorted by the ASCII value of the key (`Beta` before `alpha`),
      each with its trimmed value.
2. If the list is **empty**:
   - if the body would itself be read as beginning with a front-matter block (i.e. §4.2 applied to
     the body alone matches — it starts with a `---` line, a later `---` line closes it, and every
     line between is blank or `key: value`), the document is `"---\n---\n\n"` followed by the body;
   - otherwise the document is the body, exactly.
3. Otherwise the document is:

   ```
   "---" LF
   for each entry:  key ":" SP line LF
   "---" LF
   LF
   body
   ```

   — the delimiters, one `key: value` line per entry, a blank separator line, then the body byte
   for byte. Line breaks in the block are LF; the body's own are whatever they are.

The empty-block rule of step 2 exists because a bare body that *looks like* front-matter would be
misread by every reader; with the explicit empty block, §4.2 stops at the first closing delimiter
and the body comes back whole. The reference implementation checks this case with its own reader.

### 4.2 Reading (parse)

Every existing reader of the chain follows these rules, so they are frozen: a document on chain must
read the same everywhere, for ever. "Trimmed" below means ECMAScript `String.prototype.trim`:
leading and trailing Unicode White_Space, U+FEFF and line terminators removed.

Given the document `T`:

1. Split `T` on LF (U+000A) into lines `L[0], L[1], …`. CR is not a separator (a trailing CR is
   removed by trimming, so CRLF documents read the same as LF ones).
2. If `L[0]` trimmed is not exactly `---`: **no front-matter**; the body is `T`.
3. Find the smallest `i ≥ 1` such that `L[i]` trimmed is `---`. If there is none: no front-matter;
   the body is `T`.
4. For each `L[j]`, `0 < j < i`, in order: if `L[j]` trimmed is empty, skip it. Otherwise it MUST
   contain a colon; if it does not, **no front-matter**, the body is `T`. The key is the text before
   the first colon, trimmed; the value is the text after it, trimmed. A later line with the same key
   replaces the earlier one. (A reader accepts any key here, including an empty one; only a writer
   is held to §3.4.)
5. The body is `L[i+1..]` joined with LF; if it begins with LF, that one LF is removed (it is the
   separator a writer emits). Nothing else is removed: a body that begins with two blank lines keeps
   one.
6. The `tags` value, if present, becomes the tag list: remove one leading `[` if the value begins
   with one, and one trailing `]` if it ends with one (independently); split on commas; trim each
   piece; drop the empty pieces. Every other key is kept as written, in `meta`.

The reader is total: any string is a document, and the worst case is a document with no
front-matter whose body is the whole text.

### 4.3 Examples

A post with two tags and a language:

```
---
tags: letters home, 冬
lang: zh
---

# 冬至

正文。
```

The same body with no metadata is stored as exactly `# 冬至\n\n正文。\n` — no block. A body beginning
with a thematic break (`---` followed by a blank line and prose) is stored bare, because step 4
rejects `prose` as a `key: value` line. A body beginning with `---\nfoo: bar\n---` gets the empty
block (§4.1 step 2) in front of it. Appendix A carries these as vectors.

## 5. The payload

### 5.1 Version 1: one brotli stream

The version-1 payload is the UTF-8 bytes of the document, compressed as **one raw brotli stream**
(RFC 7932) — no container, no header, no version byte, and **no custom dictionary**, so that a
decoder needs no side data and the stream is self-describing for as long as brotli is.

A writer MUST compress with **quality 11**. Every other parameter of the reference encoder is at its
default (window `lgwin = 22`, generic mode): these are what the reference implementation uses, and a
binding for another brotli library SHOULD match them (see §5.3 for what happens if it does not).

### 5.2 Version detection, and the envelope

The **first byte** of the payload says which format version it is:

- An empty payload is not a post. A reader MUST refuse it.
- A payload whose first byte is **`0x91`** is a **version envelope**: the second byte is the format
  version (2 to 255), and the bytes after it belong to that version. An envelope with no second byte,
  or one naming version 0 or 1, is malformed; a reader MUST refuse it.
- Any other first byte: **version 1**, a brotli stream (§5.1).

Why `0x91`: RFC 7932 §9.1 encodes the window size in the first one to seven bits of a stream and
declares exactly one seven-bit pattern invalid — the one whose value, as a byte, is `0x11` or `0x91`.
No brotli stream begins with either byte, so every brotli decoder refuses a version envelope on its
first byte, and a version-1 reader that meets one fails loudly rather than showing garbage. `0x91` is
also a UTF-8 continuation byte, so no text begins with it either. The reference test suite checks the
claim across inputs, qualities and window sizes, and checks that both brotli implementations in this
repository refuse it.

A reader that meets a version it does not implement MUST refuse the payload, naming the version, and
MUST NOT guess. A writer MUST write the version it was asked for, or refuse if it does not implement
it; with no version asked for, it SHOULD write the latest version it implements. This revision
implements version 1 only.

### 5.3 What the specification fixes, and what it does not

The **document** is normative: two writers given the same canonical post MUST produce the same
document, byte for byte (§4.1 leaves no choice). The **brotli stream is not**: any stream that
decompresses to the document is a valid version-1 payload, and two conforming writers built on
different brotli implementations, or different releases of one, MAY produce different bytes for the
same document. A reader MUST therefore never compare payloads to compare posts; it compares documents.

The reference implementation nevertheless keeps its encoder **stable**: the browser (`brotli-wasm`)
and Node (`node:zlib`) produce identical streams at these parameters, the test suite checks it, and
the vectors in Appendix A pin the bytes the reference produces today. That stability is what lets
the same post cost the same from either surface and lets an image ledger recognise bytes it has paid
for before; it is a property of the reference implementation, not a requirement on others.

### 5.4 Reading

Decompress the stream; decode the bytes as UTF-8 in replacement mode (§3.1), **keeping a leading
byte-order mark** — the document the reader shows must be the bytes the chain holds; then parse
(§4.2). A payload that is not a brotli stream is malformed and MUST be refused. A payload whose bytes
are not valid UTF-8 is still a document (with U+FFFD where the damage is) and MUST NOT be refused.

Readers SHOULD report the payload's size in bytes alongside the post: it is what the post cost to
store, and the raw view, archives and the command-line tool all carry it as `compressedBytes`.

## 6. The call data

### 6.1 The function

```solidity
function publish(bytes32 title, bytes calldata payload) external;
```

The contract reads `title` and never reads `payload`: the payload rides in the transaction's calldata
only, is never copied to storage or to the event, and is read back with `eth_getTransactionByHash`.

The selector is the first four bytes of `keccak256("publish(bytes32,bytes)")`:

```
PUBLISH_SELECTOR = 0x70a74532
```

### 6.2 Layout

Standard ABI encoding of `(bytes32, bytes)`, which for these two types is fixed:

| Offset (bytes) | Size | Content |
| --- | --- | --- |
| 0 | 4 | `70 a7 45 32`, the selector |
| 4 | 32 | the title, as §3.1 encodes it |
| 36 | 32 | the offset of the payload's length word, counted from byte 4: `0x40` = 64 |
| 68 | 32 | the payload's length in bytes, big-endian |
| 100 | *length* | the payload |
| 100 + *length* | 0–31 | `0x00` padding to the next multiple of 32 (after byte 4) |

A writer MUST produce exactly this layout (offset `0x40`, full padding). Call data is written as
lowercase hex with a `0x` prefix wherever it is text.

### 6.3 Reading

A reader:

1. MUST refuse call data whose first four bytes are not the selector, saying what they were: it is
   some other call, not a post.
2. MUST read the offset from bytes 36–67 rather than assuming `0x40`, and MUST refuse an offset that
   does not leave room for a length word inside the data.
3. MUST read the length at that offset and MUST refuse call data that does not hold *length* bytes
   of payload after it: a payload cut short is not a post.
4. MUST accept call data with **bytes after the payload's padding**, and with **padding shorter than
   canonical**, as every ABI decoder does — such data is not what a conforming writer produces, but
   a node hands back whatever was signed, and the post inside it is intact.
5. MUST refuse an offset or a length too large to be a size (the reference refuses anything above
   2⁵³ − 1; every real payload is under 2¹⁷).

The title is bytes 4–35 as a bytes32 (§3.1); the payload is a copy of the *length* bytes at
offset + 36 (that is, counted from byte 4, offset + 32).

### 6.4 Informative: the event, and the limits

`publish()` emits `Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)`,
whose topic 0 is

```
POST_EVENT_TOPIC = keccak256("Post(address,uint256,uint256,bytes32)")
                 = 0x5cd0759ab74dbe8f489ac7602146c443e7d2eedf00377e0c113b0466b4ffde5f
```

and whose `title` is the same bytes32 as the call's — §3.1 decoding applies to it unchanged. One
transaction MAY emit several `Post` events (a multicall); the pair (transaction hash, 0-based event
ordinal) identifies a post, which is what a post reference (§3.4) names. Decoding events is a
client's job and outside this specification.

There is no size ceiling in the format. In practice a transaction is bounded by the transaction
pool's size limit (128 KiB on geth's default, see glyph-spec §11 and `webapp/src/lib/limits.js`),
which binds long before the per-transaction gas cap; a writer that wants to refuse an oversize post
before signing measures the payload (§5) against that ceiling.

## 7. Errors

A conforming implementation MUST distinguish, at least, these situations, and SHOULD report every
problem it finds in a post rather than the first:

| Situation | Direction | Reference code |
| --- | --- | --- |
| The post cannot be written as given (§3): title over 32 bytes or with a NUL, a lone surrogate anywhere, a key outside the grammar or reserved, a value with a line break, a tag with a comma, the bracket rule | write | `INVALID_POST`, with one problem per field: `TITLE_TOO_LONG`, `TITLE_NUL`, `MALFORMED_UNICODE`, `KEY_SYNTAX`, `KEY_RESERVED`, `VALUE_LINE_BREAK`, `TAG_COMMA`, `TAG_BRACKET`, `TYPE` |
| A value that does not fit its defined key's grammar (§3.4) | write, advisory | warnings: `TITLE_EMPTY`, `LANG_SHAPE`, `REF_SYNTAX`, `SERIES_LENGTH`, `PART_SHAPE`, `PART_WITHOUT_SERIES` |
| A format version the implementation does not have (§5.2) | both | `UNSUPPORTED_FORMAT_VERSION`, carrying the version |
| An empty payload, a malformed envelope, or bytes that are not a brotli stream (§5.2, §5.4) | read | `MALFORMED_PAYLOAD` |
| Call data that is not a `publish()` call, or is cut short (§6.3) | read | `MALFORMED_CALLDATA` |

Invalid UTF-8 in a title or a payload is **not** an error (§3.1, §5.4). An unknown front-matter key
is **not** an error (§3.4).

## 8. Versioning

**What needs a new format version.** Any change that would make an existing reader read an existing
post differently, or fail to read a new one: a change to the reading rules of §4.2, to the
compression of §5.1, to the layout of §6.2. Such a change is a new version `n ≥ 2`, and every payload
written in it begins with the envelope `0x91 n` (§5.2). Version 1 payloads are never rewritten and
never enveloped.

**What does not.** A new defined key, a new advisory rule, a stricter writer, an editorial change:
a new specification revision. Older readers keep working, because unknown keys survive (§3.4).

**A later version SHOULD keep §3 and §4.** The presentation and the document are the part a person
reads and the part an editor opens; a new version is expected to change how the document is carried
(a different compressor, a shared dictionary), not what it is. That keeps every tool that works on
documents — the raw view, `.md` downloads, archives, `xueni verify` — valid across versions.

**Readers and writers across versions.** A reader implementing versions `V` MUST read any payload
whose detected version is in `V` and MUST refuse, naming the version, any other. A writer asked for
a version outside the versions it implements MUST refuse. The reference library exposes
`FORMAT_VERSION` (what it writes by default) and `SUPPORTED_FORMAT_VERSIONS` (what it reads).

## 9. Conformance

A **conforming reader**:

- reads call data per §6.3, the payload per §5.2 and §5.4, and the document per §4.2, exactly;
- never fails on invalid UTF-8, on an unknown key, on a value that does not fit its grammar;
- refuses, with the reason, what §6.3, §5.2 and §5.4 say to refuse, and an unknown version by name;
- gives back, for every vector in Appendix A, the vector's post, document and title.

A **conforming writer**:

- accepts a post only within §3, and reports every problem it finds;
- produces the document of §4.1, the payload of §5.1 (quality 11, no dictionary), the call data of
  §6.2, and the bytes32 of §3.1;
- satisfies the round-trip identities of §3.5 for every post it accepts;
- produces, for every vector in Appendix A, the vector's document and title exactly, and a payload
  that decompresses to that document.

The reference implementation's test suite (`npm test` in this directory) exercises all of the above,
and in addition holds the library to the web application's own modules byte for byte, on fuzzed
input, so that the implementation in use on the chain and this specification cannot drift apart
unnoticed.

---

## Appendix A — test vectors

The full set is [`test/vectors.json`](./test/vectors.json): for each vector the post, the document
(`text`), the title (`title`, the bytes32), the reference payload size (`compressedBytes`) and the
call data the reference implementation produces (`callData`). The document and the title are
normative; the call data pins the reference encoder (§5.3). Two of them, in full:

**Bare Markdown, no metadata.**

```
post      { title: "Just prose", tags: [], markdown: "Just prose.\n\nTwo paragraphs.\n", meta: {} }
document  "Just prose.\n\nTwo paragraphs.\n"                       (the body, exactly)
title     0x4a7573742070726f736500000000000000000000000000000000000000000000
payload   33 bytes
call data 0x70a74532
          4a7573742070726f736500000000000000000000000000000000000000000000
          0000000000000000000000000000000000000000000000000000000000000040
          0000000000000000000000000000000000000000000000000000000000000021
          0b0e804a7573742070726f73652e0a0a54776f20706172616772617068732e0a
          0300000000000000000000000000000000000000000000000000000000000000
```

**The empty post.**

```
post      { title: "", tags: [], markdown: "", meta: {} }
document  ""
title     0x0000000000000000000000000000000000000000000000000000000000000000
payload   1 byte: 0x3b                                                (brotli of nothing)
call data 0x70a74532
          0000000000000000000000000000000000000000000000000000000000000000
          0000000000000000000000000000000000000000000000000000000000000040
          0000000000000000000000000000000000000000000000000000000000000001
          3b00000000000000000000000000000000000000000000000000000000000000
```

The others cover: the specification's own tags example; every defined key plus one unknown key with a
27-byte Chinese title; a title that fills the word exactly (eight emoji) over a CRLF body; a body that
would itself read as front-matter (the empty-block rule); and a reply carrying a multi-byte tag, a
regional language tag and a byte-order mark.

## Appendix B — grammar summary

```
document      = [ front-matter ] body
front-matter  = "---" LF *( entry LF ) "---" LF LF          ; as written by a conforming writer
entry         = key ":" SP value
key           = ALPHA *( ALPHA / DIGIT / "_" / "-" )       ; never "title"; "tags" first, then the
                                                          ; other defined keys in order, then the rest
value         = 1*( any character except CR and LF )       ; trimmed; a "tags" value is tags joined ", "
body          = *OCTET                                      ; the Markdown, byte for byte

post-ref      = [ chain ":" ] "0x" 64HEXDIG [ "/" event-index ]
chain         = 1*( %x61-7A / DIGIT / "-" )
event-index   = "0" / ( %x31-39 *DIGIT )
lang          = 1*8ALPHA *( "-" 1*8( ALPHA / DIGIT ) )    ; advisory: BCP 47
part          = %x31-39 *DIGIT                              ; advisory: a positive integer

payload       = brotli-stream                               ; version 1
              / %x91 version *OCTET                          ; versions 2–255 (reserved)
version       = %x02-FF

call-data     = %x70.A7.45.32 title offset length payload padding
title         = 32OCTET                                      ; UTF-8, right-padded with %x00
offset        = 31%x00 %x40
length        = 32OCTET                                      ; big-endian byte length of payload
padding       = *31%x00                                      ; to a multiple of 32 after the selector
```

The reader's grammar for the front-matter is wider than the writer's (§4.2): any key text before the
first colon, blank lines between entries, CR before LF.

## Appendix C — the reference implementation

`xueni-codec`, in this directory: plain ECMAScript modules with no runtime dependency. The
compressor is an argument — `{ brotli }`, an object with `compress` and `decompress` over
`Uint8Array` — so that the same module runs in a browser (over `brotli-wasm`) and in Node (over
`node:zlib`, bound for you by `xueni-codec/node`).

| Layer | Functions |
| --- | --- |
| Post (§3) | `validatePost`, `postProblems`, `normalisePost`; `parsePostRef`, `formatPostRef` |
| Title (§3.1) | `encodeTitle`, `decodeTitle`, `titleByteLength`, `fitTitle`, `TITLE_MAX_BYTES` |
| Document (§4) | `buildDocument`, `parseDocument`, `splitFrontMatter`, `parseTags`, `FRONT_MATTER_KEYS`, `RESERVED_KEYS` |
| Payload (§5) | `encodePayload`, `decodePayload`, `detectFormatVersion`, `FORMAT_VERSION`, `SUPPORTED_FORMAT_VERSIONS`, `VERSION_ENVELOPE_BYTE`, `REFERENCE_BROTLI` |
| Call data (§6) | `encodePublishCallData`, `decodePublishCallData`, `isPublishCallData`, `PUBLISH_SELECTOR`, `POST_EVENT_TOPIC` |
| The whole trip | `postToCallData`, `callDataToPost`, `encodePost` |
| Errors (§7) | `CodecError`, `InvalidPostError`, `UnsupportedFormatVersionError`, `MalformedPayloadError`, `MalformedCallDataError` |

See [`README.md`](./README.md) for usage.

---

*This specification is plain Markdown, like the documents it describes.*
