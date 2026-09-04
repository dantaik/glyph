// publish.js — a Markdown file becoming a post.
//
// The same three steps as the web app's write tab, in the same order and
// producing the same bytes: send each image the body shows as a transaction
// of its own and rewrite the reference to it, build and compress the
// document, then call publish(title, payload). The order matters — images
// first, because the body has to name their transaction hashes before it is
// compressed — and so does measuring the payload against the ceiling before
// any image is paid for, so that a post that could never be sent fails while
// it is still free.
//
// What differs from the browser is the image step. A browser downscales and
// re-encodes whatever is dropped on it, using a canvas; Node has no canvas
// and this package has no dependencies to give it one, so the CLI accepts
// WebP and only WebP, and says where to get one made.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { toHex } from 'viem';
import {
  DEFAULT_GLYPH_ADDRESS,
  FRONT_MATTER_KEYS,
  MAX_CALLDATA_BYTES,
  TITLE_MAX_BYTES,
  abi,
  chainSlug,
  parsePayloadText,
  encodeTitle,
  titleByteLength,
} from '../shared.js';
import { endpointsFor, parseTagsArg, readArgs, readRpcOverrides, resolveChain } from '../args.js';
import { createClient } from '../chain.js';
import { accountFromEnv, createWallet } from '../wallet.js';
import { encodePayload } from '../payload.js';
import { estimateImageGas, estimatePublishGas } from '../gas.js';
import { uploadRefRe, usedImageKeys } from '../images.js';
import { SITE, help, msg } from '../messages.js';
import { fail, note, print, printDoc, printJson } from '../out.js';

export const OPTIONS = {
  title: { type: 'string' },
  tags: { type: 'string' },
  image: { type: 'string', multiple: true },
  'dry-run': { type: 'boolean', default: false },
};

/**
 * A title for this document, by the same rules the web app's `.md` import
 * follows: what was asked for, else the file's own front-matter, else its
 * first heading, else the file name.
 *
 * `title:` is accepted from front-matter as a convenience — every static
 * site generator writes one — but it is NOT a Glyph front-matter key: on
 * chain the title is its own bytes32 argument, so it is read here and
 * written nowhere.
 */
export function titleFor({ asked, meta, markdown, fileName }) {
  if (asked) return String(asked).trim();
  if (meta?.title) return String(meta.title).trim();
  const heading = String(markdown ?? '').match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (heading) return heading[1].trim();
  return basename(String(fileName ?? '')).replace(/\.(md|markdown|txt)$/i, '').trim();
}

/**
 * The front-matter to carry on chain: the keys this version knows, plus
 * whatever `--tags` said. Anything else is named rather than smuggled — a
 * key no reader understands is bytes the author pays for and nobody reads.
 */
export function metaFor(meta, tags) {
  const kept = {};
  const dropped = [];
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (key === 'title') continue; // its own argument, see titleFor
    if (FRONT_MATTER_KEYS.includes(key)) kept[key] = value;
    else dropped.push(key);
  }
  if (tags != null) kept.tags = tags;
  return { meta: kept, dropped: dropped.sort() };
}

/** `--image imgN=path`, read into `{ key, path }` pairs in the order given. */
function readImageArgs(values = []) {
  return values.map((raw) => {
    const value = String(raw);
    const eq = value.indexOf('=');
    if (eq <= 0) fail(msg.badImageArg(raw));
    const key = value.slice(0, eq).trim();
    const path = value.slice(eq + 1).trim();
    if (!key || !path) fail(msg.badImageArg(raw));
    return { key, path };
  });
}

/** The bytes of an image argument, refused unless it is a WebP within the ceiling. */
function readImage({ key, path }) {
  if (!/\.webp$/i.test(path)) fail(msg.notWebp(path));
  let bytes;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch (err) {
    fail(`${path}: ${err.message}`);
  }
  if (bytes.length > MAX_CALLDATA_BYTES) fail(msg.imageTooBig(path, bytes.length, MAX_CALLDATA_BYTES));
  return { key, path, bytes };
}

/**
 * A stand-in transaction hash for a dry run: random, so that brotli cannot
 * compress away what a real hash would cost. The measurement has to be of
 * the document as it will be SENT — `eth:0x…` in place of `upload:imgN` is
 * 60-odd bytes longer and barely compressible — or a draft that just fits
 * here would be refused by the node.
 */
const placeholderHash = () => `0x${randomBytes(32).toString('hex')}`;

