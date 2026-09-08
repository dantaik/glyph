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

describe('control characters and bidirectional controls (SPEC §10.3)', () => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const CSI = String.fromCharCode(0x9b); // C1
  const RLO = String.fromCharCode(0x202e);
  const FSI = String.fromCharCode(0x2068);

  test('a terminal escape anywhere but the body is an error, in every field at once', () => {
    const { ok, problems } = validatePost({ title: `t${ESC}[2J`, tags: [`a${BEL}`], markdown: 'fine', meta: { series: `s${CSI}`, lang: 'zh' } });
    assert.equal(ok, false);
    assert.deepEqual(byCode(problems), ['error:title:CONTROL_CHAR', 'error:tags:CONTROL_CHAR', 'error:meta.series:CONTROL_CHAR']);
  });

  test('a NUL in the title keeps its own code, and a line break in a value its own', () => {
    assert.deepEqual(byCode(validatePost({ title: `a${String.fromCharCode(0)}b` }).problems), ['error:title:TITLE_NUL']);
    assert.deepEqual(byCode(validatePost({ title: 't', meta: { lang: 'zh\nen' } }).problems), ['error:meta.lang:VALUE_LINE_BREAK']);
    assert.deepEqual(byCode(validatePost({ title: 'a\nb' }).problems), ['error:title:CONTROL_CHAR']);
  });

  test('TAB is allowed everywhere; the body may also hold LF, FF and CR', () => {
    assert.equal(validatePost({ title: 'a\tb', tags: ['x\ty'], markdown: 'one\r\ntwo\f\tthree', meta: { series: 'a\tb' } }).ok, true);
    assert.deepEqual(byCode(validatePost({ title: 't', markdown: `x${BEL}` }).problems), ['error:markdown:CONTROL_CHAR']);
    assert.deepEqual(byCode(validatePost({ title: 't', markdown: `x${String.fromCharCode(0x0b)}` }).problems), ['error:markdown:CONTROL_CHAR']);
  });

  test('bidirectional controls are warned about, not refused', () => {
    const { ok, problems } = validatePost({ title: `a${RLO}b`, tags: [`t${FSI}`], markdown: `code ${RLO} here`, meta: { series: `s${FSI}` } });
    assert.equal(ok, true);
    assert.deepEqual(byCode(problems), ['warning:title:BIDI_CONTROL', 'warning:tags:BIDI_CONTROL', 'warning:meta.series:BIDI_CONTROL', 'warning:markdown:BIDI_CONTROL']);
    // Ordinary marks (LRM, RLM) are not controls and pass silently.
    assert.deepEqual(validatePost({ title: `a${String.fromCharCode(0x200f)}b` }).problems, []);
  });

  test('the writer refuses what validatePost calls an error, and writes what it only warns about', () => {
    assert.throws(() => normalisePost({ title: `t${ESC}` }), InvalidPostError);
    assert.equal(normalisePost({ title: `t${RLO}` }).title, `t${RLO}`);
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
