// convert.test.js — the whole trip, both ways.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPostError, MalformedCallDataError, UnsupportedFormatVersionError, callDataToPost as convertWith, postToCallData as toCallDataWith } from '../src/index.js';
import { callDataToPost, encodePost, normalisePost, postToCallData, nodeBrotli } from '../src/node.js';

const HASH = `0x${'ab'.repeat(32)}`;

const POSTS = [
  { title: 'Just prose', tags: [], markdown: 'Just prose.\n\nTwo paragraphs.\n', meta: {} },
  { title: 'A weekend in the hills', tags: ['family', 'travel', 'mountains'], markdown: '# A weekend in the hills\nThe body…\n', meta: {} },
  {
    title: '关于外婆的香樟木箱',
    tags: ['letters home', '冬'],
    markdown: '# 冬至\n\n正文。\n\n---\n\nA rule inside the body.\n',
    meta: { lang: 'zh', re: HASH, supersedes: `taiko:${HASH}/1`, prev: HASH, series: 'Letters to Xiaoman', part: '3', somethingLater: 'kept' },
  },
  { title: '', tags: [], markdown: '', meta: {} },
  { title: '😀'.repeat(8), tags: ['emoji'], markdown: 'one\r\ntwo\r\n', meta: {} },
  { title: 'Tricky', tags: [], markdown: '---\nfoo: bar\n---\n\nrest', meta: {} },
];

describe('postToCallData / callDataToPost', () => {
  test('round-trip every kind of post to its canonical form', () => {
    for (const post of POSTS) {
      const callData = postToCallData(post);
      assert.match(callData, /^0x70a74532[0-9a-f]+$/);
      const back = callDataToPost(callData);
      const { version, text, compressedBytes, ...fields } = back;
      assert.equal(version, 1);
      assert.deepEqual(fields, normalisePost(post));
      assert.equal(typeof text, 'string');
      assert.ok(compressedBytes > 0);
      assert.equal(compressedBytes, nodeBrotli.compress(new TextEncoder().encode(text)).length);
    }
  });

  test('encodePost hands back every layer at once', () => {
    const enc = encodePost({ title: 'A letter', tags: ['home'], markdown: 'Body.\n', meta: { lang: 'en' } });
    assert.equal(enc.version, 1);
    assert.equal(enc.title, `0x41206c6574746572${'00'.repeat(24)}`);
    assert.equal(enc.text, '---\ntags: home\nlang: en\n---\n\nBody.\n');
    assert.deepEqual(enc.payload, nodeBrotli.compress(new TextEncoder().encode(enc.text)));
    assert.equal(enc.callData, postToCallData({ title: 'A letter', tags: ['home'], markdown: 'Body.\n', meta: { lang: 'en' } }));
    assert.equal(callDataToPost(enc.callData).text, enc.text);
  });

  test('the calldata is deterministic: the same post, the same bytes, whatever the field order', () => {
    const a = postToCallData({ title: 't', tags: ['b', 'a'], markdown: 'm', meta: { z: '1', lang: 'en' } });
    const b = postToCallData({ meta: { lang: 'en', z: '1' }, markdown: 'm', tags: ['b', 'a'], title: 't' });
    assert.equal(a, b);
  });

  test('a decoded post can be encoded again to the same calldata', () => {
    for (const post of POSTS) {
      const callData = postToCallData(post);
      assert.equal(postToCallData(callDataToPost(callData)), callData);
    }
  });

  test('refuses a post it cannot write, with every problem named', () => {
    assert.throws(() => postToCallData({ title: 'x'.repeat(33), tags: ['a,b'] }), (e) => e instanceof InvalidPostError && e.problems.length === 2);
    assert.throws(() => postToCallData({ title: 't', meta: { title: 'twice' } }), (e) => e.problems[0].code === 'KEY_RESERVED');
  });

  test('refuses a version it does not write, before doing anything else', () => {
    assert.throws(() => postToCallData({ title: 't' }, { version: 2 }), UnsupportedFormatVersionError);
  });

  test('refuses calldata that is not a publish() call', () => {
    assert.throws(() => callDataToPost('0xdeadbeef'), MalformedCallDataError);
  });

  test('the environment-agnostic entry wants a codec', () => {
    assert.throws(() => toCallDataWith({ title: 't' }), /brotli codec is required/);
    assert.throws(() => convertWith(postToCallData({ title: 't' })), /brotli codec is required/);
    assert.equal(toCallDataWith({ title: 't' }, { brotli: nodeBrotli }), postToCallData({ title: 't' }));
  });

  test('a document written by a foreign tool with a title key decodes with it kept, and cannot be re-encoded as is', async () => {
    const { encodePayload, encodePublishCallData, encodeTitle } = await import('../src/node.js');
    const text = '---\ntitle: In the file\ntags: a\n---\nBody.';
    const data = encodePublishCallData({ title: encodeTitle('On chain'), payload: encodePayload(text) });
    const post = callDataToPost(data);
    assert.equal(post.title, 'On chain');
    assert.deepEqual(post.meta, { title: 'In the file' });
    assert.throws(() => postToCallData(post), (e) => e.problems[0].code === 'KEY_RESERVED');
    // Dropping the key is the caller's decision, and then it writes.
    const { title: _dropped, ...meta } = post.meta;
    assert.equal(callDataToPost(postToCallData({ ...post, meta })).text, '---\ntags: a\n---\n\nBody.');
  });
});
