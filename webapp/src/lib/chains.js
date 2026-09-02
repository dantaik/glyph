// chains.js — the chains Glyph is deployed on, and how to reach them.
//
// The contract is CREATE2-deployed to the SAME address on every EVM chain,
// so a chain is fully described by its id, its explorer and a list of RPC
// endpoints. The list is ordered: the reader tries the first and falls back
// to the next when one fails, so a flaky public node degrades instead of
// breaking the page.

import { mainnet, sepolia, taiko } from 'viem/chains';

/** Taiko Hoodi — not in viem's registry, so it is spelled out here. */
const taikoHoodi = {
  id: 167013,
  name: 'Taiko Hoodi',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hoodi.taiko.xyz'] } },
  blockExplorers: { default: { name: 'Taikoscan', url: 'https://hoodi.taikoscan.io' } },
  testnet: true,
};

export const CHAINS = {
  1: {
    id: 1,
    name: '以太坊',
    viem: mainnet,
    explorer: 'https://etherscan.io',
    // Both serve the wide eth_getLogs ranges the home feed needs (10k on
    // drpc's free tier). Endpoints that refuse getLogs outright — publicnode
    // wants a paid token — are useless here however reliable they look.
    rpcs: ['https://eth.drpc.org', 'https://rpc.mevblocker.io'],
    // Blocks per getLogs window. Under drpc's 10,000 free-tier ceiling; a
    // stricter node just makes the sweep shrink its window and carry on.
    logWindow: 9000,
    wallet: {
      chainName: 'Ethereum Mainnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  167000: {
    id: 167000,
    name: 'Taiko',
    viem: taiko,
    explorer: 'https://taikoscan.io',
    rpcs: ['https://rpc.mainnet.taiko.xyz', 'https://taiko.drpc.org'],
    // Both cap getLogs at 10,000 blocks. Taiko's blocks are far quicker than
    // Ethereum's, so a window covers much less wall-clock time.
    logWindow: 9000,
    wallet: {
      chainName: 'Taiko Alethia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia 测试网',
    viem: sepolia,
    explorer: 'https://sepolia.etherscan.io',
    rpcs: ['https://sepolia.drpc.org'],
    logWindow: 9000,
    testnet: true,
    wallet: {
      chainName: 'Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  167013: {
    id: 167013,
    name: 'Taiko Hoodi 测试网',
    viem: taikoHoodi,
    explorer: 'https://hoodi.taikoscan.io',
    rpcs: ['https://rpc.hoodi.taiko.xyz'],
    logWindow: 9000,
    testnet: true,
    wallet: {
      chainName: 'Taiko Hoodi',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
};

/**
 * Chains offered in the header switcher and the settings dialog — the ones
 * Glyph is actually deployed and read on. The testnets above stay resolvable
 * (VITE_CHAIN_ID, an older stored preference) without cluttering the menu.
 */
export const SELECTABLE_CHAIN_IDS = [1, 167000];

export const DEFAULT_CHAIN_ID = 1;

/** Chain entry for `id`, or the default chain's when it isn't one we know. */
export const getChain = (id) => CHAINS[Number(id)] ?? CHAINS[DEFAULT_CHAIN_ID];

export const isKnownChain = (id) => Number(id) in CHAINS;

/** Default RPC endpoints for `id`, in preference order. */
export const defaultRpcs = (id) => [...getChain(id).rpcs];

/** Blocks per getLogs window on `id`. */
export const logWindow = (id) => getChain(id).logWindow ?? 800;

/** Params for wallet_addEthereumChain, built from the same single source. */
export function walletChainParams(id) {
  const chain = CHAINS[Number(id)];
  if (!chain) return null;
  return {
    chainName: chain.wallet.chainName,
    nativeCurrency: chain.wallet.nativeCurrency,
    rpcUrls: [...chain.rpcs],
    blockExplorerUrls: [chain.explorer],
  };
}
