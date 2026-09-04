// author.test.js — the walk, on one chain and on all of them.
//
// The counts come from the oracle's `counts` table, which is the fixture
// world's own tally per author per chain, so the walk is checked against
// what the chain actually holds rather than against a number written down
// here.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, run, startNode } from './support/harness.mjs';

describe('author', () => {
  let node;
  let oracle;
  /** The author who writes on both chains — the one `all` has work to do for. */
  let author;

  before(async () => {
    node = await startNode();
    oracle = await node.oracle();
    author = oracle.authors.find((a) => {
      const c = oracle.counts[a];
      return c.byChain['1'] > 0 && c.byChain['167000'] > 0;
    });
    assert.ok(author, 'the fixtures should have an author on both chains');
  });
  after(() => node.stop());

  test('one chain lists every post that author has there', async () => {
    const expected = oracle.counts[author].byChain['1'];
    const { stdout } = await ok(['author', 'ethereum', author, '--json', '--rpc', node.rpc(1)]);
    const rows = JSON.parse(stdout);
    assert.equal(rows.length, expected);
    assert.ok(rows.every((r) => r.chainId === 1));
    assert.ok(rows.every((r) => r.author.toLowerCase() === author.toLowerCase()));
    // Newest first, and the walk descends the author's own index.
    assert.deepEqual(
      rows.map((r) => r.index),
      [...rows.map((r) => r.index)].sort((a, b) => b - a),
    );
    // The list is contiguous down to the author's first post: that is what
    // following prevBlock to the end means.
    assert.equal(rows[rows.length - 1].index, 0);
  });

  test('the plain listing carries the index, title, chain, block, date and full hash', async () => {
    const { stdout } = await ok(['author', 'ethereum', author, '--rpc', node.rpc(1)]);
    const lines = stdout.trimEnd().split('\n');
    const newest = oracle.posts.filter((p) => p.chainId === 1 && p.author.toLowerCase() === author.toLowerCase())[0];
    assert.equal(lines[0], `#${newest.index}  ${newest.title}`);
    assert.match(lines[1], /^ {4}ethereum · block \d+ · \d{4}-\d{2}-\d{2} · 0x[0-9a-f]{64}$/);
    assert.ok(lines[1].includes(newest.txHash), 'the full hash is what the next command needs');
  });

  test('all merges every chain, newest first by time', async () => {
    const expected = oracle.counts[author].total;
    const { stdout } = await ok(['author', 'all', author, '--json', ...node.rpcArgs()]);
    const rows = JSON.parse(stdout);
    assert.equal(rows.length, expected);
    assert.ok(new Set(rows.map((r) => r.chainId)).size > 1, 'both chains should be in it');
    const times = rows.map((r) => r.ts);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    // The same order the app's merged author page shows, which the oracle
    // already states for the feed.
    const fromOracle = oracle.posts
      .filter((p) => p.author.toLowerCase() === author.toLowerCase())
      .map((p) => p.txHash);
    assert.deepEqual(rows.map((r) => r.txHash), fromOracle);
  });

  test('--limit stops the walk early', async () => {
    const { stdout } = await ok(['author', 'all', author, '--limit', '3', '--json', ...node.rpcArgs()]);
    assert.equal(JSON.parse(stdout).length, 3);
  });

  test('an author who has published nothing is said so, not left blank', async () => {
    const nobody = `0x${'11'.repeat(20)}`;
    const { stdout } = await ok(['author', 'ethereum', nobody, '--rpc', node.rpc(1)]);
    assert.match(stdout, /published nothing/);
  });

  test('--chain stands in for the positional when only the address is given', async () => {
    const { stdout } = await ok(['author', '--chain', 'ethereum', author, '--json', '--rpc', node.rpc(1)]);
    assert.equal(JSON.parse(stdout).length, oracle.counts[author].byChain['1']);
  });

  test('a malformed address is refused before any request', async () => {
    const { code, stderr } = await run(['author', 'ethereum', '0xnope']);
    assert.equal(code, 1);
    assert.match(stderr, /not an address/);
  });
});
