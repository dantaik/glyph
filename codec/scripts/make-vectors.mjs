// make-vectors.mjs — regenerate test/vectors.json from the posts in it.
//
// The vectors pin three things: the document a post becomes (normative),
// the bytes32 its title becomes (normative), and the calldata the REFERENCE
// codec produces for it (brotli's output, which the specification does not
// fix — see SPEC.md §5.3). When a new Node ships a brotli whose output for
// the same input differs, vectors.test.js says so, and this script writes
// the new bytes once a human has decided that is what happened:
//
//     npm run vectors
//
// The posts themselves are kept in the file, so they are the input here. A
// vector with a `call` — `{ hook, hookData }`, or `{ relayed: { author,
// deadline, signature } }` — is written in that call form.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PUBLISH_FOR_SELECTOR, PUBLISH_SELECTOR, PUBLISH_WITH_HOOK_SELECTOR, encodePost, encodeRelayedPost } from '../src/node.js';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, '..', 'test', 'vectors.json');
const file = JSON.parse(readFileSync(path, 'utf8'));

file.selectors = { publish: PUBLISH_SELECTOR, publishWithHook: PUBLISH_WITH_HOOK_SELECTOR, publishFor: PUBLISH_FOR_SELECTOR };
file.vectors = file.vectors.map(({ name, post, call }) => {
  const enc = call?.relayed
    ? encodeRelayedPost(post, { ...call.relayed, hook: call.hook ?? null, hookData: call.hookData ?? null })
    : encodePost(post, { hook: call?.hook ?? null, hookData: call?.hookData ?? null });
  const { title, text, callData, payload } = enc;
  return { name, post, ...(call ? { call } : {}), title, text, compressedBytes: payload.length, callData };
});
file.generatedWith = { node: process.version };
writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
console.log(`${file.vectors.length} vectors written to ${path}`);
