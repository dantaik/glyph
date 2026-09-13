// abi.js — the contract surfaces the webapp touches.
//
// Two contracts, one journal. `abi` is v1 (Blog.sol): what every post so
// far was written with, and what the command-line tool imports. `abiV2` is
// GlyphV2.sol: the same two reads and the same plain `publish(bytes32,bytes)`
// (byte-identical, so a plain v2 post costs what a v1 post costs), plus a
// post through a hook and a post published on an author's behalf. Its Post
// event carries the hook as a second indexed field.

import { parseAbi } from 'viem';

export const abi = parseAbi([
  'function latestBlock(address author) view returns (uint256)',
  'function count(address author) view returns (uint256)',
  'function publish(bytes32 title, bytes payload) external',
  'event Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)',
]);

export const POST_EVENT = abi.find((x) => x.type === 'event' && x.name === 'Post');

export const abiV2 = parseAbi([
  'function latestBlock(address author) view returns (uint256)',
  'function count(address author) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function publishDigest(address author, bytes32 title, bytes32 payloadHash, address hook, bytes32 hookDataHash, uint256 index, uint256 deadline) view returns (bytes32)',
  'function publish(bytes32 title, bytes payload) external',
  'function publish(bytes32 title, bytes payload, address hook, bytes hookData) external payable',
  'function publishFor(address author, bytes32 title, bytes payload, address hook, bytes hookData, uint256 deadline, bytes signature) external payable',
  'event Post(address indexed author, address indexed hook, uint256 index, uint256 prevBlock, bytes32 title)',
]);

export const POST_EVENT_V2 = abiV2.find((x) => x.type === 'event' && x.name === 'Post');

/** The ABI of one contract version. */
export const abiFor = (version) => (Number(version) === 2 ? abiV2 : abi);

/** The Post event of one contract version. */
export const postEventFor = (version) => (Number(version) === 2 ? POST_EVENT_V2 : POST_EVENT);

/** Every Post event the reader decodes, whichever contract emitted it. */
export const POST_EVENTS = [POST_EVENT, POST_EVENT_V2];

/** The fan-out hook (hooks/MultiHook.sol): its data is `abi.encode(hooks, datas, values)`. */
export const MULTI_HOOK_DATA_TYPES = [
  { name: 'hooks', type: 'address[]' },
  { name: 'datas', type: 'bytes[]' },
  { name: 'values', type: 'uint256[]' },
];

/**
 * EIP-712: what an author signs for a relayed post — the struct GlyphV2's
 * `publishDigest` hashes, under the domain `Glyph` / `2` / the chain / the
 * contract. `index` is the author's next post index on that contract.
 */
export const PUBLISH_TYPES = {
  Publish: [
    { name: 'author', type: 'address' },
    { name: 'title', type: 'bytes32' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'hook', type: 'address' },
    { name: 'hookDataHash', type: 'bytes32' },
    { name: 'index', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export const publishDomain = (chainId, verifyingContract) => ({
  name: 'Glyph',
  version: '2',
  chainId: Number(chainId),
  verifyingContract,
});
