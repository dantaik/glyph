// archive.js — everything this browser has read, as one file.
//
// The spec's third layer of permanence (§9) is "your own backup", and until
// now that was advice rather than a feature. This is the feature: one plain
// JSON document holding the exact stored text of every post, the images
// those posts refer to, and a note of which author lists were walked to
// their end — enough to read that work with no node at all.
//
// It is the practical answer to history expiry (EIP-4444). A reader years
// from now, whose public endpoints no longer serve calldata from 2026, opens
// a bundle instead of running an archive node. And because the command-line
// tool writes the same format (cli/src/archive.js), a backup taken at a
// terminal seeds a browser and the other way round.
//
// Deliberately NOT the app: a bundle is data, readable by anything that can
// read JSON, and carries no code.

import { base64ToBytes, bytesToBase64 } from './base64';
import { getCachedBody, setCachedBody, setCachedImage } from './cache';
import { GLYPH_ADDRESS } from './config';
import { t } from './i18n';
import { isKnownChain } from './chains';
import { chainName } from './format';
import { parsePayloadText } from './payloadText';
import { ADDRESS_RE } from './router';

/** The format version, as `glyph.archive`. Bumping it is breaking the file. */
export const ARCHIVE_FORMAT = 1;

/** Every image on chain is WebP: the writers only ever produce that. */
export const IMAGE_MIME = 'image/webp';

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const lower = (s) => String(s ?? '').toLowerCase();
const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

/** The name a bundle is offered under. */
export const archiveFileName = (scope, now = new Date()) => {
  const day = now.toISOString().slice(0, 10);
  const who = scope?.kind === 'author' ? `-${lower(scope.address).slice(2, 10)}` : '';
  return `glyph-archive${who}-${day}.xueni.json`;
};

// --- Collecting -----------------------------------------------------------

/** A post as the bundle carries it: the row, plus the document itself. */
const postRecord = (chainId, row, text, compressedBytes) => ({
  chainId: Number(chainId),
  txHash: lower(row.txHash),
  eventIndex: num(row.eventIndex),
  author: lower(row.author),
  index: num(row.index),
  block: num(row.block),
  prevBlock: num(row.prevBlock),
  logIndex: row.logIndex == null ? null : num(row.logIndex),
  ts: row.ts == null ? null : num(row.ts),
  title: row.title ?? '',
  text,
  compressedBytes: num(compressedBytes),
});

/**
 * Read the text and images of `rows` on one chain into a bundle's parts.
 *
 * Sequential on purpose. Almost everything here is already in the local
 * cache — this is a backup of what has been READ — and the few that are not
 * would otherwise arrive as a burst that a public node rate-limits.
 */
async function collectRows(reader, rows, onProgress, done, total) {
  const posts = [];
  const images = new Map(); // txHash -> Uint8Array
  let seen = done;
  for (const row of rows) {
    try {
      const body = await reader.loadPostText(row.txHash);
      posts.push(postRecord(reader.chainId, row, body.text, body.compressedBytes));
      for (const hash of reader.imageRefsIn(body.markdown)) {
        if (images.has(hash)) continue;
        try {
          images.set(hash, await reader.loadImageBytes(hash));
        } catch {
          // An image the node will not serve is left out rather than
          // failing the whole bundle: the post still reads, with alt text.
        }
      }
    } catch {
      // Same for a body: what could be read is worth keeping.
    }
    seen += 1;
    onProgress?.({ done: seen, total });
  }
  return { posts, images };
}

const imageRecords = (chainId, images) =>
  [...images].map(([txHash, bytes]) => ({
    chainId: Number(chainId),
    txHash: lower(txHash),
    mime: IMAGE_MIME,
    base64: bytesToBase64(bytes),
  }));

/** Everything this browser has read, across every chain of the view. */
export async function collectBrowserArchive(readers, { onProgress = null, now = new Date() } = {}) {
  const perChain = readers.map((reader) => ({ reader, rows: reader.store.allPosts() }));
  const total = perChain.reduce((n, c) => n + c.rows.length, 0);
  const posts = [];
  const images = [];
  let done = 0;
  for (const { reader, rows } of perChain) {
    const part = await collectRows(reader, rows, onProgress, done, total);
    done += rows.length;
    posts.push(...part.posts);
    images.push(...imageRecords(reader.chainId, part.images));
  }
  return build({ scope: { kind: 'browser' }, posts, images, authors: [], now });
}

