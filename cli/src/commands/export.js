// export.js — one author, complete, on disk.
//
// A backup that outlives the chain being readable. It walks the author's
// list to its very end on every chain, writes each post as the `.md` the
// chain holds (front-matter and all — the exact bytes, so that `verify` can
// confirm the file later), saves the images those posts reference, and
// writes an archive bundle in the format the web app imports.
//
// The bundle is the part that matters years from now: history expiry
// (EIP-4444) means a node will one day no longer serve the transaction that
// holds a post, and at that point the only readable copy is one somebody
// took. `authors[].complete` is what makes it a backup rather than a sample
// — it says this list was walked to index 0, so an importing browser can
// claim the whole author rather than re-scan for the rest.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveImage, archivePost, buildArchive } from '../archive.js';
import { parseAddressArg, readArgs, readRpcOverrides, resolveChain } from '../args.js';
import { onChain } from '../chain.js';
import { imageRefs } from '../images.js';
import { help, msg } from '../messages.js';
import { DEFAULT_GLYPH_ADDRESS } from '../shared.js';
import { errorText, fail, note, print, printJson } from '../out.js';
import { readersFor } from '../walk.js';

export const OPTIONS = {
  out: { type: 'string' },
};

/** What the bundle is always called, so a reader knows one on sight. */
export const ARCHIVE_NAME = 'archive.xueni.json';

/**
 * A readable form of a title for a file name. Letters and digits in ANY
 * script survive — a Chinese title stays Chinese rather than becoming a row
 * of dashes — which is the same rule the web app's `.md` download follows.
 */
export function titleSlug(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * `<yyyy-mm-dd>-<index>-<title>.md`. The index is in the name on purpose:
 * it is the post's identity within its author's list, it sorts the directory
 * the way the list reads, and it keeps two posts written on one day with the
 * same title from becoming one file.
 */
export function postFileName(row) {
  const date = row.ts == null ? 'undated' : new Date(Number(row.ts) * 1000).toISOString().slice(0, 10);
  const slug = titleSlug(row.title) || String(row.txHash).slice(2, 10);
  return `${date}-${row.index}-${slug}.md`;
}

export async function run(argv) {
  const { values, positionals } = readArgs(argv, OPTIONS);
  if (values.help) return print(help.export);

  if (!positionals[0]) fail(msg.needsAddress('export'));
  const address = parseAddressArg(positionals[0]);
  if (!values.out) fail(msg.needsOut);
  const out = values.out;
  const selection = resolveChain(values.chain ?? 'all', { allowAll: true, command: 'export' });

  const readers = readersFor(selection, readRpcOverrides(values.rpc));
  const posts = [];
  const images = [];
  const authors = [];
  const perChain = [];

  for (const reader of readers) {
    note(msg.walkingChain(reader.name, address));
    const dir = join(out, reader.slug);
    const { rows, head, complete } = await onChain(reader.name, () => reader.walkAuthor(address));
    if (rows.length === 0) {
      // An author with nothing on this chain gets no directory and no
      // `authors` entry: an entry with a head of zero would tell an importing
      // browser it has walked a list that does not exist.
      perChain.push({ chainId: reader.chainId, chain: reader.slug, posts: 0, images: 0, head: 0, complete: true });
      continue;
    }
    mkdirSync(dir, { recursive: true });

    // The same image referenced from two posts is one transaction and so one
    // file — saved once, and once in the bundle.
    const seenImages = new Set();
    let saved = 0;
    for (const row of rows) {
      const body = await onChain(reader.name, () => reader.postBody(row.txHash));
      writeFileSync(join(dir, postFileName(row)), body.text, 'utf8');
      posts.push(archivePost({ chainId: reader.chainId, row, body }));
      for (const txHash of imageRefs(body.markdown)) {
        if (seenImages.has(txHash)) continue;
        seenImages.add(txHash);
        try {
          const bytes = await reader.imageBytes(txHash);
          mkdirSync(join(dir, 'images'), { recursive: true });
          writeFileSync(join(dir, 'images', `${txHash}.webp`), bytes);
          images.push(archiveImage({ chainId: reader.chainId, txHash, bytes }));
          saved += 1;
        } catch (err) {
          note(msg.imageMissing(txHash, errorText(err)));
        }
      }
    }
    authors.push({
      chainId: reader.chainId,
      address: rows[0].author,
      head: Number(head),
      complete,
    });
    perChain.push({
      chainId: reader.chainId,
      chain: reader.slug,
      posts: rows.length,
      images: saved,
      head: Number(head),
      complete,
    });
  }

  const doc = buildArchive({
    contract: DEFAULT_GLYPH_ADDRESS,
    scope: { kind: 'author', address: authors[0]?.address ?? address },
    posts,
    images,
    authors,
  });
  mkdirSync(out, { recursive: true });
  const archivePath = join(out, ARCHIVE_NAME);
  writeFileSync(archivePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  if (values.json) {
    return printJson({
      out,
      archive: archivePath,
      address: doc.scope.address,
      posts: posts.length,
      images: images.length,
      chains: perChain,
    });
  }
  for (const chain of perChain) {
    print(`${chain.chain} · ${chain.posts} post${chain.posts === 1 ? '' : 's'}, ${chain.images} image${chain.images === 1 ? '' : 's'}`);
  }
  print(msg.wroteArchive(archivePath, posts.length, images.length));
}
