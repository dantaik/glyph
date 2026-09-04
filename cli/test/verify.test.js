// verify.test.js — the round trip, which is the whole point of the command.
//
// A file that came off the chain has to verify against the chain, and a file
// that has been touched has to fail — with a diff that shows where, and an
// exit code a shell can branch on without reading a word.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, run, startNode } from './support/harness.mjs';

describe('verify', () => {
  let node;
  let post;
  let dir;
  let file;
  let text;

  before(async () => {
    node = await startNode();
    const oracle = await node.oracle();
    post = oracle.posts.find((p) => p.chainId === 1);
    dir = mkdtempSync(join(tmpdir(), 'xueni-verify-'));
    file = join(dir, 'letter.md');
    // The file comes out of `fetch --raw`, which is how a person would get
    // one: whatever that writes has to be exactly what the chain holds.
    const { stdout } = await ok(['fetch', 'ethereum', post.txHash, '--raw', '--rpc', node.rpc(1)]);
    writeFileSync(file, stdout, 'utf8');
    text = stdout;
  });
  after(() => node.stop());

  const rpc = () => ['--rpc', node.rpc(1)];

  test('a file straight off the chain matches, and exits 0', async () => {
    const { code, stdout } = await run(['verify', file, 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 0);
    assert.match(stdout, /is exactly what/);
  });

  test('CRLF line endings are forgiven — an editor is not an edit', async () => {
    const windows = join(dir, 'letter-crlf.md');
    writeFileSync(windows, text.replace(/\n/g, '\r\n'), 'utf8');
    const { code } = await run(['verify', windows, 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 0);
  });

  test('a changed word exits 1 with a unified diff', async () => {
    const changed = join(dir, 'changed.md');
    const [firstWord] = text.match(/\p{L}{4,}/u);
    writeFileSync(changed, text.replace(firstWord, `${firstWord}NOT`), 'utf8');
    const { code, stdout, stderr } = await run(['verify', changed, 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 1);
    // The chain is the `-` side: the diff reads as what would have to change
    // in the file to make it the post again.
    assert.match(stdout, /^--- .*\(chain\)$/m);
    assert.match(stdout, /^\+\+\+ .*changed\.md$/m);
    assert.match(stdout, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
    assert.match(stdout, new RegExp(`^\\+.*${firstWord}NOT`, 'm'));
    assert.match(stdout, new RegExp(`^-.*${firstWord}(?!NOT)`, 'm'));
    assert.match(stderr, /differs from what/);
  });

  test('an added line and a removed line both show', async () => {
    const changed = join(dir, 'lines.md');
    const lines = text.split('\n');
    writeFileSync(changed, [...lines.slice(0, 2), 'an interloper', ...lines.slice(3)].join('\n'), 'utf8');
    const { code, stdout } = await run(['verify', changed, 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 1);
    assert.match(stdout, /^\+an interloper$/m);
    assert.match(stdout, new RegExp(`^-${lines[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });

  test('--json says match and carries the diff', async () => {
    const matched = await run(['verify', file, 'ethereum', post.txHash, '--json', ...rpc()]);
    assert.equal(matched.code, 0);
    const good = JSON.parse(matched.stdout);
    assert.equal(good.match, true);
    assert.equal(good.diff, '');
    assert.equal(good.txHash, post.txHash);
    assert.equal(good.chain, 'ethereum');

    const changed = join(dir, 'json-changed.md');
    writeFileSync(changed, `${text}\nand one more line`, 'utf8');
    const failed = await run(['verify', changed, 'ethereum', post.txHash, '--json', ...rpc()]);
    assert.equal(failed.code, 1);
    const bad = JSON.parse(failed.stdout);
    assert.equal(bad.match, false);
    assert.match(bad.diff, /and one more line/);
  });

  test('a file that is not there is a message, not a stack trace', async () => {
    const { code, stderr } = await run(['verify', join(dir, 'absent.md'), 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 1);
    assert.match(stderr, /ENOENT|no such file/i);
    assert.ok(!stderr.includes('    at '), 'no stack trace');
  });

  test('the file an export wrote verifies too', async () => {
    const out = mkdtempSync(join(tmpdir(), 'xueni-verify-export-'));
    await ok(['export', post.author, '--out', out, '--chain', 'ethereum', ...rpc()]);
    const summary = JSON.parse(readFileSync(join(out, 'archive.xueni.json'), 'utf8'));
    const mine = summary.posts.find((p) => p.txHash === post.txHash);
    const name = `${new Date(mine.ts * 1000).toISOString().slice(0, 10)}-${mine.index}-`;
    const [written] = readdirSync(join(out, 'ethereum')).filter((f) => f.startsWith(name));
    const { code } = await run(['verify', join(out, 'ethereum', written), 'ethereum', post.txHash, ...rpc()]);
    assert.equal(code, 0);
  });
});
