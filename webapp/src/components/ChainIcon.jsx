import { EthereumMark, TaikoMark, ChainMark } from './Icons';

/**
 * The mark for a chain — Ethereum's diamond, Taiko's folded planes, and a
 * plain hexagon for anything else (a testnet reached through VITE_CHAIN_ID).
 * A testnet wears its mainnet's mark: it IS that chain, just not the real one.
 *
 * All three are currentColor glyphs from the shared icon set, so the switcher
 * stays inside the site's one-accent palette instead of importing two brand
 * colours into it.
 */
const MARKS = {
  1: EthereumMark,
  11155111: EthereumMark,
  167000: TaikoMark,
  167013: TaikoMark,
};

export default function ChainIcon({ chainId, size = 16, ...rest }) {
  const Mark = MARKS[Number(chainId)] ?? ChainMark;
  return <Mark size={size} {...rest} />;
}
