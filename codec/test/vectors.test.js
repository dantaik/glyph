// vectors.test.js — the test vectors in SPEC.md's appendix, checked.
//
// Three claims per vector. The document and the bytes32 are what the
// specification fixes, so those two are the format. The calldata carries
// brotli's output, which the specification does NOT fix (§5.3: any
// conforming stream is a valid payload) — but the reference codec is meant
// to be stable, every post so far was written by it, and a change to its
// bytes is worth knowing about. So decoding a vector's calldata must give
// the post back (encoder-independent), and re-encoding must give the same
// calldata (encoder stability); when the second fails alone, read
// scripts/make-vectors.mjs before touching anything.
//
// A vector with a `call` is a post through a hook, or one relayed on the
// author's behalf: the same document, in one of the other two call forms.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PUBLISH_FOR_SELECTOR,
  PUBLISH_SELECTOR,
  PUBLISH_WITH_HOOK_SELECTOR,
  buildDocument,
  bytesToHex,
  encodeTitle,
  normalisePost,
} from '../src/index.js';
import { callDataToPost, encodePost, encodeRelayedPost } from '../src/node.js';

const { format, selector, selectors, vectors } = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

/** The calldata the reference codec writes for a vector, in its call form. */
function encodeVector(vector) {
  const call = vector.call ?? {};
  if (call.relayed) return encodeRelayedPost(vector.post, { ...call.relayed, hook: call.hook ?? null, hookData: call.hookData ?? null });
  return encodePost(vector.post, { hook: call.hook ?? null, hookData: call.hookData ?? null });
}

describe('the vectors', () => {
  test('describe format version 1 and the three selectors', () => {
    assert.equal(format, 1);
    assert.equal(selector, PUBLISH_SELECTOR);
    assert.deepEqual(selectors, { publish: PUBLISH_SELECTOR, publishWithHook: PUBLISH_WITH_HOOK_SELECTOR, publishFor: PUBLISH_FOR_SELECTOR });
    assert.ok(vectors.length >= 7);
    assert.ok(vectors.some((v) => v.call?.hook), 'a vector through a hook');
    assert.ok(vectors.some((v) => v.call?.relayed), 'a relayed vector');
  });

  for (const vector of vectors) {
    describe(vector.name, () => {
      test('the document is what the specification says', () => {
        assert.equal(buildDocument(vector.post), vector.text);
      });

      test('the title is the bytes32 the specification says', () => {
        assert.equal(encodeTitle(vector.post.title), vector.title);
        assert.match(vector.title, /^0x[0-9a-f]{64}$/);
      });

      test('decoding the calldata gives the post back', () => {
        const { version, text, compressedBytes, call, ...post } = callDataToPost(vector.callData);
        assert.equal(version, 1);
        assert.deepEqual(post, normalisePost(vector.post));
        assert.equal(text, vector.text);
        assert.equal(compressedBytes, vector.compressedBytes);
      });

      test('decoding the calldata says which call carried it', () => {
        const { call } = callDataToPost(vector.callData);
        const expected = vector.call ?? {};
        const form = expected.relayed ? 'publishFor' : expected.hook || expected.hookData ? 'publishWithHook' : 'publish';
        assert.equal(call.form, form);
        assert.equal(vector.callData.slice(0, 10), selectors[form]);
        assert.equal(call.hook, expected.hook?.toLowerCase() ?? null);
        assert.equal(bytesToHex(call.hookData), expected.hookData ?? '0x');
        if (expected.relayed) {
          assert.deepEqual(
            { ...call.relayed, signature: bytesToHex(call.relayed.signature) },
            { author: expected.relayed.author.toLowerCase(), deadline: expected.relayed.deadline, signature: expected.relayed.signature },
          );
        } else {
          assert.equal(call.relayed, null);
        }
      });

      test('the reference codec still produces the vector bytes', () => {
        const { callData } = encodeVector(vector);
        assert.equal(
          callData,
          vector.callData,
          'brotli produced different bytes for the same document than when this vector was made — ' +
            'the format is unchanged (decoding still passes), but the reference encoder is not; see scripts/make-vectors.mjs',
        );
      });
    });
  }
});
