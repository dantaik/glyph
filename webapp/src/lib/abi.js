// abi.js — the Glyph contract surface the webapp touches.

import { parseAbi } from 'viem';

export const abi = parseAbi([
  'function latestBlock(address author) view returns (uint256)',
  'function count(address author) view returns (uint256)',
  'function publish(bytes32 title, bytes payload) external',
  'event Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)',
]);

export const POST_EVENT = abi.find((x) => x.type === 'event' && x.name === 'Post');
