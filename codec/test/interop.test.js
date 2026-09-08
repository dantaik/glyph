// interop.test.js — this package against the code already writing the chain.
//
// The web app (webapp/src/lib/payloadText.js, title.js) and the CLI on top
// of it are what every post so far was written with. Two encoders of one
// format drift apart, and drift is silent and on chain — so this file holds
// the codec to them byte for byte: the reader on every input a fuzzer can
// think of, the writer on every post it accepts, the title both ways, and
// brotli-wasm (the browser's compressor) against node:zlib (the CLI's).
//
// The webapp modules need webapp's dependencies installed (title.js imports
// viem from there); when they are not, those tests are skipped, not failed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { brotliCompressSync, constants } from 'node:zlib';
import { buildDocument, encodeTitle, decodeTitle, fromBrotliWasm, parseTags, splitFrontMatter, titleByteLength } from '../src/index.js';
import { nodeBrotli } from '../src/node.js';

const require = createRequire(import.meta.url);

async function webapp(name) {
  try {
    return await import(`../../webapp/src/lib/${name}.js`);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw err;
  }
}

/** A small deterministic generator, so a failure is reproducible. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ['---', '---\n', '\n', '\n\n', '\r\n', ' ', '  ', ':', ': ', 'key', 'tags', 'lang', 'a', 'b', ',', '[', ']', '冬', '雪泥', '#', '# H', 'value', '\t', '﻿', '- -', '----', '--'];

function randomDocument(rand) {
  const n = Math.floor(rand() * 14);
  let out = '';
  for (let i = 0; i < n; i++) out += PIECES[Math.floor(rand() * PIECES.length)];
  return out;
}

describe('the reader agrees with the web app', async () => {
  const mod = await webapp('payloadText');

  test('splitFrontMatter — on every document a fuzzer can build', { skip: !mod && 'webapp dependencies not installed' }, () => {
    const rand = prng(20260908);
    for (let i = 0; i < 20000; i++) {
      const text = randomDocument(rand);
      const { matched, ...mine } = splitFrontMatter(text);
      assert.deepEqual(mine, mod.splitFrontMatter(text), JSON.stringify(text));
    }
  });

  test('parseTags — on every value a fuzzer can build', { skip: !mod && 'webapp dependencies not installed' }, () => {
    const rand = prng(7);
    for (let i = 0; i < 5000; i++) {
      const text = randomDocument(rand);
      assert.deepEqual(parseTags(text), mod.parseTags(text), JSON.stringify(text));
    }
  });
});

describe('the writer agrees with the web app', async () => {
  const mod = await webapp('payloadText');
  const skip = !mod && 'webapp dependencies not installed';

  test('on posts the web app writes today', { skip }, () => {
    const cases = [
      { markdown: '# Hello\n\nBody.', meta: {} },
      { markdown: 'Body.', meta: { tags: ['a', 'b'] } },
      { markdown: 'Body.', meta: { tags: 'a, b' } },
      { markdown: 'Body.', meta: { part: '2', series: 'Winter', lang: 'zh', tags: ['letters'] } },
      { markdown: 'Body.', meta: { zeta: '1', alpha: '2', lang: 'en' } },
      { markdown: '', meta: { lang: '   ', tags: [] } },
      { markdown: '# 冬至\n\n正文。\n\n---\n\nA rule.', meta: { tags: ['letters home', '冬'], re: `0x${'ab'.repeat(32)}`, somethingLater: 'kept' } },
      { markdown: 'one\r\ntwo', meta: { tags: [' spaced ', ''] } },
      { markdown: '---\n\nA thematic break, not metadata.', meta: {} },
    ];
    for (const post of cases) {
      assert.equal(buildDocument(post), mod.buildPayloadText(post), JSON.stringify(post));
    }
  });

  test('on random posts within the writer grammar', { skip }, () => {
    const rand = prng(99);
    const keys = ['tags', 'lang', 're', 'supersedes', 'prev', 'series', 'part', 'extra', 'Zeta', 'a_b', 'c-d'];
    const values = ['x', 'a, b', ' padded ', '冬', '3', '', 'taiko:0xab', 'v: w', '[a', 'b]'];
    for (let i = 0; i < 3000; i++) {
      const meta = {};
      const n = Math.floor(rand() * 5);
      for (let k = 0; k < n; k++) meta[keys[Math.floor(rand() * keys.length)]] = values[Math.floor(rand() * values.length)];
      let markdown = randomDocument(rand);
      if (splitFrontMatter(markdown).matched) markdown = `x${markdown}`; // the one documented divergence, see below
      const post = { markdown, meta };
      let mine;
      try {
        mine = buildDocument(post);
      } catch (err) {
        // The codec refuses a tags line the reader would not invert; the web
        // app writes it anyway. Nothing else may be refused here.
        assert.equal(err.problems.every((p) => p.code === 'TAG_BRACKET'), true, JSON.stringify(post));
        continue;
      }
      assert.equal(mine, mod.buildPayloadText(post), JSON.stringify(post));
    }
  });

  test('differs from the web app in exactly one place: a body that reads as front-matter', { skip }, () => {
    const markdown = '---\nfoo: bar\n---\nrest';
    // The web app writes the bare body, which its own reader then misreads;
    // the codec writes an explicit empty block, which every reader inverts.
    assert.equal(mod.buildPayloadText({ markdown }), markdown);
    assert.deepEqual(mod.parsePayloadText(mod.buildPayloadText({ markdown })).meta, { foo: 'bar' });
    assert.equal(buildDocument({ markdown }), `---\n---\n\n${markdown}`);
    assert.deepEqual(mod.parsePayloadText(buildDocument({ markdown })), { meta: {}, tags: [], markdown });
  });
});

describe('the title agrees with the web app', async () => {
  const mod = await webapp('title');
  const skip = !mod && 'webapp dependencies not installed';

  test('both ways, on titles of every width', { skip }, () => {
    for (const title of ['', 'A letter before the solstice', '雪泥鸿爪', '关于外婆的香樟木箱', '😀'.repeat(8), 'a'.repeat(32), ' x ']) {
      assert.equal(encodeTitle(title), mod.encodeTitle(title));
      assert.equal(decodeTitle(mod.encodeTitle(title)), mod.decodeTitle(encodeTitle(title)));
      assert.equal(titleByteLength(title), mod.titleByteLength(title));
    }
    // A title cut mid-character reads the same on both sides.
    const cut = new Uint8Array(32);
    cut.set(new TextEncoder().encode('冬至前两天我上阁楼找腊').slice(0, 32));
    const hex = `0x${Buffer.from(cut).toString('hex')}`;
    assert.equal(decodeTitle(hex), mod.decodeTitle(hex));
  });
});

describe('brotli-wasm agrees with node:zlib', () => {
  let wasm = null;
  try {
    wasm = fromBrotliWasm(require('brotli-wasm'));
  } catch {
    // Not installed: `npm install` in this package brings it.
  }
  const skip = !wasm && 'brotli-wasm not installed';

  test('the browser compressor and the CLI compressor produce the same bytes', { skip }, () => {
    const docs = [
      '',
      'x',
      '# Hello\n\nA body.\n',
      '---\ntags: a, b\nlang: en\n---\n\n# Hello\n\nA body.\n',
      '雪泥鸿爪 — the prints a wild goose leaves in the snow. '.repeat(40),
      'Xiaoman,\n\nThe north wind is rattling the window paper tonight.\n'.repeat(30),
      Array.from({ length: 3000 }, (_, i) => String.fromCharCode(0x4e00 + ((i * 7919) % 20000))).join(''),
    ];
    for (const doc of docs) {
      const bytes = new TextEncoder().encode(doc);
      const a = nodeBrotli.compress(bytes);
      const b = wasm.compress(bytes);
      assert.deepEqual(b, a, `document of ${bytes.length} bytes`);
      assert.deepEqual(wasm.decompress(a), bytes);
      assert.deepEqual(nodeBrotli.decompress(b), bytes);
    }
  });

  test('both refuse the version envelope byte', { skip }, () => {
    assert.throws(() => wasm.decompress(new Uint8Array([0x91, 2, 0x0b])));
    assert.throws(() => nodeBrotli.decompress(new Uint8Array([0x91, 2, 0x0b])));
  });
});

describe('the reference codec', () => {
  test('is node:zlib at quality 11 with every other parameter at its default', () => {
    const text = new TextEncoder().encode('A stable document, with a little repetition, repetition, repetition.\n');
    assert.deepEqual(nodeBrotli.compress(text), new Uint8Array(brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })));
  });

  test('decodes UTF-8 exactly as Buffer#toString does, byte-order mark included', () => {
    const { utf8Decode } = require('../src/utf8.js');
    const rand = prng(3);
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(rand() * 12);
      const bytes = new Uint8Array(len);
      for (let j = 0; j < len; j++) bytes[j] = rand() < 0.5 ? Math.floor(rand() * 256) : 0x41;
      assert.equal(utf8Decode(bytes), Buffer.from(bytes).toString('utf8'));
    }
    assert.equal(utf8Decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), '﻿A');
  });
});
