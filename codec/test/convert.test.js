// convert.test.js — the whole trip, both ways.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DocumentTooLargeError,
  InvalidPostError,
  MalformedCallDataError,
  UnsupportedFormatVersionError,
  callDataToPost as convertWith,
  encodePublishCallData,
  encodeTitle,
  postToCallData as toCallDataWith,
} from '../src/index.js';
import { callDataToPost, encodePost, encodeRelayedPost, normalisePost, postToCallData, nodeBrotli } from '../src/node.js';

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
      const { version, text, compressedBytes, call, ...fields } = back;
      assert.equal(version, 1);
      assert.deepEqual(fields, normalisePost(post));
      assert.deepEqual(call, { form: 'publish', title: call.title, payload: call.payload, hook: null, hookData: new Uint8Array(0), relayed: null });
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

  test('a hook rides along, and comes back with the post', () => {
    const post = { title: 'Through a hook', tags: ['home'], markdown: 'Body.\n', meta: {} };
    const hook = '0x00000000000000000000000000000000000000ab';
    const enc = encodePost(post, { hook, hookData: '0xc0ffee' });
    assert.equal(enc.callData.slice(0, 10), '0xcf5f0bff');
    assert.equal(enc.text, '---\ntags: home\n---\n\nBody.\n');
    const back = callDataToPost(enc.callData);
    assert.equal(back.title, 'Through a hook');
    assert.equal(back.call.form, 'publishWithHook');
    assert.equal(back.call.hook, hook);
    assert.deepEqual(back.call.hookData, new Uint8Array([0xc0, 0xff, 0xee]));
    assert.equal(back.call.relayed, null);
    // The same post without a hook is the plain call, and the same document.
    assert.equal(postToCallData(post).slice(0, 10), '0x70a74532');
    assert.equal(callDataToPost(postToCallData(post)).text, enc.text);
  });

  test('a relayed post carries the author of record, and comes back with it', () => {
    const post = { title: 'Relayed', tags: [], markdown: 'Body.\n', meta: {} };
    const author = '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5';
    const signature = new Uint8Array(65).fill(7);
    const enc = encodeRelayedPost(post, { author, deadline: 1_800_000_000, signature });
    assert.equal(enc.callData.slice(0, 10), '0x80e41e43');
    assert.equal(enc.author, author);
    assert.deepEqual(enc.payload, encodePost(post).payload);
    const back = callDataToPost(enc.callData);
    assert.equal(back.title, 'Relayed');
    assert.equal(back.markdown, 'Body.\n');
    assert.equal(back.call.form, 'publishFor');
    assert.equal(back.call.hook, null);
    assert.deepEqual(back.call.relayed, { author: author.toLowerCase(), deadline: '1800000000', signature });
    // With a hook too.
    const hooked = encodeRelayedPost(post, { author, deadline: 1, signature, hook: '0x00000000000000000000000000000000000000ab', hookData: new Uint8Array([1]) });
    assert.equal(callDataToPost(hooked.callData).call.hook, '0x00000000000000000000000000000000000000ab');
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

  test('refuses a decompression bomb published as a post, and passes the bound through', () => {
    const bomb = nodeBrotli.compress(new Uint8Array(8 * 1024 * 1024).fill(0x20));
    const callData = encodePublishCallData({ title: encodeTitle('a bomb'), payload: bomb });
    assert.throws(() => callDataToPost(callData), (e) => e instanceof DocumentTooLargeError && e.code === 'DOCUMENT_TOO_LARGE');
    assert.equal(callDataToPost(callData, { maxDocumentBytes: 16 * 1024 * 1024 }).markdown.length, 8 * 1024 * 1024);
    assert.throws(() => postToCallData({ title: 'big', markdown: 'x'.repeat(100) }, { maxDocumentBytes: 50 }), DocumentTooLargeError);
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
