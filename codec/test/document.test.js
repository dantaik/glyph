// document.test.js — the text layer: the reader and the writer.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FRONT_MATTER_KEYS, InvalidPostError, buildDocument, parseDocument, parseTags, splitFrontMatter } from '../src/index.js';

const codes = (fn) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof InvalidPostError) return err.problems.map((p) => p.code);
    throw err;
  }
  return [];
};

describe('buildDocument — the writer', () => {
  test('writes no front-matter at all when there is no metadata', () => {
    assert.equal(buildDocument({ markdown: '# Hello\n\nBody.' }), '# Hello\n\nBody.');
    assert.equal(buildDocument({ markdown: 'x', tags: [] }), 'x');
    assert.equal(buildDocument({ markdown: 'x', meta: { lang: '   ' } }), 'x');
    assert.equal(buildDocument({ markdown: 'x', meta: { lang: null } }), 'x');
    assert.equal(buildDocument({}), '');
  });

  test('writes tags as one comma-separated line', () => {
    assert.equal(buildDocument({ markdown: 'Body.', tags: ['a', 'b'] }), '---\ntags: a, b\n---\n\nBody.');
    assert.equal(buildDocument({ markdown: 'Body.', meta: { tags: 'a, b' } }), '---\ntags: a, b\n---\n\nBody.');
    // The argument wins over meta.tags.
    assert.equal(buildDocument({ markdown: 'Body.', tags: ['x'], meta: { tags: ['y'] } }), '---\ntags: x\n---\n\nBody.');
  });

  test('writes known keys in one fixed order, whatever order they arrive in', () => {
    const text = buildDocument({ markdown: 'Body.', meta: { part: '2', series: 'Winter', lang: 'zh', tags: ['letters'] } });
    assert.equal(text, '---\ntags: letters\nlang: zh\nseries: Winter\npart: 2\n---\n\nBody.');
    const order = text.split('\n').slice(1, -3).map((line) => line.split(':')[0]);
    assert.deepEqual(order, [...order].sort((a, b) => FRONT_MATTER_KEYS.indexOf(a) - FRONT_MATTER_KEYS.indexOf(b)));
  });

  test('writes keys it does not know after the ones it does, in ASCII order', () => {
    assert.equal(buildDocument({ markdown: 'Body.', meta: { zeta: '1', alpha: '2', lang: 'en', Beta: '3' } }), '---\nlang: en\nBeta: 3\nalpha: 2\nzeta: 1\n---\n\nBody.');
  });

  test('trims values and tags, drops empty ones, and writes numbers as decimal', () => {
    assert.equal(buildDocument({ markdown: '', meta: { lang: '  zh  ', part: 3, series: '' }, tags: [' a ', '', 'b'] }), '---\ntags: a, b\nlang: zh\npart: 3\n---\n\n');
  });

  test('keeps the body byte for byte: CRLF, trailing whitespace, no final newline', () => {
    const body = 'one\r\ntwo  \r\n\r\n---\r\nrule inside';
    assert.equal(buildDocument({ markdown: body, tags: ['t'] }), `---\ntags: t\n---\n\n${body}`);
    assert.equal(buildDocument({ markdown: body }), body);
  });

  test('puts an explicit empty block before a body that would read as front-matter', () => {
    const body = '---\nfoo: bar\n---\n\nrest';
    const text = buildDocument({ markdown: body });
    assert.equal(text, `---\n---\n\n${body}`);
    assert.deepEqual(parseDocument(text), { meta: {}, tags: [], markdown: body });
    // Two thematic breaks in a row are read as an empty block, so they need it too.
    const breaks = '---\n\n---\n\nprose';
    assert.equal(buildDocument({ markdown: breaks }), `---\n---\n\n${breaks}`);
    assert.equal(parseDocument(buildDocument({ markdown: breaks })).markdown, breaks);
    // A body that merely opens with a rule does not.
    assert.equal(buildDocument({ markdown: '---\n\nA thematic break.' }), '---\n\nA thematic break.');
  });

  test('refuses what the reader could not invert', () => {
    assert.deepEqual(codes(() => buildDocument({ meta: { 'bad key': 'x' } })), ['KEY_SYNTAX']);
    assert.deepEqual(codes(() => buildDocument({ meta: { 'a:b': 'x' } })), ['KEY_SYNTAX']);
    assert.deepEqual(codes(() => buildDocument({ meta: { '': 'x' } })), ['KEY_SYNTAX']);
    assert.deepEqual(codes(() => buildDocument({ meta: { lang: 'zh\nen' } })), ['VALUE_LINE_BREAK']);
    assert.deepEqual(codes(() => buildDocument({ meta: { lang: 'zh\rEN' } })), ['VALUE_LINE_BREAK']);
    assert.deepEqual(codes(() => buildDocument({ meta: { lang: 'zh\r' } })), []); // a trailing CR is whitespace, and trimmed
    assert.deepEqual(codes(() => buildDocument({ tags: '[a, b]' })), ['TAG_BRACKET']); // a string is split, not read as a document line
    assert.deepEqual(codes(() => buildDocument({ tags: ['a,b'] })), ['TAG_COMMA']);
    assert.deepEqual(codes(() => buildDocument({ tags: ['[a', 'b'] })), ['TAG_BRACKET']);
    assert.deepEqual(codes(() => buildDocument({ tags: ['a', 'b]'] })), ['TAG_BRACKET']);
    assert.deepEqual(codes(() => buildDocument({ tags: ['a[', ']b'] })), []); // brackets inside are fine
    assert.deepEqual(codes(() => buildDocument({ meta: { title: 'paid twice' } })), ['KEY_RESERVED']);
    assert.deepEqual(codes(() => buildDocument({ meta: { lang: { nested: true } } })), ['TYPE']);
    assert.deepEqual(codes(() => buildDocument({ markdown: 42 })), ['TYPE']);
    assert.deepEqual(codes(() => buildDocument({ markdown: 'lone \ud800' })), ['MALFORMED_UNICODE']);
    // Every problem at once, not only the first.
    assert.deepEqual(codes(() => buildDocument({ tags: ['a,b'], meta: { 'x y': '1', title: 't' } })), ['TAG_COMMA', 'KEY_RESERVED', 'KEY_SYNTAX']);
  });

  test('is stable: the same post always produces the same text', () => {
    const a = buildDocument({ markdown: 'Body.', meta: { lang: 'en', tags: ['x'] } });
    const b = buildDocument({ markdown: 'Body.', meta: { tags: ['x'], lang: 'en' } });
    assert.equal(a, b);
  });
});

