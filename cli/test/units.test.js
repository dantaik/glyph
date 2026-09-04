// units.test.js — the pure pieces, checked directly.
//
// Three of these cannot be reached through the mock node: the demo bodies
// carry `data:` image URIs rather than on-chain `eth:0x…` references, so the
// image path has no fixture to exercise it end to end, and the diff and the
// argument grammar are pure functions that deserve to be pinned down where
// their edges are, not through a process boundary.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointsFor, parsePostArg, parseLimit, readRpcOverrides } from '../src/args.js';
import { archiveImage, buildArchive, bytesToBase64 } from '../src/archive.js';
import { unifiedDiff } from '../src/diff.js';
import { imageRefs, rewriteImageRefs, uploadRefRe, usedImageKeys } from '../src/images.js';
import { compressText, decompressBytes, encodePayload } from '../src/payload.js';
import { defaultRpcs } from '../src/shared.js';

const HASH_A = `0x${'a1'.repeat(32)}`;
const HASH_B = `0x${'b2'.repeat(32)}`;

describe('image references', () => {
  test('finds every on-chain reference once, in the order they appear', () => {
    const body = `![one](eth:${HASH_A})\n\ntext\n\n![two](eth:${HASH_B})\n\n![again](eth:${HASH_A})`;
    assert.deepEqual(imageRefs(body), [HASH_A, HASH_B]);
  });

  test('ignores links that are not images and hashes that are not hashes', () => {
    assert.deepEqual(imageRefs(`[a link](eth:${HASH_A})`), []);
    assert.deepEqual(imageRefs('![short](eth:0xdead)'), []);
    assert.deepEqual(imageRefs('![data](data:image/png;base64,AAAA)'), []);
  });

  test('rewrites references to saved files and leaves the rest alone', () => {
    const body = `![one](eth:${HASH_A})\n![two](eth:${HASH_B})`;
    const out = rewriteImageRefs(body, (hash) => (hash === HASH_A ? 'images/one.webp' : null));
    assert.equal(out, `![one](images/one.webp)\n![two](eth:${HASH_B})`);
  });

  test('an upload key matches only its own image reference', () => {
    const body = '![a](upload:img1) and ![b](upload:img10) and [not an image](upload:img1)';
    assert.deepEqual(usedImageKeys(body, ['img1', 'img10', 'img2']), ['img1', 'img10']);
    // img1 must not match inside upload:img10 — that is what the lookahead is for.
    assert.equal(body.replace(uploadRefRe('img1', 'g'), '$1eth:0x00'), '![a](eth:0x00) and ![b](upload:img10) and [not an image](upload:img1)');
  });
});

describe('the payload layer', () => {
  test('compression round-trips, front-matter and all', () => {
    const { text, bytes } = encodePayload({
      markdown: '# Hello\n\nA body.\n',
      meta: { lang: 'en' },
      tags: ['a', 'b'],
    });
    assert.equal(text, '---\ntags: a, b\nlang: en\n---\n\n# Hello\n\nA body.\n');
    assert.equal(decompressBytes(bytes), text);
  });

  test('a document with the same content always weighs the same', () => {
    const text = 'A stable document.\n';
    assert.equal(compressText(text).length, compressText(text).length);
    assert.deepEqual([...compressText(text)], [...compressText(text)]);
  });

  test('multi-byte text survives the round trip', () => {
    const text = '雪泥鸿爪 — the prints a wild goose leaves in the snow.';
    assert.equal(decompressBytes(compressText(text)), text);
  });
});

describe('the archive format', () => {
  test('images are base64, with their mime and chain', () => {
    const image = archiveImage({ chainId: 1, txHash: HASH_A.toUpperCase(), bytes: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(image, {
      chainId: 1,
      txHash: HASH_A,
      mime: 'image/webp',
      base64: bytesToBase64(new Uint8Array([1, 2, 3])),
    });
    assert.deepEqual([...Buffer.from(image.base64, 'base64')], [1, 2, 3]);
  });

  test('the document carries its format marker first', () => {
    const doc = buildArchive({
      contract: '0xabc',
      scope: { kind: 'author', address: '0xdef' },
      posts: [],
      images: [],
      authors: [],
      now: new Date('2026-09-04T12:00:00.000Z'),
    });
    assert.deepEqual(Object.keys(doc), ['glyph', 'exportedAt', 'contract', 'scope', 'posts', 'images', 'authors']);
    assert.deepEqual(doc.glyph, { archive: 1 });
    assert.equal(doc.exportedAt, '2026-09-04T12:00:00.000Z');
  });
});

describe('the argument grammar', () => {
  test('a bare --rpc applies to every chain; a prefixed one to its own', () => {
    const overrides = readRpcOverrides(['taiko=http://a', 'http://shared', 'ethereum=http://b']);
    assert.deepEqual(endpointsFor(167000, overrides), ['http://a', 'http://shared']);
    assert.deepEqual(endpointsFor(1, overrides), ['http://b', 'http://shared']);
  });

  test('a query string is not mistaken for a chain prefix', () => {
    const overrides = readRpcOverrides(['https://node.example/rpc?key=secret']);
    assert.deepEqual(endpointsFor(1, overrides), ['https://node.example/rpc?key=secret']);
  });

  test('with no --rpc, the chain registry decides', () => {
    assert.deepEqual(endpointsFor(1, readRpcOverrides([])), defaultRpcs(1));
  });

  test('a post argument is a hash and an optional ordinal', () => {
    assert.deepEqual(parsePostArg(HASH_A), { txHash: HASH_A, eventIndex: 0 });
    // A hash pasted out of a block explorer often comes back mixed case.
    assert.deepEqual(parsePostArg(`0x${'A1'.repeat(32)}/2`), { txHash: HASH_A, eventIndex: 2 });
    assert.throws(() => parsePostArg('0x1234'), /not a transaction hash/);
    assert.throws(() => parsePostArg(`${HASH_A}/-1`), /not a transaction hash/);
  });

  test('--limit 0 means no limit at all', () => {
    assert.equal(parseLimit(undefined), null);
    assert.equal(parseLimit('0'), null);
    assert.equal(parseLimit('7'), 7);
    assert.throws(() => parseLimit('some'), /whole number/);
  });
});

describe('the diff', () => {
  test('identical documents produce nothing', () => {
    assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  });

  test('one changed line, with context around it', () => {
    const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
    const after = before.replace('five', 'FIVE');
    const diff = unifiedDiff(before, after, { labels: ['chain', 'file'] });
    assert.match(diff, /^--- chain$/m);
    assert.match(diff, /^\+\+\+ file$/m);
    assert.match(diff, /^@@ -2,7 \+2,7 @@$/m);
    assert.match(diff, /^-five$/m);
    assert.match(diff, /^\+FIVE$/m);
    // Three lines of context each side, and nothing beyond them.
    assert.ok(!diff.includes('\n one\n'));
  });

  test('an added line at the end shows as an addition alone', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nb\nc\n');
    assert.match(diff, /^\+c$/m);
    assert.ok(!/^-/m.test(diff.split('\n').slice(2).join('\n')));
  });

  test('a missing final newline is a difference worth naming', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nb');
    assert.match(diff, /No newline at end of file/);
  });

  test('two documents with nothing in common are still described', () => {
    const diff = unifiedDiff('alpha\nbeta\n', 'gamma\ndelta\n');
    assert.match(diff, /^-alpha$/m);
    assert.match(diff, /^\+gamma$/m);
  });
});
