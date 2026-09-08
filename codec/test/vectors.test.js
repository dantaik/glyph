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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLISH_SELECTOR, buildDocument, encodeTitle, normalisePost } from '../src/index.js';
import { callDataToPost, encodePost } from '../src/node.js';

const { format, selector, vectors } = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

describe('the vectors', () => {
  test('describe format version 1 and the publish() selector', () => {
    assert.equal(format, 1);
    assert.equal(selector, PUBLISH_SELECTOR);
    assert.ok(vectors.length >= 5);
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
        const { version, text, compressedBytes, ...post } = callDataToPost(vector.callData);
        assert.equal(version, 1);
        assert.deepEqual(post, normalisePost(vector.post));
        assert.equal(text, vector.text);
        assert.equal(compressedBytes, vector.compressedBytes);
      });

      test('the reference codec still produces the vector bytes', () => {
        const { callData } = encodePost(vector.post);
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
