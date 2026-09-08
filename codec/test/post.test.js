// post.test.js — validation, normalisation, and the grammar of values.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPostError, formatPostRef, normalisePost, parsePostRef, validatePost } from '../src/index.js';

const HASH = `0x${'ab'.repeat(32)}`;
const byCode = (problems) => problems.map((p) => `${p.level}:${p.path}:${p.code}`);

describe('validatePost', () => {
  test('is happy with a good post', () => {
    const { ok, problems } = validatePost({ title: 'A letter', tags: ['home'], markdown: 'Body.', meta: { lang: 'zh', re: HASH, series: 'Winter', part: '2' } });
    assert.equal(ok, true);
    assert.deepEqual(problems, []);
  });

  test('reports errors and warnings together, in field order', () => {
    const { ok, problems } = validatePost({
      title: 'x'.repeat(33),
      tags: ['a,b'],
      markdown: 'Body.',
      meta: { title: 'no', part: '0', re: 'nope', lang: 'not a tag!', series: '字'.repeat(65), supersedes: `${HASH}/x` },
    });
    assert.equal(ok, false);
    assert.deepEqual(byCode(problems), [
      'error:title:TITLE_TOO_LONG',
      'error:tags:TAG_COMMA',
      'error:meta.title:KEY_RESERVED',
      'warning:meta.lang:LANG_SHAPE',
      'warning:meta.re:REF_SYNTAX',
      'warning:meta.supersedes:REF_SYNTAX',
      'warning:meta.series:SERIES_LENGTH',
      'warning:meta.part:PART_SHAPE',
    ]);
  });

  test('warnings alone leave a post writable', () => {
    const { ok, problems } = validatePost({ title: '', tags: [], markdown: '', meta: { part: '3' } });
    assert.equal(ok, true);
    assert.deepEqual(byCode(problems), ['warning:title:TITLE_EMPTY', 'warning:meta.part:PART_WITHOUT_SERIES']);
  });

  test('a field of the wrong type is reported, and nothing is thrown', () => {
    assert.deepEqual(byCode(validatePost({ title: 't', tags: 42 }).problems), ['error:tags:TYPE']);
    assert.deepEqual(byCode(validatePost({ title: 't', markdown: [] }).problems), ['error:markdown:TYPE']);
    assert.deepEqual(byCode(validatePost({ title: 't', meta: 'no' }).problems), ['error:meta:TYPE']);
    assert.deepEqual(byCode(validatePost(null).problems), ['error::TYPE']);
    assert.deepEqual(byCode(validatePost('a string').problems), ['error::TYPE']);
  });

  test('accepts the shapes a loose caller sends: a tags string, numbers, missing fields', () => {
    assert.equal(validatePost({ title: 't', tags: 'a, b', meta: { part: 2, series: 'S' } }).ok, true);
    assert.equal(validatePost({ title: 't' }).ok, true);
  });
});

describe('normalisePost', () => {
  test('is the canonical form a reader gets back', () => {
    const post = normalisePost({ title: ' T ', tags: [' a ', '', 'b'], markdown: ' body ', meta: { lang: ' zh ', part: 3, empty: '', tags: ['ignored'] } });
    assert.deepEqual(post, { title: ' T ', tags: ['a', 'b'], markdown: ' body ', meta: { lang: 'zh', part: '3' } });
  });

  test('folds meta.tags into tags when tags is not given', () => {
    assert.deepEqual(normalisePost({ title: 't', meta: { tags: 'x, y' } }).tags, ['x', 'y']);
    assert.deepEqual(normalisePost({ title: 't', meta: { tags: ['x'] } }), { title: 't', tags: ['x'], markdown: '', meta: {} });
  });

  test('is idempotent', () => {
    const once = normalisePost({ title: 't', tags: ['b', 'a'], markdown: 'm', meta: { z: '1', a: '2', part: 1, series: 'S' } });
    assert.deepEqual(normalisePost(once), once);
  });

  test('throws with every error-level problem', () => {
    assert.throws(
      () => normalisePost({ title: 'x'.repeat(40), tags: ['a,b'] }),
      (err) => err instanceof InvalidPostError && err.code === 'INVALID_POST' && err.problems.length === 2 && /title: 40 bytes/.test(err.message),
    );
  });
});

describe('post references', () => {
  test('parse the bare, indexed and chain-qualified forms', () => {
    assert.deepEqual(parsePostRef(HASH), { chain: null, txHash: HASH, eventIndex: 0 });
    assert.deepEqual(parsePostRef(`${HASH}/2`), { chain: null, txHash: HASH, eventIndex: 2 });
    assert.deepEqual(parsePostRef(`taiko:${HASH}`), { chain: 'taiko', txHash: HASH, eventIndex: 0 });
    assert.deepEqual(parsePostRef(`ethereum:${HASH}/1`), { chain: 'ethereum', txHash: HASH, eventIndex: 1 });
    assert.deepEqual(parsePostRef(`taiko-hoodi:${HASH}`), { chain: 'taiko-hoodi', txHash: HASH, eventIndex: 0 });
  });

  test('lower-case the hash, so the same post is the same reference', () => {
    assert.equal(parsePostRef(`0x${'AB'.repeat(32)}`).txHash, HASH);
  });

  test('refuse what is not a reference', () => {
    for (const bad of ['', '0x1234', `${HASH}/`, `${HASH}/01`, `${HASH}/-1`, `Taiko:${HASH}`, `https://x/tx/${HASH}`, ` ${HASH}`, null, undefined]) {
      assert.equal(parsePostRef(bad), null, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  test('format in the shortest honest form', () => {
    assert.equal(formatPostRef({ txHash: HASH }), HASH);
    assert.equal(formatPostRef({ txHash: HASH.toUpperCase().replace('0X', '0x'), eventIndex: 2 }), `${HASH}/2`);
    assert.equal(formatPostRef({ chain: 'taiko', txHash: HASH }), `taiko:${HASH}`);
    assert.equal(formatPostRef({ chain: 'taiko', txHash: HASH }, { ownChain: 'taiko' }), HASH);
    assert.equal(formatPostRef({ chain: 'ethereum', txHash: HASH, eventIndex: 1 }, { ownChain: 'taiko' }), `ethereum:${HASH}/1`);
  });

  test('round trip', () => {
    for (const ref of [
      { chain: null, txHash: HASH, eventIndex: 0 },
      { chain: 'taiko', txHash: HASH, eventIndex: 4 },
      { chain: 'ethereum', txHash: HASH, eventIndex: 0 },
    ]) {
      assert.deepEqual(parsePostRef(formatPostRef(ref)), ref);
    }
  });
});
