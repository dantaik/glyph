// abi.js — the contract surface the webapp touches.
//
// One contract, one journal: Xueni.sol. Two reads, a plain
// `publish(bytes32,bytes)`, a post through a hook, and a post published on
// an author's behalf against their signature. Its Post event carries the
// hook as a second indexed field.

import { parseAbi } from 'viem';

export const abi = parseAbi([
  'function latestBlock(address author) view returns (uint256)',
  'function count(address author) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function publishDigest(address author, bytes32 title, bytes32 payloadHash, address hook, bytes32 hookDataHash, uint256 index, uint256 deadline) view returns (bytes32)',
  'function publish(bytes32 title, bytes payload) external',
  'function publish(bytes32 title, bytes payload, address hook, bytes hookData) external payable',
  'function publishFor(address author, bytes32 title, bytes payload, address hook, bytes hookData, uint256 deadline, bytes signature) external payable',
  'event Post(address indexed author, address indexed hook, uint256 index, uint256 prevBlock, bytes32 title)',
]);

/** The event every post is read from. */
export const POST_EVENT = abi.find((x) => x.type === 'event' && x.name === 'Post');

/** The fan-out hook (hooks/MultiHook.sol): its data is `abi.encode(hooks, datas, values)`. */
export const MULTI_HOOK_DATA_TYPES = [
  { name: 'hooks', type: 'address[]' },
  { name: 'datas', type: 'bytes[]' },
  { name: 'values', type: 'uint256[]' },
];

/**
 * EIP-712: what an author signs for a relayed post — the struct Xueni's
 * `publishDigest` hashes, under the domain `Xueni` / `1` / the chain / the
 * contract. `index` is the author's next post index.
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
  name: 'Xueni',
  version: '1',
  chainId: Number(chainId),
  verifyingContract,
});