describe('splitFrontMatter — the reader', () => {
  test('reads a well-formed block', () => {
    assert.deepEqual(splitFrontMatter('---\ntags: a\n---\n\nBody.'), { matched: true, meta: { tags: 'a' }, body: 'Body.' });
  });

  test('drops exactly one blank line after the closing delimiter', () => {
    assert.equal(splitFrontMatter('---\na: 1\n---\n\n\nBody.').body, '\nBody.');
    assert.equal(splitFrontMatter('---\na: 1\n---\nBody.').body, 'Body.');
    assert.equal(splitFrontMatter('---\na: 1\n---').body, '');
    assert.equal(splitFrontMatter('---\na: 1\n---\n').body, '');
  });

  test('takes the key before the first colon and the value after it, trimmed', () => {
    const { meta } = splitFrontMatter('---\n  re :  taiko:0xabc/1  \nurl: https://x.y/z\n---\n');
    assert.deepEqual(meta, { re: 'taiko:0xabc/1', url: 'https://x.y/z' });
  });

  test('lets a later line with the same key win, skips blank lines, tolerates CR', () => {
    assert.deepEqual(splitFrontMatter('---\r\na: 1\r\n\r\na: 2\r\n---\r\nBody').meta, { a: '2' });
  });

  test('leaves a body that merely starts with a rule alone', () => {
    const text = '---\n\nA thematic break, not metadata.';
    assert.deepEqual(splitFrontMatter(text), { matched: false, meta: {}, body: text });
  });

  test('leaves a block with a line that is not key: value alone', () => {
    const text = '---\ntags: a\nnot a pair\n---\n\nBody.';
    assert.deepEqual(splitFrontMatter(text), { matched: false, meta: {}, body: text });
  });

  test('leaves an unterminated block alone', () => {
    const text = '---\ntags: a\n\nBody.';
    assert.deepEqual(splitFrontMatter(text), { matched: false, meta: {}, body: text });
  });

  test('reads an empty block as no metadata and the body that follows', () => {
    assert.deepEqual(splitFrontMatter('---\n---\n\n---\nfoo: bar\n---\nrest'), { matched: true, meta: {}, body: '---\nfoo: bar\n---\nrest' });
  });

  test('is total', () => {
    assert.deepEqual(splitFrontMatter(''), { matched: false, meta: {}, body: '' });
    assert.deepEqual(splitFrontMatter(null), { matched: false, meta: {}, body: '' });
    assert.deepEqual(splitFrontMatter(undefined), { matched: false, meta: {}, body: '' });
  });
});

