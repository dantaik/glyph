// export.test.js — a whole author on disk, and a bundle the web app can read.
//
// The archive's shape is checked field by field on purpose. It is an
// interchange format: the web app's importer reads exactly these names, and
// a bundle written a year from now has to be readable by a reader that has
// only the format description to go on. A test that merely said "it wrote
// some JSON" would let a renamed field through.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, startNode } from './support/harness.mjs';
import { DEFAULT_GLYPH_ADDRESS } from '../src/shared.js';

describe('export', () => {
  let node;
  let oracle;
  let author;
  let out;
  let archive;

  before(async () => {
    node = await startNode();
    oracle = await node.oracle();
    author = oracle.authors.find((a) => {
      const c = oracle.counts[a];
      return c.byChain['1'] > 0 && c.byChain['167000'] > 0;
    });
    out = mkdtempSync(join(tmpdir(), 'xueni-export-'));
    await ok(['export', author, '--out', out, ...node.rpcArgs()]);
    archive = JSON.parse(readFileSync(join(out, 'archive.xueni.json'), 'utf8'));
  });
  after(() => node.stop());

  test('writes one .md per post, per chain', async () => {
    for (const [chainId, slug] of [
      [1, 'ethereum'],
      [167000, 'taiko'],
    ]) {
      const files = readdirSync(join(out, slug)).filter((f) => f.endsWith('.md'));
      assert.equal(files.length, oracle.counts[author].byChain[String(chainId)]);
      // <yyyy-mm-dd>-<index>-<title>.md — the date sorts, the index is the
      // post's identity, and the title makes the directory readable.
      for (const file of files) assert.match(file, /^\d{4}-\d{2}-\d{2}-\d+-.+\.md$/u);
    }
  });

  test('each .md holds exactly the text the archive holds', async () => {
    for (const post of archive.posts) {
      const slug = post.chainId === 1 ? 'ethereum' : 'taiko';
      const files = readdirSync(join(out, slug)).filter((f) => f.includes(`-${post.index}-`));
      assert.equal(files.length, 1, `one file for index ${post.index} on ${slug}`);
      assert.equal(readFileSync(join(out, slug, files[0]), 'utf8'), post.text);
    }
  });

  test('the archive carries the format marker, the contract and the scope', async () => {
    assert.deepEqual(archive.glyph, { archive: 1 });
    assert.equal(archive.contract, DEFAULT_GLYPH_ADDRESS);
    assert.equal(archive.scope.kind, 'author');
    assert.equal(archive.scope.address.toLowerCase(), author.toLowerCase());
    assert.match(archive.exportedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.ok(Array.isArray(archive.images));
  });

  test('every post in the archive has the documented fields, as plain numbers', async () => {
    assert.equal(archive.posts.length, oracle.counts[author].total);
    for (const post of archive.posts) {
      assert.deepEqual(Object.keys(post), [
        'chainId',
        'txHash',
        'eventIndex',
        'author',
        'index',
        'block',
        'prevBlock',
        'logIndex',
        'ts',
        'title',
        'text',
        'compressedBytes',
      ]);
      for (const key of ['chainId', 'eventIndex', 'index', 'block', 'prevBlock', 'logIndex', 'ts', 'compressedBytes']) {
        assert.equal(typeof post[key], 'number', `${key} should be a plain JSON number`);
      }
      assert.match(post.txHash, /^0x[0-9a-f]{64}$/);
      assert.equal(typeof post.text, 'string');
    }
  });

  test('every walked author is marked complete, with the head it was walked from', async () => {
    assert.equal(archive.authors.length, 2, 'one entry per chain the author writes on');
    for (const entry of archive.authors) {
      assert.deepEqual(Object.keys(entry), ['chainId', 'address', 'head', 'complete']);
      assert.equal(entry.complete, true);
      assert.equal(entry.address.toLowerCase(), author.toLowerCase());
      assert.ok(entry.head > 0);
      // The head is the block of that chain's newest post — what the
      // contract's latestBlock() returned when the walk started.
      const newest = archive.posts.filter((p) => p.chainId === entry.chainId).map((p) => p.block);
      assert.equal(entry.head, Math.max(...newest));
    }
  });

  test('--chain narrows the export to one chain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xueni-export-one-'));
    const { stdout } = await ok([
      'export',
      author,
      '--out',
      dir,
      '--chain',
      'taiko',
      '--json',
      '--rpc',
      node.rpc(167000),
    ]);
    const summary = JSON.parse(stdout);
    assert.equal(summary.posts, oracle.counts[author].byChain['167000']);
    assert.deepEqual(readdirSync(dir).sort(), ['archive.xueni.json', 'taiko']);
    const doc = JSON.parse(readFileSync(join(dir, 'archive.xueni.json'), 'utf8'));
    assert.equal(doc.authors.length, 1);
    assert.equal(doc.authors[0].chainId, 167000);
  });

  test('an author with nothing on a chain gets no directory and no authors entry', async () => {
    const nobody = `0x${'22'.repeat(20)}`;
    const dir = mkdtempSync(join(tmpdir(), 'xueni-export-empty-'));
    await ok(['export', nobody, '--out', dir, ...node.rpcArgs()]);
    const doc = JSON.parse(readFileSync(join(dir, 'archive.xueni.json'), 'utf8'));
    assert.deepEqual(doc.posts, []);
    // An entry with a head of zero would tell an importing browser it had
    // walked a list that does not exist.
    assert.deepEqual(doc.authors, []);
    assert.deepEqual(readdirSync(dir), ['archive.xueni.json']);
  });
});
