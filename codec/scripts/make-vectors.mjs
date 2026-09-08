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
// The posts themselves are kept in the file, so they are the input here.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodePost } from '../src/node.js';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, '..', 'test', 'vectors.json');
const file = JSON.parse(readFileSync(path, 'utf8'));

file.vectors = file.vectors.map(({ name, post }) => {
  const { title, text, callData, payload } = encodePost(post);
  return { name, post, title, text, compressedBytes: payload.length, callData };
});
file.generatedWith = { node: process.version };
writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
console.log(`${file.vectors.length} vectors written to ${path}`);