/**
 * One author's complete output.
 *
 * "Complete" is the point: the walk is driven to the author's first post on
 * every chain first, so the bundle can say `complete: true` and an importing
 * browser can show that author's page with no reads at all. Without that it
 * would only be a sample, and the importer would have to keep scanning.
 */
export async function collectAuthorArchive(view, author, { onProgress = null, now = new Date() } = {}) {
  const list = view.authorList(author);
  await list.refresh();
  onProgress?.({ phase: 'walking' });
  // Walk to the beginning. `hasMore` false means every chain reached index 0.
  let guard = 0;
  while (list.getSnapshot().hasMore && guard < 500) {
    await list.loadMore();
    guard += 1;
    onProgress?.({ phase: 'walking', done: list.getSnapshot().rows.length });
  }

  const rows = list.getSnapshot().rows;
  const total = rows.length;
  const posts = [];
  const images = [];
  const authors = [];
  let done = 0;
  for (const reader of view.readers) {
    const mine = rows.filter((r) => r.chainId === reader.chainId);
    const part = await collectRows(
      reader,
      mine,
      (p) => onProgress?.({ phase: 'bodies', ...p }),
      done,
      total,
    );
    done += mine.length;
    posts.push(...part.posts);
    images.push(...imageRecords(reader.chainId, part.images));
    authors.push({
      chainId: reader.chainId,
      address: lower(author),
      head: mine.length ? Math.max(...mine.map((r) => num(r.block))) : 0,
      // Nothing left to walk on any chain, so this chain's part is whole.
      complete: !list.getSnapshot().hasMore,
    });
  }
  return build({ scope: { kind: 'author', address: lower(author) }, posts, images, authors, now });
}

function build({ scope, posts, images, authors, now }) {
  return {
    glyph: { archive: ARCHIVE_FORMAT },
    exportedAt: now.toISOString(),
    contract: GLYPH_ADDRESS,
    scope,
    posts,
    images,
    authors,
  };
}

export const serializeArchive = (doc) => JSON.stringify(doc, null, 2);

// --- Reading one back -----------------------------------------------------

const isPost = (p) =>
  p &&
  typeof p === 'object' &&
  Number.isFinite(Number(p.chainId)) &&
  TX_RE.test(String(p.txHash ?? '')) &&
  ADDRESS_RE.test(String(p.author ?? '')) &&
  typeof p.text === 'string';

const isImage = (i) =>
  i && typeof i === 'object' && TX_RE.test(String(i.txHash ?? '')) && typeof i.base64 === 'string';

/**
 * Read a bundle and say what is in it, without applying anything.
 *
 * Same shape of answer as the settings importer: what would happen, what is
 * wrong with the file, and the part that can still be used. A file that is
 * half broken is worth importing the good half of.
 */
