// messages.js — every word this tool says, in one place.
//
// The web app is bilingual and its strings live in dictionaries keyed by
// language (webapp/src/lib/locales). THE COMMAND-LINE TOOL IS NOT
// TRANSLATED: a terminal tool is read by whoever is scripting it, its
// output is piped into other programs as often as it is read by a person,
// and an error message that changes with $LANG is a message a script cannot
// match on. So there is one language here, English, and no `t()` — but the
// strings still live together rather than being scattered through the
// commands, so that the tool's voice can be read in one sitting and a
// wording fixed in one place.

import { TITLE_MAX_BYTES } from './shared.js';

const kb = (bytes) => `${Math.ceil(bytes / 1024)} KB`;

/** The site a published post is readable at. */
export const SITE = 'https://xueni.xyz';

export const usage = `xueni — publish, read, export and verify Xueni posts from a terminal.

Usage
  xueni <command> [options]

Commands
  publish <file.md>               publish a Markdown file as a post
  fetch <chain> <txhash>[/<n>]    print one post
  author <chain|all> <address>    list an author's posts, newest first
  export <address> --out <dir>    write an author's posts and an archive bundle
  verify <file.md> <chain> <txhash>[/<n>]
                                  check a file against what the chain holds

Options every command takes
  --rpc <url>        an endpoint to use instead of the chain's defaults.
                     Repeatable and ordered: the first is tried first and the
                     next covers for it. Scope one to a chain with
                     --rpc <chain>=<url>; without a prefix it applies to every
                     chain in play.
  --chain <chain>    ethereum, taiko, or a numeric chain id
  --json             machine-readable output
  --help             this text, or a command's

The signing key is read from the PRIVATE_KEY environment variable and from
nowhere else — never an argument, so it stays out of shell history and out of
the process list.

Run \`xueni <command> --help\` for what that command takes.`;

export const help = {
  publish: `xueni publish <file.md> --chain <chain>

Publish a Markdown file as a post. The title is --title, else the file's
\`title:\` front-matter, else its first heading, else the file name without
its extension; it must fit in ${TITLE_MAX_BYTES} bytes of UTF-8.

Front-matter keys this version knows (tags, lang, re, supersedes, prev,
series, part) are carried on chain; anything else is left behind and named,
rather than being written under a key no reader understands.

Options
  --chain <chain>       the chain to publish on (required)
  --title <text>        the title, overriding the file's
  --tags a,b            tags, overriding the file's
  --image imgN=path     the .webp file behind an \`![](upload:imgN)\` reference
                        in the body. Repeatable. Node has no canvas, so the
                        CLI does not transcode: bring a .webp, or attach the
                        image in the web app, which converts it for you.
  --dry-run             print the payload, its compressed size and a gas
                        estimate, and send nothing
  --json                machine-readable output
  --rpc <url>           endpoint override; repeatable

Example
  PRIVATE_KEY=0x… xueni publish letter.md --chain taiko --tags letters,home`,

  fetch: `xueni fetch <chain> <txhash>[/<n>]

Print one post. <n> is the 0-based ordinal of the Post event within the
transaction (one transaction can publish several); it defaults to 0.

Options
  --raw                 the exact document the chain holds, front-matter and all
  --json                a record with the same field names as an archive post
  --images <dir>        save each \`eth:0x…\` image the body references as
                        <dir>/<txhash>.webp and point the printed Markdown at
                        the saved files
  --rpc <url>           endpoint override; repeatable

Example
  xueni fetch taiko 0x00028c58…fab1e2 --images ./images`,

  author: `xueni author <chain|all> <address>

List an author's posts, newest first, by walking the on-chain list: the
contract's latestBlock(), then each post's prevBlock, one single-block
eth_getLogs per step. Never a range scan, so it costs the same on a chain
with a decade of history as on a new one.

  <chain>               ethereum, taiko, a numeric chain id, or \`all\` to walk
                        every chain and merge them by time

Options
  --limit <n>           stop after n posts (default: walk the whole list)
  --json                machine-readable output
  --rpc <url>           endpoint override; repeatable

Example
  xueni author all 0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5 --limit 10`,

  export: `xueni export <address> --out <dir>

Walk an author's list to its end on every chain and write what it holds:
one .md per post carrying the exact bytes the chain holds, the images those
posts reference, and an archive bundle the web app can import.

  <dir>/<chain>/<yyyy-mm-dd>-<index>-<title>.md
  <dir>/<chain>/images/<txhash>.webp
  <dir>/archive.xueni.json

Options
  --out <dir>           where to write (required); created if it is not there
  --chain <chain|all>   one chain, or \`all\` (the default)
  --json                machine-readable output
  --rpc <url>           endpoint override; repeatable

Example
  xueni export 0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5 --out ./backup`,

  verify: `xueni verify <file.md> <chain> <txhash>[/<n>]

Compare a Markdown file with the document the chain holds, byte for byte
after normalising CRLF line endings to LF. Exit code 0 when they are the
same and nothing is printed but a line saying so; exit code 1 and a unified
diff when they are not — so it drops straight into a script or a CI job.

Options
  --json                machine-readable output
  --rpc <url>           endpoint override; repeatable

Example
  xueni verify letter.md taiko 0x00028c58…fab1e2`,
};

