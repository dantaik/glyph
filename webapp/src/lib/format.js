// format.js — pure presentation helpers (no React, no network).
//
// Deterministic string/date math shared by the feed, reader list, post
// page and footer. Block numbers stay the on-chain source of truth. A time
// is exact when the row carries its block's timestamp; until then it is an
// estimate from the chain clock's measured block time, and 约-prefixed.

import { getChain } from './chains';

export { chainName } from './chains';

/** Assumed when a clock carries no measured pace. */
const FALLBACK_SECONDS_PER_BLOCK = 12;

const REL_FMT = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

const REL_UNITS = [
  [31536000, 'year'],
  [2592000, 'month'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

/** 0-based on-chain index → 1-based display: `2n` → `"第 3 篇"`. */
export function fmtIndex(index) {
  return `第 ${Number(index) + 1} 篇`;
}

/** `22540123n` → `"22,540,123"` (comma grouping regardless of UI locale). */
export function fmtBlock(block) {
  if (block === null || block === undefined) return '';
  return BigInt(block).toLocaleString('en-US');
}



/**
 * `0x12345678…cdef` → first 6 + `…` + last 4 chars.
 *
 * The form for things that are addressed rather than owned — the contract,
 * a transaction hash. A PERSON is shown as their identicon plus `addrTail`
 * (see the Address components): the picture carries the identity, so the
 * leading `0x…` only costs width.
 */
export function shortAddr(addr) {
  if (!addr) return '';
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * The last 6 characters of an address — what goes beside an identicon.
 * Kept verbatim (checksum casing included) so it matches what a wallet or
 * an explorer shows. Short input is returned as-is.
 */
export function addrTail(addr) {
  if (!addr) return '';
  const a = String(addr);
  return a.length > 6 ? a.slice(-6) : a;
}

/**
 * Clean a decoded bytes32 title for display: strip trailing U+FFFD
 * replacement chars (truncated multibyte tails), return null when
 * nothing is left so callers can fall back to 无标题.
 */
export function fmtTitle(title) {
  const t = (title || '').replace(/\uFFFD+$/u, '');
  return t === '' ? null : t;
}

/**
 * Estimate a block's wall-clock time from a recent chain clock
 * `{ block: bigint, ts: seconds, secondsPerBlock }`. Returns a Date, or
 * null without a clock (callers show the block number).
 */
export function estimateBlockTime(clock, block) {
  if (!clock || clock.block == null || clock.ts == null) return null;
  if (block === null || block === undefined) return null;
  const pace = clock.secondsPerBlock ?? FALLBACK_SECONDS_PER_BLOCK;
  const drift = Number(BigInt(block) - BigInt(clock.block)) * pace;
  return new Date((Number(clock.ts) + drift) * 1000);
}

/**
 * Date → `约 3天前` (Intl zh-CN, numeric auto); `刚刚` under a minute;
 * null-safe. `exact` drops the 约: the time came from the block itself.
 */
export function fmtRelTime(date, { exact = false } = {}) {
  if (!date) return null;
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return null;
  const seconds = (ms - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return '刚刚';
  const [size, unit] = REL_UNITS.find(([s]) => abs >= s);
  const text = REL_FMT.format(Math.round(abs / size) * (seconds < 0 ? -1 : 1), unit);
  return exact ? text : `约 ${text}`;
}

const ABS_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Seconds since the epoch → `2026年9月3日 15:04`; null-safe. */
export function fmtAbsTime(ts) {
  if (ts == null) return null;
  const date = new Date(Number(ts) * 1000);
  return Number.isNaN(date.getTime()) ? null : ABS_FMT.format(date);
}

/** Turn a raw provider error into a short, human-friendly hint. */
export function friendlyError(message) {
  const m = String(message || '');
  if (/尚未同步/.test(m)) return m; // scanner.js: a node behind the chain, said plainly
  if (/rate limit|429|too many requests/i.test(m)) {
    return '节点请求过于频繁，请稍后重试，或到右上角设置更换 RPC 节点。';
  }
  if (/archive|token|personal/i.test(m)) {
    return '当前 RPC 节点不支持这类查询，请到右上角设置更换节点。';
  }
  if (/can'?t route|suitable provider|no provider/i.test(m)) {
    return 'RPC 节点暂时无法响应，请稍后重试。';
  }
  if (/network|fetch|econn|refused|failed/i.test(m)) {
    return '网络连接出现问题，请检查网络后重试。';
  }
  return '节点暂时不可用，请稍后重试。';
}

/** Block-explorer transaction URL on `chainId` (Etherscan/Taikoscan). */
export function etherscanTxUrl(txHash, chainId) {
  return `${getChain(chainId).explorer}/tx/${txHash}`;
}

/** Block-explorer address URL on `chainId`. */
export function etherscanAddrUrl(address, chainId) {
  return `${getChain(chainId).explorer}/address/${address}`;
}