export function parseArchive(text) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { doc: null, problems: [t('archive.notJson')], summary: [] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { doc: null, problems: [t('archive.notArchive')], summary: [] };
  }
  const version = raw.glyph?.archive;
  if (version == null) return { doc: null, problems: [t('archive.notArchive')], summary: [] };
  if (Number(version) !== ARCHIVE_FORMAT) {
    return { doc: null, problems: [t('archive.wrongVersion', { version })], summary: [] };
  }
  // A bundle from another deployment describes a different journal, and
  // merging the two silently would be worse than refusing.
  if (raw.contract && lower(raw.contract) !== lower(GLYPH_ADDRESS)) {
    return { doc: null, problems: [t('archive.wrongContract', { contract: raw.contract })], summary: [] };
  }

  const known = (chainId) => isKnownChain(chainId);
  const allPosts = Array.isArray(raw.posts) ? raw.posts : [];
  const posts = allPosts.filter((p) => isPost(p) && known(p.chainId));
  if (posts.length < allPosts.length) {
    problems.push(t('archive.droppedPosts', { count: allPosts.length - posts.length }));
  }
  const allImages = Array.isArray(raw.images) ? raw.images : [];
  const images = allImages.filter((i) => isImage(i) && known(i.chainId));
  if (images.length < allImages.length) {
    problems.push(t('archive.droppedImages', { count: allImages.length - images.length }));
  }
  const authors = (Array.isArray(raw.authors) ? raw.authors : []).filter(
    (a) => a && ADDRESS_RE.test(String(a.address ?? '')) && known(a.chainId),
  );

  if (posts.length === 0) problems.push(t('archive.empty'));

  const summary = [];
  for (const chainId of [...new Set(posts.map((p) => Number(p.chainId)))].sort((a, b) => a - b)) {
    summary.push(
      t('archive.chainLine', {
        chain: chainName(chainId),
        posts: posts.filter((p) => Number(p.chainId) === chainId).length,
        images: images.filter((i) => Number(i.chainId) === chainId).length,
      }),
    );
  }
  const whole = authors.filter((a) => a.complete);
  if (whole.length > 0) summary.push(t('archive.completeAuthors', { count: whole.length }));

  return {
    doc: { ...raw, glyph: { archive: ARCHIVE_FORMAT }, posts, images, authors },
    problems,
    summary,
  };
}

/**
 * Put a bundle into this browser.
 *
 * Nothing already here is overwritten: what a post says is fixed by the
 * transaction that carries it, so a record that exists is already right and
 * a second copy could only be wrong.
 *
 * Coverage is claimed narrowly and honestly. Every row proves its own block
 * for its own author, and an author marked `complete` proves that author's
 * whole list. Nothing here proves anything about the FEED, which is a claim
 * about every author at once — so the home feed goes on scanning exactly as
 * it did, and only the pages the bundle really covers become free.
 */
export async function applyArchive(doc, readers) {
  const byChain = new Map(readers.map((r) => [r.chainId, r]));
  let written = 0;
  let skipped = 0;
  let imagesWritten = 0;

  for (const post of doc.posts) {
    const reader = byChain.get(Number(post.chainId));
    if (!reader) {
      skipped += 1;
      continue;
    }
    const existing = await getCachedBody(reader.chainId, lower(post.txHash));
    if (existing?.text != null) {
      skipped += 1;
    } else {
      // The bundle carries the DECOMPRESSED document, so nothing has to be
      // decoded here: the cache record is the same shape chainIO produces.
      const { meta, tags, markdown } = parsePayloadText(post.text);
      await setCachedBody(reader.chainId, lower(post.txHash), {
        meta,
        tags,
        markdown,
        text: post.text,
        compressedBytes: num(post.compressedBytes),
      });
      written += 1;
    }
    reader.store.rememberPosts([
      {
        author: post.author,
        index: post.index,
        block: post.block,
        prevBlock: post.prevBlock ?? 0,
        title: post.title ?? '',
        txHash: lower(post.txHash),
        eventIndex: post.eventIndex ?? 0,
        logIndex: post.logIndex,
        ts: post.ts,
      },
    ]);
    // This row proves its own block for its own author, and nothing else.
    reader.store.rememberAuthorBlock(post.author, post.block);
  }

  for (const image of doc.images) {
    const reader = byChain.get(Number(image.chainId));
    if (!reader) continue;
    const bytes = base64ToBytes(image.base64);
    if (!bytes) continue;
    await setCachedImage(reader.chainId, lower(image.txHash), bytes.buffer);
    imagesWritten += 1;
  }

  // An author walked to their first post: their page needs no node at all.
  for (const author of doc.authors) {
    if (!author.complete) continue;
    const reader = byChain.get(Number(author.chainId));
    if (!reader) continue;
    reader.store.setAuthorScanHead(author.address, author.head ?? 0);
  }

  for (const reader of byChain.values()) {
    reader.store.persistFeedScan();
    for (const author of new Set(doc.posts.map((p) => lower(p.author)))) {
      reader.store.persistAuthorScan(author);
    }
    // What the posts SAY, so tags and search cover them straight away.
    await reader.index.warm({ force: true });
  }

  return { posts: written, skipped, images: imagesWritten };
}
