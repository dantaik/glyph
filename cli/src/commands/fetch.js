// fetch.js — one post, out of the chain and onto stdout.
//
// Three shapes of the same thing, because three different readers want it:
// the Markdown (a person, or a renderer downstream), the exact stored
// document with its front-matter (`--raw` — what the chain holds, byte for
// byte, and what `verify` compares against), and a record with an archive
// post's field names (`--json` — a script, or a bundle being assembled by
// hand).
//
// `--images` is the one place where the printed Markdown is not what the
// chain holds: an `eth:0x…` reference means nothing to a Markdown renderer
// on a laptop, so the bytes are saved as files and the references are
// pointed at them. `--raw` and `--json` are never rewritten — their whole
// purpose is to be exact.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archivePost } from '../archive.js';
import { parsePostArg, readArgs, readRpcOverrides, resolveChain } from '../args.js';
import { onChain } from '../chain.js';
import { imageRefs, rewriteImageRefs } from '../images.js';
import { help, msg } from '../messages.js';
import { errorText, fail, note, print, printDoc, printJson } from '../out.js';
import { readPost, readersFor } from '../walk.js';

export const OPTIONS = {
  raw: { type: 'boolean', default: false },
  images: { type: 'string' },
};

/**
 * Save every image the body references into `dir`, named by the transaction
 * that holds it — the only name it has, and a stable one, since the same
 * image referenced from two posts is the same transaction and so the same
 * file. Returns a lookup from transaction hash to the path written.
 *
 * An image the node will not serve is reported and left out; the reference
 * to it stays as it was, so the document still says what it pointed at.
 */
export async function saveImages(reader, markdown, dir) {
  const hashes = imageRefs(markdown);
  if (hashes.length === 0) return new Map();
  mkdirSync(dir, { recursive: true });
  const saved = new Map();
  for (const txHash of hashes) {
    try {
      const bytes = await reader.imageBytes(txHash);
      const path = join(dir, `${txHash}.webp`);
      writeFileSync(path, bytes);
      saved.set(txHash, path);
    } catch (err) {
      note(msg.imageMissing(txHash, errorText(err)));
    }
  }
  return saved;
}

export async function run(argv) {
  const { values, positionals } = readArgs(argv, OPTIONS);
  if (values.help) return print(help.fetch);

  const [chainArg, postArg] = positionals;
  const chain = chainArg ?? values.chain;
  if (!chain || !postArg) fail(msg.needsPost('fetch'));
  const chainId = resolveChain(chain, { command: 'fetch' });
  const post = parsePostArg(postArg);

  const [reader] = readersFor(chainId, readRpcOverrides(values.rpc));
  const { row, body } = await onChain(reader.name, () => readPost(reader, post));

  if (values.json) {
    if (values.images) await saveImages(reader, body.markdown, values.images);
    return printJson(archivePost({ chainId, row, body }));
  }
  if (values.raw) {
    if (values.images) await saveImages(reader, body.markdown, values.images);
    return printDoc(body.text);
  }

  let markdown = body.markdown;
  if (values.images) {
    const saved = await saveImages(reader, markdown, values.images);
    markdown = rewriteImageRefs(markdown, (hash) => saved.get(hash) ?? null);
    for (const path of saved.values()) note(path);
  }
  printDoc(markdown);
}
