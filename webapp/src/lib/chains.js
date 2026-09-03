// chains.js — the chains Glyph is deployed on, and how to reach them.
//
// The contract is CREATE2-deployed to the SAME address on every EVM chain,
// so a chain is fully described by its id, its explorer, an ordered list of
// RPC endpoints and the block it was deployed in. The list is ordered: the
// reader tries the first and falls back to the next when one fails, so a
// flaky public node degrades instead of breaking the page.

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
    name: 'Ethereum',
    slug: 'ethereum',
    viem: mainnet,
    explorer: 'https://etherscan.io',
    // Both serve the wide eth_getLogs ranges the home feed needs (10k on
    // drpc's free tier). Endpoints that refuse getLogs outright — publicnode
    // wants a paid token — are useless here however reliable they look.
    rpcs: ['https://eth.drpc.org', 'https://rpc.mevblocker.io'],
    // Blocks per getLogs window. Under drpc's 10,000 free-tier ceiling; a
    // stricter node just makes the sweep shrink its window and carry on.
    logWindow: 9000,
    // THE MOST BLOCKS ONE SCAN READS FROM THE NODE — one page load, or one
    // "Load earlier posts" click. Blocks already read are free and don't count.
    // 270,000 blocks ≈ 37 days of Ethereum at 12s a block.
    scanBlocks: 270_000,
    // The block the contract was deployed in (tx 0x5f16…ce9a). No block
    // below it can hold a Post event, so no sweep ever reads that far.
    deployBlock: 25_888_250,
    wallet: {
      chainName: 'Ethereum Mainnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  167000: {
    id: 167000,
    name: 'Taiko',
    slug: 'taiko',
    viem: taiko,
    explorer: 'https://taikoscan.io',
    rpcs: ['https://rpc.mainnet.taiko.xyz', 'https://taiko.drpc.org'],
    // The official node allows 30,000 blocks per getLogs, drpc 10,000 —
    // 9,000 suits both. Taiko blocks come every ~2s, so a window covers far
    // less wall-clock time than on Ethereum.
    logWindow: 9000,
    // Per scan (see Ethereum above). 270,000 blocks ≈ 6 days of Taiko at
    // ~2s a block.
    scanBlocks: 270_000,
    // Deployment tx 0x6c66…dae7.
    deployBlock: 10_863_505,
    wallet: {
      chainName: 'Taiko Alethia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    nameKey: 'chain.sepolia',
    slug: 'sepolia',
    viem: sepolia,
    explorer: 'https://sepolia.etherscan.io',
    rpcs: ['https://sepolia.drpc.org'],
    logWindow: 9000,
    scanBlocks: 270_000,
    deployBlock: 0,
    testnet: true,
    wallet: {
      chainName: 'Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    },
  },
  167013: {
    id: 167013,
    name: 'Taiko Hoodi',
    nameKey: 'chain.taikoHoodi',
    slug: 'taiko-hoodi',
    viem: taikoHoodi,
    explorer: 'https://hoodi.taikoscan.io',
    rpcs: ['https://rpc.hoodi.taiko.xyz'],
    logWindow: 9000,
    scanBlocks: 270_000,
    deployBlock: 0,
    testnet: true,
    wallet: {
      chainName: 'Taiko Hoodi',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    },
  },
};

/**
 * The chains Glyph is actually deployed and read on — read together by the
 * feed, offered as publish targets, listed on the settings page. The
 * testnets above stay resolvable (VITE_CHAIN_ID, an older stored
 * preference) without cluttering any of that.
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

/** The most blocks one scan on `id` reads from the node (see CHAINS). */
export const scanBlocks = (id) => BigInt(getChain(id).scanBlocks ?? 270_000);

/** The lowest block a sweep on `id` needs to read (the deployment block). */
export const deployBlock = (id) => BigInt(getChain(id).deployBlock ?? 0);

// The name a chain is SHOWN under lives in format.js, not here: a mainnet
// is a proper noun, but a testnet's name contains a word ("testnet") that
// has to be translated, and this module stays free of the dictionaries so
// that plain Node — the e2e mock node, which needs the slugs and explorers
// — can load it on its own.

/**
 * The chain's segment in a URL — every route carries one, so an address is
 * unambiguous about which chain it was read on: /taiko/tx/0x…
 *
 * A chain with no slug of its own (a testnet reached through VITE_CHAIN_ID)
 * uses its id, which chainFromSlug reads back.
 */
export const chainSlug = (id) => CHAINS[Number(id)]?.slug ?? String(Number(id));

/** The chain a URL segment names, or null when it names none. */
export function chainFromSlug(segment) {
  if (!segment) return null;
  const wanted = String(segment).toLowerCase();
  for (const chain of Object.values(CHAINS)) {
    if (chain.slug === wanted) return chain.id;
  }
  const asId = Number(wanted);
  return Number.isInteger(asId) && isKnownChain(asId) ? asId : null;
}

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
