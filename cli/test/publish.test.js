// publish.test.js — the payload, measured; the sending path, not.
//
// WHAT IS NOT TESTED HERE, AND WHY. The mock node serves a chain but does
// not accept transactions — it answers reads and nothing else — and this
// environment has no Anvil, so `xueni publish` without `--dry-run` is never
// exercised. Everything up to the send is: the title rules, the front-matter
// that survives, the image refusals, and above all the BYTES, which is the
// part that has to be right. Run the sending path against a local Anvil
// (`anvil` in one terminal, `--rpc http://127.0.0.1:8545` here) before
// trusting a change to it.
//
// The bytes test is the important one. It compresses the same document with
// a plain `node:zlib` call and asserts the CLI produced exactly those bytes,
// so a change to the compression parameters — anything that would make a
// post published from a terminal differ from the same post published from
// the browser — fails here.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, run } from './support/harness.mjs';
import { buildPayloadText } from '../src/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'xueni-publish-'));

function draft(name, contents) {
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

/** What the same document weighs when Node compresses it directly. */
const brotli = (text) =>
  brotliCompressSync(Buffer.from(text, 'utf8'), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

describe('publish --dry-run', () => {
  test('the compressed size is exactly brotli(quality 11) of the document', async () => {
    const markdown = '# A letter\n\nThe body, long enough that brotli has something to chew on.\n';
    const file = draft('bytes.md', markdown);
    const { stdout } = await ok(['publish', file, '--chain', 'taiko', '--dry-run', '--json', '--tags', 'one,two']);
    const result = JSON.parse(stdout);
    // The document the CLI says it would store, built by the module the web
    // app builds it with — front-matter keys in the app's own order.
    const expected = buildPayloadText({ markdown, meta: { tags: ['one', 'two'] } });
    assert.equal(result.text, expected);
    assert.equal(result.compressedBytes, brotli(expected));
    assert.equal(result.compressedBytes, brotli(result.text));
    assert.equal(result.limit, 131_072 - 1_024);
    assert.ok(result.estimatedGas > 21_000);
    assert.equal(result.dryRun, true);
    assert.equal(result.chain, 'taiko');
  });

  test('a document with no metadata compresses to bare Markdown', async () => {
    const markdown = 'Just the body.\n';
    const file = draft('bare.md', markdown);
    const { stdout } = await ok(['publish', file, '--chain', 'ethereum', '--dry-run', '--json']);
    const result = JSON.parse(stdout);
    // The point of the text layer: a post with no metadata is pure Markdown,
    // openable in any editor decades from now — no front-matter block at all.
    assert.equal(result.text, markdown);
    assert.equal(result.compressedBytes, brotli(markdown));
  });

  test('the title comes from front-matter, then a heading, then the file name', async () => {
    const fromMeta = draft('from-meta.md', '---\ntitle: The stated one\n---\n\n# The heading one\n\nBody.\n');
    assert.equal(JSON.parse((await ok(['publish', fromMeta, '--chain', 'taiko', '--dry-run', '--json'])).stdout).title, 'The stated one');

    const fromHeading = draft('from-heading.md', '## The heading one\n\nBody.\n');
    assert.equal(JSON.parse((await ok(['publish', fromHeading, '--chain', 'taiko', '--dry-run', '--json'])).stdout).title, 'The heading one');

    const fromName = draft('the-file-name.md', 'Body with no heading at all.\n');
    assert.equal(JSON.parse((await ok(['publish', fromName, '--chain', 'taiko', '--dry-run', '--json'])).stdout).title, 'the-file-name');

    const asked = await ok(['publish', fromMeta, '--chain', 'taiko', '--dry-run', '--json', '--title', 'What I said']);
    assert.equal(JSON.parse(asked.stdout).title, 'What I said');
  });

  test('`title:` is read but never written on chain', async () => {
    const file = draft('title-key.md', '---\ntitle: Not a front-matter key\n---\n\nBody.\n');
    const { stdout } = await ok(['publish', file, '--chain', 'taiko', '--dry-run', '--json']);
    // On chain a title is its own bytes32 argument; carrying it in the
    // front-matter as well would be paying twice for one string.
    assert.equal(JSON.parse(stdout).text, 'Body.\n');
  });

  test('a title over 32 bytes is refused rather than cut', async () => {
    const file = draft('long-title.md', 'Body.\n');
    const long = 'This title is far too long to fit inside one word of storage';
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko', '--dry-run', '--title', long]);
    assert.equal(code, 1);
    assert.match(stderr, /bytes of UTF-8/);

    // 32 bytes is 32 ASCII letters, but only about ten Chinese characters.
    const cjk = await run(['publish', file, '--chain', 'taiko', '--dry-run', '--title', '雪泥鸿爪雪泥鸿爪雪泥鸿爪']);
    assert.equal(cjk.code, 1);
    assert.match(cjk.stderr, /36 bytes/);
  });

  test('front-matter this version does not know is named, not carried', async () => {
    const file = draft('unknown-keys.md', '---\nlang: zh\nweather: cold\nmood: quiet\n---\n\nBody.\n');
    const { stdout, stderr } = await ok(['publish', file, '--chain', 'taiko', '--dry-run', '--json']);
    assert.match(stderr, /mood, weather/);
    const { text } = JSON.parse(stdout);
    assert.ok(text.includes('lang: zh'));
    assert.ok(!text.includes('weather'));
  });

  test('--tags overrides what the file says', async () => {
    const file = draft('tags.md', '---\ntags: from the file\n---\n\nBody.\n');
    const { stdout } = await ok(['publish', file, '--chain', 'taiko', '--dry-run', '--json', '--tags', 'from, the, flag']);
    const { text } = JSON.parse(stdout);
    assert.ok(text.includes('tags: from, the, flag'));
    assert.ok(!text.includes('from the file'));
  });

  test('an image that is not a .webp is refused, with somewhere to go', async () => {
    const file = draft('with-image.md', '![a photo](upload:img1)\n');
    const photo = draft('photo.png', 'not really a png');
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko', '--dry-run', '--image', `img1=${photo}`]);
    assert.equal(code, 1);
    assert.match(stderr, /not a \.webp/);
    assert.match(stderr, /web app/, 'the refusal should say where to get one converted');
  });

  test('an image argument in the wrong shape is refused', async () => {
    const file = draft('shape.md', 'Body.\n');
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko', '--dry-run', '--image', 'photo.webp']);
    assert.equal(code, 1);
    assert.match(stderr, /key=path/);
  });

  test('an image the body never shows is not sent, and says so', async () => {
    const file = draft('unused-image.md', 'A body with no image reference in it.\n');
    const photo = draft('unused.webp', 'RIFF....WEBP');
    const { stderr } = await ok([
      'publish',
      file,
      '--chain',
      'taiko',
      '--dry-run',
      '--image',
      `img1=${photo}`,
    ]);
    assert.match(stderr, /nothing in the body references upload:img1/);
  });

  test('an image reference is measured as the eth: ref it will become', async () => {
    const markdown = '![a photo](upload:img1)\n';
    const file = draft('measured.md', markdown);
    const photo = draft('shown.webp', 'RIFF....WEBP');
    const { stdout } = await ok(['publish', file, '--chain', 'taiko', '--dry-run', '--json', '--image', `img1=${photo}`]);
    const result = JSON.parse(stdout);
    // The measurement has to be of the document as it will be SENT, or a
    // draft that just fits here would be refused by the node.
    assert.match(result.text, /!\[a photo\]\(eth:0x[0-9a-f]{64}\)/);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].key, 'img1');
    assert.ok(result.images[0].estimatedGas > 21_000);
  });

  test('nothing is sent, and no key is needed', async () => {
    const file = draft('nokey.md', '# A letter\n\nBody.\n');
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko', '--dry-run']);
    assert.equal(code, 0);
    assert.match(stderr, /nothing was sent/);
  });
});

describe('publish', () => {
  test('without PRIVATE_KEY it refuses before touching the network', async () => {
    const file = draft('needs-key.md', '# A letter\n\nBody.\n');
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko']);
    assert.equal(code, 1);
    assert.match(stderr, /PRIVATE_KEY/);
    assert.match(stderr, /never taken as an argument/);
  });

  test('a key that is not a key is refused with a sentence', async () => {
    const file = draft('bad-key.md', '# A letter\n\nBody.\n');
    const { code, stderr } = await run(['publish', file, '--chain', 'taiko'], { env: { PRIVATE_KEY: 'hunter2' } });
    assert.equal(code, 1);
    assert.match(stderr, /not a 32-byte hex private key/);
  });

  test('a chain is required, and `all` is not one', async () => {
    const file = draft('no-chain.md', '# A letter\n\nBody.\n');
    const missing = await run(['publish', file, '--dry-run']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /needs a chain/);

    const all = await run(['publish', file, '--chain', 'all', '--dry-run']);
    assert.equal(all.code, 1);
    assert.match(all.stderr, /publishes to one chain/);
  });
});