describe('parseTags', () => {
  test('splits, trims and drops the empties', () => {
    assert.deepEqual(parseTags('a,  b ,,c'), ['a', 'b', 'c']);
  });

  test('tolerates the bracketed array style', () => {
    assert.deepEqual(parseTags('[a, b]'), ['a', 'b']);
  });

  test('is empty for nothing', () => {
    assert.deepEqual(parseTags(''), []);
    assert.deepEqual(parseTags(undefined), []);
  });
});

describe('parseDocument', () => {
  test('separates tags from the rest of the metadata', () => {
    assert.deepEqual(parseDocument('---\ntags: a, b\nlang: zh\nx: 1\n---\n\nBody.'), { meta: { lang: 'zh', x: '1' }, tags: ['a', 'b'], markdown: 'Body.' });
  });

  test('keeps a reserved or unknown key as written, so a reader loses nothing', () => {
    const { meta } = parseDocument('---\ntitle: In the file\nlayout: post\n---\nBody.');
    assert.deepEqual(meta, { title: 'In the file', layout: 'post' });
  });
});

describe('round trips', () => {
  test('survive every key, including ones this version never defined', () => {
    const meta = {
      lang: 'zh',
      re: `0x${'ab'.repeat(32)}`,
      supersedes: `taiko:0x${'cd'.repeat(32)}/1`,
      prev: `0x${'ef'.repeat(32)}`,
      series: 'Letters to Xiaoman',
      part: '3',
      somethingLater: 'kept',
    };
    const tags = ['letters home', '冬'];
    const markdown = '# 冬至\n\n正文。\n\n---\n\nA rule inside the body.';
    assert.deepEqual(parseDocument(buildDocument({ markdown, tags, meta })), { meta, tags, markdown });
  });

  test('survive a body with no metadata at all', () => {
    const markdown = 'Just prose.\n\nTwo paragraphs.';
    assert.deepEqual(parseDocument(buildDocument({ markdown })), { meta: {}, tags: [], markdown });
  });

  test('survive an empty body and an empty post', () => {
    assert.deepEqual(parseDocument(buildDocument({ markdown: '', tags: ['a'] })), { meta: {}, tags: ['a'], markdown: '' });
    assert.deepEqual(parseDocument(buildDocument({})), { meta: {}, tags: [], markdown: '' });
  });

  test('survive a body that starts with a byte-order mark', () => {
    const markdown = '﻿# Heading\n\nBody.';
    assert.equal(parseDocument(buildDocument({ markdown })).markdown, markdown);
    assert.equal(parseDocument(buildDocument({ markdown, tags: ['a'] })).markdown, markdown);
    const tricky = '﻿---\nk: v\n---\nrest';
    assert.equal(parseDocument(buildDocument({ markdown: tricky })).markdown, tricky);
  });
});
