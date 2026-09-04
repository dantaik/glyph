// fetch.test.js — one post, in each of the three shapes.
//
// Checked against the mock node's oracle rather than against fixed strings,
// so the tests follow the fixtures rather than having to be rewritten every
// time a demo post changes.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, run, startNode } from './support/harness.mjs';

describe('fetch', () => {
  let node;
  let oracle;
  let post;

  before(async () => {
    node = await startNode();
    oracle = await node.oracle();
    // A post with front-matter, so that the difference between the Markdown
    // and the exact stored document is visible.
    post = oracle.posts.find((p) => p.chainId === 1);
  });
  after(() => node.stop());

  const rpc = () => ['--rpc', node.rpc(1)];

  test('prints the Markdown, with the probe the oracle says is in it', async () => {
    const { stdout } = await ok(['fetch', 'ethereum', post.txHash, ...rpc()]);
    assert.ok(stdout.includes(post.probe), `expected the body to contain ${post.probe}`);
    // The Markdown is the body alone: the front-matter belongs to --raw.
    assert.ok(!stdout.startsWith('---\n'));
  });

  test('--raw prints the exact document, front-matter and all', async () => {
    const { stdout } = await ok(['fetch', 'ethereum', post.txHash, '--raw', ...rpc()]);
    assert.ok(stdout.startsWith('---\n'), 'a post with tags stores a front-matter block');
    assert.ok(stdout.includes(post.probe));
    // Exactly the bytes, with nothing added: this is what `verify` compares
    // against, so `fetch --raw > letter.md` has to round-trip.
    assert.ok(!stdout.endsWith('\n\n'));
  });

  test('--json prints an archive post record', async () => {
    const { stdout } = await ok(['fetch', 'ethereum', post.txHash, '--json', ...rpc()]);
    const record = JSON.parse(stdout);
    assert.deepEqual(Object.keys(record), [
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
    assert.equal(record.chainId, 1);
    assert.equal(record.txHash, post.txHash);
    assert.equal(record.title, post.title);
    assert.equal(record.index, post.index);
    assert.equal(record.eventIndex, 0);
    assert.equal(record.author.toLowerCase(), post.author.toLowerCase());
    assert.ok(record.compressedBytes > 0);
    assert.ok(Number.isInteger(record.block) && record.block > 0);
    // Every number is a plain JSON number — the archive format says so, and a
    // bigint would have serialised as a string or thrown.
    for (const key of ['chainId', 'index', 'block', 'prevBlock', 'logIndex', 'ts', 'compressedBytes']) {
      assert.equal(typeof record[key], 'number', `${key} should be a number`);
    }
  });

  test('the /<n> suffix names the event within the transaction', async () => {
    const { stdout } = await ok(['fetch', 'ethereum', `${post.txHash}/0`, '--json', ...rpc()]);
    assert.equal(JSON.parse(stdout).eventIndex, 0);
    const missing = await run(['fetch', 'ethereum', `${post.txHash}/3`, ...rpc()]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no event 3/);
  });

  test('a transaction the chain has never seen is refused, not crashed on', async () => {
    const absent = `0x${'ab'.repeat(32)}`;
    const { code, stderr } = await run(['fetch', 'ethereum', absent, ...rpc()]);
    assert.equal(code, 1);
    assert.match(stderr, /no transaction/i);
  });

  test('a chain nobody has heard of is refused before any request', async () => {
    const { code, stderr } = await run(['fetch', 'solana', post.txHash]);
    assert.equal(code, 1);
    assert.match(stderr, /no such chain/);
  });

  test('--images saves nothing when the body references no on-chain image', async () => {
    // The demo bodies carry data: URIs rather than `eth:0x…` references, so
    // there is nothing to save — and the command must still succeed and print
    // the body. The rewriting itself is covered in units.test.js.
    const dir = mkdtempSync(join(tmpdir(), 'xueni-images-'));
    const { stdout } = await ok(['fetch', 'ethereum', post.txHash, '--images', dir, ...rpc()]);
    assert.ok(stdout.includes(post.probe));
    assert.deepEqual(readdirSync(dir), []);
  });
});
