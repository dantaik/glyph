// format.js — pure presentation helpers (no React, no network).
//
// Deterministic string/date math shared by the feed, reader list, post
// page and footer. Block numbers stay the on-chain source of truth;
// relative times are merge-aware 12s-slot estimates, always 约-prefixed.

import { CHAIN_ID } from './config';

/** First post-merge block — fixed 12s slots only apply from here on. */
export const MERGE_BLOCK = 15537394n;

const SECONDS_PER_SLOT = 12;

const ETHERSCAN_BASE =
  CHAIN_ID === 11155111 ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';

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



/** `0x12345678…cdef` → first 6 + `…` + last 4 chars. */
export function shortAddr(addr) {
  if (!addr) return '';
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
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
 * `{ block: bigint, ts: seconds }`. Returns a Date, or null for
 * pre-merge blocks / missing clock (callers show the block number).
 */
export function estimateBlockTime(clock, block) {
  if (!clock || clock.block === undefined || clock.ts === undefined) return null;
  if (block === null || block === undefined) return null;
  const target = BigInt(block);
  if (target < MERGE_BLOCK) return null;
  const drift = Number(target - BigInt(clock.block)) * SECONDS_PER_SLOT;
  return new Date((Number(clock.ts) + drift) * 1000);
}

/** Date → `约 3天前` (Intl zh-CN, numeric auto); `刚刚` under a minute; null-safe. */
export function fmtRelTime(date) {
  if (!date) return null;
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return null;
  const seconds = (ms - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return '刚刚';
  const [size, unit] = REL_UNITS.find(([s]) => abs >= s);
  return `约 ${REL_FMT.format(Math.round(abs / size) * (seconds < 0 ? -1 : 1), unit)}`;
}

/**
 * Plain-text teaser from Markdown: drops front-matter remnants, fenced
 * code blocks, images and hr lines; keeps link text; strips heading /
 * quote markers and emphasis chars; collapses whitespace; code-point-safe
 * slice to `max` chars with a trailing ellipsis.
 */
export function excerpt(md, max = 80) {
  if (!md) return '';
  const text = String(md)
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}|>+)[ \t]*/gm, '')
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ' ')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('').trimEnd()}…`;
}

const CHAIN_NAMES = {
  1: '以太坊',
  11155111: 'Sepolia 测试网',
  167000: 'Taiko 主网',
  167013: 'Taiko Hoodi 测试网',
};

/** Turn a raw provider error into a short, human-friendly hint. */
export function friendlyError(message) {
  const m = String(message || '');
  if (/rate limit|429|too many requests/i.test(m)) {
    return '节点请求过于频繁，请稍后重试，或到右上角设置更换 RPC 节点。';
  }
  if (/archive|token|personal/i.test(m)) {
    return '当前 RPC 节点不支持这类查询，请到右上角设置更换节点。';
  }
  if (/network|fetch|econn|refused|failed/i.test(m)) {
    return '网络连接出现问题，请检查网络后重试。';
  }
  return '节点暂时不可用，请稍后重试。';
}

/** Human-readable chain name for the configured chain id. */
export function chainName(chainId = CHAIN_ID) {
  return CHAIN_NAMES[chainId] || `链 ${chainId}`;
}

/** Etherscan transaction URL (sepolia subdomain when CHAIN_ID 11155111). */
export function etherscanTxUrl(txHash) {
  return `${ETHERSCAN_BASE}/tx/${txHash}`;
}

/** Etherscan address URL (sepolia subdomain when CHAIN_ID 11155111). */
export function etherscanAddrUrl(address) {
  return `${ETHERSCAN_BASE}/address/${address}`;
}
