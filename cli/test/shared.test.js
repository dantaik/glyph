// shared.test.js — the modules this package borrows still load in plain Node.
//
// The CLI imports five modules straight out of `webapp/src/lib/` (see
// src/shared.js) so that a post published from a terminal is byte-for-byte
// what the browser would have written. That only works while those modules
// stay free of Vite, the DOM and React — and nothing in the webapp's own
// tests would notice if one of them quietly grew an `import.meta.env` or a
// `window`, because over there both exist.
//
// So this file is the tripwire. It imports each of the five in a bare Node
// process and uses it. If a future change makes one of them browser-only, it
// fails HERE, loudly, next to the code that depends on it — rather than at
// somebody's terminal months later.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('payloadText.js loads in plain Node and round-trips a document', async () => {
  const mod = await import('../../webapp/src/lib/payloadText.js');
  const text = mod.buildPayloadText({ markdown: '# Hello', meta: { tags: ['a', 'b'], lang: 'en' } });
  assert.equal(text, '---\ntags: a, b\nlang: en\n---\n\n# Hello');
  const back = mod.parsePayloadText(text);
  assert.deepEqual(back.tags, ['a', 'b']);
  assert.equal(back.markdown, '# Hello');
  assert.ok(Array.isArray(mod.FRONT_MATTER_KEYS));
});

test('title.js loads in plain Node and measures UTF-8, not characters', async () => {
  const mod = await import('../../webapp/src/lib/title.js');
  assert.equal(mod.TITLE_MAX_BYTES, 32);
  assert.equal(mod.titleByteLength('abc'), 3);
  assert.equal(mod.titleByteLength('雪泥'), 6);
  assert.equal(mod.decodeTitle(mod.encodeTitle('雪泥鸿爪')), '雪泥鸿爪');
});

test('abi.js loads in plain Node and describes the contract', async () => {
  const mod = await import('../../webapp/src/lib/abi.js');
  const names = mod.abi.map((entry) => entry.name);
  assert.deepEqual(names.sort(), ['Post', 'count', 'latestBlock', 'publish']);
  assert.equal(mod.POST_EVENT.type, 'event');
});

test('chains.js loads in plain Node and knows the address and the chains', async () => {
  const mod = await import('../../webapp/src/lib/chains.js');
  // The contract is CREATE2-deployed to the same address everywhere, which is
  // why plain Node can know it without any build-time configuration.
  assert.match(mod.DEFAULT_GLYPH_ADDRESS, /^0x[0-9a-fA-F]{40}$/);
  assert.deepEqual(mod.SELECTABLE_CHAIN_IDS, [1, 167000]);
  assert.equal(mod.chainSlug(167000), 'taiko');
  assert.equal(mod.chainFromSlug('ethereum'), 1);
  assert.ok(mod.defaultRpcs(1).length > 0);
});

test('limits.js loads in plain Node and carries the ceilings', async () => {
  const mod = await import('../../webapp/src/lib/limits.js');
  assert.equal(mod.MAX_TX_BYTES, 131_072);
  assert.equal(mod.MAX_CALLDATA_BYTES, mod.MAX_TX_BYTES - 1_024);
});

test('src/shared.js re-exports every borrowed module', async () => {
  const shared = await import('../src/shared.js');
  for (const name of [
    'abi',
    'POST_EVENT',
    'CHAINS',
    'DEFAULT_GLYPH_ADDRESS',
    'SELECTABLE_CHAIN_IDS',
    'chainFromSlug',
    'chainSlug',
    'defaultRpcs',
    'getChain',
    'MAX_CALLDATA_BYTES',
    'MAX_TX_BYTES',
    'FRONT_MATTER_KEYS',
    'buildPayloadText',
    'parsePayloadText',
    'TITLE_MAX_BYTES',
    'decodeTitle',
    'encodeTitle',
    'titleByteLength',
  ]) {
    assert.ok(shared[name] != null, `shared.js should export ${name}`);
  }
});
