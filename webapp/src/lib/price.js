// price.js — live gas price (from the node) + ETH/USD (from CoinGecko),
// and gas-cost math.
//
// ETH/USD uses the CoinGecko public API. This is an off-chain HTTP
// dependency: if it's blocked, rate-limited, or offline, the estimator
// degrades to ETH-only (usd = null) and the UI hides USD figures.

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

let priceCache = { ts: 0, usd: null };
const PRICE_TTL_MS = 60_000;

async function getEthUsdPrice() {
  const now = Date.now();
  if (priceCache.usd != null && now - priceCache.ts < PRICE_TTL_MS) {
    return priceCache.usd;
  }
  const res = await fetch(COINGECKO_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const json = await res.json();
  const usd = json?.ethereum?.usd ?? null;
  priceCache = { ts: now, usd };
  return usd;
}

/**
 * @param {import('viem').PublicClient} client
 * @returns {Promise<{ gasPriceWei: bigint | null, ethUsd: number | null }>}
 */
export async function getMarketState(client) {
  const [gasPriceWei, ethUsd] = await Promise.all([
    client.getGasPrice().catch(() => null),
    getEthUsdPrice().catch(() => null),
  ]);
  return { gasPriceWei, ethUsd };
}

/**
 * The same, for several chains at once. ETH/USD is one number for all of
 * them (every chain here settles in ether), so it is fetched once and
 * shared; the gas price is each chain's own.
 * @param {Array<{ chainId: number, client: import('viem').PublicClient }>} chains
 * @returns {Promise<Record<number, { gasPriceWei: bigint | null, ethUsd: number | null }>>}
 */
export async function getMarketStates(chains) {
  const ethUsd = await getEthUsdPrice().catch(() => null);
  const prices = await Promise.all(
    chains.map(({ client }) => client.getGasPrice().catch(() => null)),
  );
  const out = {};
  chains.forEach(({ chainId }, i) => {
    out[chainId] = { gasPriceWei: prices[i], ethUsd };
  });
  return out;
}

// --- Gas estimates ---
//
// Under EIP-7623 (Pectra), data-heavy txs hit the calldata floor:
//   nonzero byte: 40 gas;  zero byte: 10 gas.
// Brotli output is mostly nonzero; image bytes are mixed but close to all-nonzero.

/**
 * publish(bytes32 title, bytes payload) gas estimate.
 * @param {number} payloadBytes — brotli-compressed payload size in bytes
 * @param {boolean} firstPost   — true if this author has never posted (cold SSTORE)
 */
export function estimatePublishGas(payloadBytes, firstPost) {
  const padded = Math.ceil(payloadBytes / 32) * 32;
  const nonzero = 4 + 32 + payloadBytes; // selector + title + payload (mostly nonzero)
  const zero = 32 + 32 + (padded - payloadBytes); // ABI offset + length slots (~zero)
  const calldata = nonzero * 40 + zero * 10;

  const base = 21000;
  // LOG with 2 topics (signature + indexed author) and 96 bytes of data:
  // 375 + 375 × 2 + 8 × 96 = 1,893 (EIP-2929).
  const logCost = 1893;
  // One packed slot, read then written: warm SLOAD+SSTORE = 100+100 (EIP-2929);
  // the first post pays cold access + 0→non-zero init = 2,100+22,100.
  const sstore = firstPost ? 2100 + 22100 : 100 + 100;
  return base + calldata + logCost + sstore;
}

/** Image upload = plain self-tx with the bytes as calldata. */
export function estimateImageGas(imageBytes) {
  return 21000 + imageBytes * 40; // approximate image bytes as ~all nonzero
}

/** Convert a gas amount + gas price to a {eth, usd} pair. */
export function gasToCost(gas, gasPriceWei, ethUsd) {
  if (gasPriceWei == null) return { eth: null, usd: null };
  const wei = BigInt(gas) * gasPriceWei;
  const eth = Number(wei) / 1e18;
  return { eth, usd: ethUsd != null ? eth * ethUsd : null };
}

// --- Formatting ---

export function fmtEth(eth) {
  if (eth == null) return '—';
  // Always shown in ETH; the smallest unit is 0.000001 — zero and anything
  // below it are shown as that smallest unit rather than as 0.
  const clamped = Math.max(Number(eth), 0.000001);
  const rounded = clamped < 1 ? Number(clamped.toFixed(6)) : Number(clamped.toFixed(4));
  return `${rounded} ETH`;
}

export function fmtUsd(usd) {
  if (usd == null) return '';
  if (usd < 0.01) return `<$0.01`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtGwei(wei) {
  if (wei == null) return '—';
  return `${(Number(wei) / 1e9).toFixed(3)} gwei`;
}
