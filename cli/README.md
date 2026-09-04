# `xueni` — the command line

Publish, read, export and verify [Xueni](../README.md) posts from a terminal:
for scripting and for bulk work — ten documents published in order, a nightly
backup of an author, a CI job that checks a directory of `.md` files still
matches what the chain holds.

It is the same journal the web app reads and writes, not a second one. **The
payload layer is shared code, not a reimplementation**: `cli/src/shared.js`
imports `payloadText.js`, `title.js`, `abi.js`, `chains.js` and `limits.js`
straight out of `webapp/src/lib/`, so a post published here is byte for byte
the post the browser would have written — same front-matter order, same brotli
output, same 32-byte title encoding, same size ceilings. The only thing this
package does not share is the wallet: a browser keeps the key in an extension,
a terminal has to hold it itself.

## Install

Node 22 or newer, and nothing else — `viem` is the one dependency, and brotli,
argument parsing and the test runner all come from Node itself.

```bash
cd cli && npm install
node bin/xueni.js --help
```

To have it on your path as `xueni`:

```bash
cd cli && npm link      # or: npm install -g .
xueni --help
```

The repository's `webapp/` directory has to be beside `cli/` — that is where
the shared modules live. `npm install` in `webapp/` is not needed to run the
tool, only to run this package's tests (they borrow the web app's mock node).

## The options every command takes

| Option | What it does |
| --- | --- |
| `--rpc <url>` | An endpoint to use instead of the chain's defaults. Repeatable and **ordered**: the first is tried first, the next covers for it. `--rpc <chain>=<url>` scopes one to a chain, which is what `--chain all` needs; without a prefix it applies to every chain in play. |
| `--chain <chain>` | `ethereum`, `taiko`, or a numeric chain id. `all` where reading several chains makes sense. |
| `--json` | Machine-readable output on stdout. |
| `--help` | The command's own help. |

**`PRIVATE_KEY` comes from the environment and from nowhere else.** There is
no `--key` and there never will be: an argument lands in shell history and in
the process list, where any other process on the machine can read it, and a
signing key that leaks once has to be abandoned along with the identity built
on it. Reading commands need no key at all.

Stdout carries the answer and stderr carries everything else — progress,
warnings, errors — so `xueni fetch … > letter.md` writes a file with nothing
in it but the letter, even while the terminal shows what is happening.
Failures exit 1.

## `xueni publish <file.md> --chain <chain>`

Publish a Markdown file as a post.

The title is `--title`, else the file's `title:` front-matter, else its first
heading, else the file name without its extension — the same rules the web
app's "Import .md…" follows. It must fit in 32 bytes of UTF-8 (32 ASCII
letters, or about ten Chinese characters); a longer one is refused rather than
cut, because a title silently truncated is a title nobody meant.

Front-matter keys this version knows — `tags`, `lang`, `re`, `supersedes`,
`prev`, `series`, `part` — are carried on chain. Anything else is named on
stderr and left behind rather than written under a key no reader understands.

| Option | What it does |
| --- | --- |
| `--chain <chain>` | The chain to publish on. Required; `all` does not apply. |
| `--title <text>` | The title, overriding the file's. |
| `--tags a,b` | Tags, overriding the file's. |
| `--image imgN=path` | The `.webp` file behind an `![](upload:imgN)` reference in the body. Repeatable. |
| `--dry-run` | Print the payload, its compressed size and a gas estimate. Send nothing. |

**Images.** Each image becomes a transaction of its own — the WebP bytes as a
plain self-transfer's calldata — and the reference in the body is rewritten
from `upload:imgN` to `eth:0x<txhash>`, which any reader can resolve from the
chain alone. Node has no canvas, so **the CLI does not transcode**: bring a
`.webp` (`cwebp -q 60 photo.jpg -o photo.webp`), or attach the image in the
web app, which converts as you drop it. An image the body never references is
not sent — calldata no reader ever sees is calldata nobody should pay for.

A dry run needs no key, no endpoint and no network:

```console
$ xueni publish letter.md --chain taiko --tags letters,home --dry-run
---
tags: letters, home
---

Xiaoman,

The north wind is rattling the window paper tonight…

title: A letter before the solstice (28/32 bytes)
payload: 409 bytes compressed, of 130048 a transaction holds
estimated gas: 41603 (about 24000 more for a first post)
nothing was sent (--dry-run).
```

And the real thing:

```console
$ PRIVATE_KEY=0x… xueni publish letter.md --chain taiko --tags letters,home
publishing on taiko…
published in 0x9f2c…
0x9f2c…
https://xueni.xyz/taiko/tx/0x9f2c…/0
```

## `xueni fetch <chain> <txhash>[/<n>]`

Print one post. `<n>` is the 0-based ordinal of the `Post` event within the
transaction — one transaction can publish several — and defaults to 0.