export async function run(argv) {
  const { values, positionals } = readArgs(argv, OPTIONS);
  if (values.help) return print(help.publish);

  const file = positionals[0];
  if (!file) fail(msg.needsFile('publish'));
  if (!values.chain) fail(msg.needsChain('publish'));
  const chainId = resolveChain(values.chain, { command: 'publish' });
  const dryRun = values['dry-run'];

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (err) {
    fail(`${file}: ${err.message}`);
  }

  const parsed = parsePayloadText(source);
  const title = titleFor({ asked: values.title, meta: parsed.meta, markdown: parsed.markdown, fileName: file });
  if (!title) fail(msg.noTitle);
  const bytes = titleByteLength(title);
  if (bytes > TITLE_MAX_BYTES) fail(msg.titleTooLong(title, bytes, TITLE_MAX_BYTES));

  const tags = values.tags != null ? parseTagsArg(values.tags) : null;
  const { meta, dropped } = metaFor(parsed.meta, tags);
  if (dropped.length) note(msg.droppedKeys(dropped));

  // Images the body does not show are not sent: an attachment no reader ever
  // sees is calldata nobody should pay for.
  const asked = readImageArgs(values.image).map(readImage);
  const shown = new Set(usedImageKeys(parsed.markdown, asked.map((i) => i.key)));
  for (const image of asked) if (!shown.has(image.key)) note(msg.imageUnused(image.key));
  const images = asked.filter((i) => shown.has(i.key));

  if (dryRun) {
    // Measure the document as it would be sent, with each image reference
    // already rewritten — see placeholderHash.
    let markdown = parsed.markdown;
    for (const { key } of images) markdown = markdown.replace(uploadRefRe(key, 'g'), `$1eth:${placeholderHash()}`);
    const { text, bytes: payload } = encodePayload({ markdown, meta });
    if (payload.length > MAX_CALLDATA_BYTES) fail(msg.payloadTooBig(payload.length, MAX_CALLDATA_BYTES));
    const gas = estimatePublishGas(payload.length);
    const imageGas = images.map(({ key, path, bytes: b }) => ({
      key,
      path,
      bytes: b.length,
      estimatedGas: estimateImageGas(b.length),
    }));
    if (values.json) {
      printJson({
        dryRun: true,
        chainId,
        chain: chainSlug(chainId),
        title,
        text,
        compressedBytes: payload.length,
        limit: MAX_CALLDATA_BYTES,
        estimatedGas: gas,
        images: imageGas,
      });
      return;
    }
    printDoc(text.endsWith('\n') ? text : `${text}\n`);
    note('');
    note(`title: ${title} (${bytes}/${TITLE_MAX_BYTES} bytes)`);
    note(`payload: ${payload.length} bytes compressed, of ${MAX_CALLDATA_BYTES} a transaction holds`);
    note(`estimated gas: ${gas} (about ${estimatePublishGas(payload.length, true) - gas} more for a first post)`);
    for (const image of imageGas) {
      note(`image ${image.key}: ${image.bytes} bytes, estimated gas ${image.estimatedGas}`);
    }
    note(msg.dryRun);
    return;
  }

  const account = accountFromEnv();
  const urls = endpointsFor(chainId, readRpcOverrides(values.rpc));
  const wallet = createWallet(chainId, urls, account);
  const client = createClient(chainId, urls);

  // Each image is its own transaction, and each is waited for: the next
  // transaction's nonce is read from the node, so sending two at once is a
  // race with nothing to gain.
  let markdown = parsed.markdown;
  const sent = [];
  let i = 0;
  for (const image of images) {
    i += 1;
    note(msg.sendingImage(image.key, image.path, i, images.length));
    const hash = await wallet.sendTransaction({
      to: account.address,
      data: toHex(image.bytes),
      value: 0n,
    });
    await client.waitForTransactionReceipt({ hash });
    note(msg.sentImage(image.key, hash));
    markdown = markdown.replace(uploadRefRe(image.key, 'g'), `$1eth:${hash}`);
    sent.push({ key: image.key, path: image.path, txHash: hash, bytes: image.bytes.length });
  }

  const { text, bytes: payload } = encodePayload({ markdown, meta });
  if (payload.length > MAX_CALLDATA_BYTES) fail(msg.payloadTooBig(payload.length, MAX_CALLDATA_BYTES));

  note(msg.publishing(chainSlug(chainId)));
  const txHash = await wallet.writeContract({
    address: DEFAULT_GLYPH_ADDRESS,
    abi,
    functionName: 'publish',
    args: [encodeTitle(title), toHex(payload)],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  const url = `${SITE}/${chainSlug(chainId)}/tx/${txHash}/0`;

  if (values.json) {
    printJson({
      chainId,
      chain: chainSlug(chainId),
      txHash,
      block: Number(receipt.blockNumber),
      title,
      text,
      compressedBytes: payload.length,
      images: sent,
      url,
    });
    return;
  }
  note(msg.published(txHash));
  print(txHash);
  print(url);
}