export const msg = {
  // --- Arguments ---
  noCommand: 'no command. Run `xueni --help` for the list.',
  unknownCommand: (name) => `no such command: ${name}. Run \`xueni --help\` for the list.`,
  needsFile: (command) => `${command} needs a file. Run \`xueni ${command} --help\`.`,
  needsChain: (command) => `${command} needs a chain: --chain ethereum, --chain taiko, or a chain id.`,
  needsPost: (command) => `${command} needs a chain and a transaction hash. Run \`xueni ${command} --help\`.`,
  needsAddress: (command) => `${command} needs an author address. Run \`xueni ${command} --help\`.`,
  needsOut: 'export needs somewhere to write: --out <dir>.',
  unknownChain: (value) =>
    `no such chain: ${value}. Known chains are ethereum, taiko, and any chain id the registry lists.`,
  chainNotAll: (command) => `${command} publishes to one chain, so --chain all does not apply.`,
  badAddress: (value) => `not an address: ${value}`,
  badTxHash: (value) => `not a transaction hash: ${value}`,
  badRpc: (value) => `not an endpoint: ${value}`,
  badLimit: (value) => `--limit wants a whole number, not ${value}`,

  // --- Publish ---
  noKey: 'no PRIVATE_KEY in the environment. Export it and try again — it is never taken as an argument.',
  badKey: 'PRIVATE_KEY is not a 32-byte hex private key.',
  noTitle:
    'no title: the file has no `title:` front-matter and no heading, and its name is empty. Pass --title.',
  titleTooLong: (title, bytes, limit) =>
    `the title is ${bytes} bytes of UTF-8 and the chain holds ${limit}: "${title}".\n` +
    'A title is one bytes32 word — 32 ASCII letters, or about 10 Chinese characters. Pass a shorter --title.',
  badImageArg: (value) => `--image wants key=path, as in --image img1=photo.webp, not ${value}`,
  notWebp: (path) =>
    `${path} is not a .webp file. Node has no canvas, so the CLI cannot transcode: convert it first ` +
    '(cwebp, ImageMagick, anything), or attach the image in the web app, which converts as you drop it.',
  imageTooBig: (path, bytes, limit) =>
    `${path} is ${kb(bytes)} and one transaction holds ${kb(limit)}. Re-encode it smaller.`,
  imageUnused: (key) =>
    `nothing in the body references upload:${key}, so it was not sent — an image no reader sees is calldata nobody should pay for.`,
  payloadTooBig: (bytes, limit) =>
    `the compressed payload is ${kb(bytes)} and one transaction holds ${kb(limit)}. Shorten the post, or split it in two.`,
  droppedKeys: (keys) =>
    `front-matter this version does not know, left behind: ${keys.join(', ')}. ` +
    'They would go on chain under a key no reader understands.',
  sendingImage: (key, path, n, total) => `image ${n}/${total} · ${key} · ${path}`,
  sentImage: (key, txHash) => `  ${key} → eth:${txHash}`,
  publishing: (chain) => `publishing on ${chain}…`,
  published: (txHash) => `published in ${txHash}`,
  dryRun: 'nothing was sent (--dry-run).',

  // --- Reading ---
  noSuchTx: (txHash) => `no such transaction: ${txHash}`,
  noPostsInTx: (txHash) => `${txHash} published nothing — it emits no Post event.`,
  noSuchEvent: (txHash, n, total) =>
    `${txHash} published ${total} post${total === 1 ? '' : 's'}, so there is no event ${n}.`,
  notPublishCall: (txHash) => `${txHash} is not a publish() call, so it carries no post to read.`,
  noPosts: (address) => `${address} has published nothing on this chain.`,
  chainFailed: (chain, detail) => `${chain}: ${detail}`,

  // --- Export ---
  wroteArchive: (path, posts, images) =>
    `${path} · ${posts} post${posts === 1 ? '' : 's'}, ${images} image${images === 1 ? '' : 's'}`,
  walkingChain: (chain, address) => `${chain} · walking ${address}…`,
  imageMissing: (txHash, detail) => `image ${txHash} could not be read (${detail}); its reference is left as it is.`,

  // --- Verify ---
  verifyMatch: (path, txHash) => `${path} is exactly what ${txHash} holds.`,
  verifyDiffer: (path, txHash) => `${path} differs from what ${txHash} holds.`,
};