| Option | What it does |
| --- | --- |
| `--raw` | The exact document the chain holds, front-matter and all. |
| `--json` | A record with the same field names as an archive post. |
| `--images <dir>` | Save each `eth:0x…` image the body references as `<dir>/<txhash>.webp`, and point the printed Markdown at the saved files. |

The document is written verbatim, with no newline added, so
`xueni fetch … --raw > letter.md` produces a file that `xueni verify` then
confirms.

```console
$ xueni fetch taiko 0x00028c58…fab1e2 --raw > letter.md
$ xueni fetch taiko 0x00028c58…fab1e2 --json | jq .compressedBytes
409
```

## `xueni author <chain|all> <address>`

List an author's posts, newest first. `all` walks every chain the app reads
and merges them by block time.

| Option | What it does |
| --- | --- |
| `--limit <n>` | Stop after n posts. The default is to walk the whole list. |

The walk is the point: the contract keeps a reverse block-linked list per
author, so this asks `latestBlock()` for the head and then follows `prevBlock`
down, **one single-block `eth_getLogs` per step**. Never a range scan — which
is why it costs the same on a chain with a decade behind it as on a new one,
and why it works against endpoints that refuse wide log queries.

```console
$ xueni author all 0x8a1f…F4a5 --limit 2
#4  A letter before the solstice
    ethereum · block 25945650 · 2026-09-04 · 0x000000018a1f…fab1e4
#2  The drums
    taiko · block 11441505 · 2026-09-04 · 0x00028c588a1f…fab1e2
```

## `xueni export <address> --out <dir>`

Walk an author's list to its very end on every chain and write what it holds.

| Option | What it does |
| --- | --- |
| `--out <dir>` | Where to write. Required; created if it is not there. |
| `--chain <chain\|all>` | One chain, or `all` (the default). |

```
<dir>/<chain>/<yyyy-mm-dd>-<index>-<title>.md    the exact stored text
<dir>/<chain>/images/<txhash>.webp               the images those posts show
<dir>/archive.xueni.json                         the bundle
```

The bundle is the part that matters years from now. History expiry
(EIP-4444) means a node will one day no longer serve the transaction that
holds a post, and at that point the only readable copy is one somebody took.
It is the same format the web app exports and imports — `/settings` →
"Import an archive…" — with `scope.kind` of `author` and each walked list
marked `complete: true`, which is what lets an importing browser claim the
whole author rather than re-scan for the rest.

```console
$ xueni export 0x8a1f…F4a5 --out ./backup
Ethereum · walking 0x8a1f…f4a5…
Taiko · walking 0x8a1f…f4a5…
ethereum · 5 posts, 0 images
taiko · 3 posts, 0 images
backup/archive.xueni.json · 8 posts, 0 images
```

## `xueni verify <file.md> <chain> <txhash>[/<n>]`

Compare a Markdown file with the document the chain holds, byte for byte
after normalising CRLF line endings to LF. Exit 0 and a line saying so when
they match; exit 1 and a unified diff when they do not — so it drops straight
into a script or a CI job.

One normalisation and only one: an editor on Windows rewrites every line
ending in a file it saves, and that is not a change to the letter. A changed
word is, and so is a lost trailing newline.

```console
$ xueni verify backup/ethereum/2026-09-04-4-a-letter-before-the-solstice.md ethereum 0x00000001…fab1e4
backup/ethereum/2026-09-04-4-a-letter-before-the-solstice.md is exactly what 0x00000001…fab1e4 holds.

$ xueni verify letter.md ethereum 0x00000001…fab1e4 || echo "letter.md has been edited"
--- 0x00000001…fab1e4 (chain)
+++ letter.md
@@ -4,7 +4,7 @@
 
 Xiaoman,
 
-The north wind is rattling the window paper tonight…
+The south wind is rattling the window paper tonight…
letter.md differs from what 0x00000001…fab1e4 holds.
letter.md has been edited
```

## Tests

```bash
cd cli && npm test
```

The web app's end-to-end mock node is this package's test chain:
`webapp/test/e2e/rpcServer.mjs` serves the demo worlds as a real JSON-RPC
endpoint and publishes an oracle saying what the answers should be, so the CLI
is checked against exactly the chain the browser tests are checked against.
The tests start it themselves on a free port; they do need `webapp/`'s
dependencies installed (`cd webapp && npm ci`).

Two things the suite deliberately does or does not do:

- **`test/shared.test.js` imports each borrowed webapp module in a bare Node
  process.** If a future change gives one of them an `import.meta.env`, a
  `window` or a React import, it fails there — loudly, next to the code that
  depends on it — rather than at somebody's terminal months later.
- **The sending path is not tested.** The mock node answers reads and does not
  accept transactions, so `publish` is exercised only through `--dry-run`,
  which does assert that the compressed bytes are exactly what
  `brotliCompressSync` at quality 11 gives for the same document. Run the
  sending path against a local Anvil (`anvil` in one terminal,
  `--rpc http://127.0.0.1:8545` here) before trusting a change to it.
