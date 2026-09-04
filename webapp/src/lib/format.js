// format.js — pure presentation helpers (no React, no network).
//
// Deterministic string/date math shared by the feed, reader list, post
// page and footer. Block numbers stay the on-chain source of truth. A time
// is exact when the row carries its block's timestamp; until then it is an
// estimate from the chain clock's measured block time, and marked as
// approximate.
//
// Everything here that produces a sentence reads the interface language at
// call time (i18n.js), so a language change re-renders into the new one
// with no reload — the Intl formatters are built per locale and memoised.

import { CHAINS, getChain } from './chains';
import { getLocale, t } from './i18n';

/**
 * The name a chain is shown under, or a generic label for one we don't
 * know. Mainnets are proper nouns and read the same in every language; a
 * testnet carries a `nameKey` in the registry, because "testnet" is a
 * word rather than a name.
 */
export const chainName = (id) => {
  const chain = CHAINS[Number(id)];
  if (!chain) return t('chain.unknown', { id: Number(id) });
  return chain.nameKey ? t(chain.nameKey) : chain.name;
};

/** Assumed when a clock carries no measured pace. */
const FALLBACK_SECONDS_PER_BLOCK = 12;

const REL_FMTS = new Map();
const relFormat = () => {
  const locale = getLocale();
  let fmt = REL_FMTS.get(locale);
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    REL_FMTS.set(locale, fmt);
  }
  return fmt;
};

const REL_UNITS = [
  [31536000, 'year'],
  [2592000, 'month'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

/**
 * The first ~`maxChars` characters of a post's markdown as one line of
 * plain text, for list-row previews. Markdown syntax is stripped, not
 * rendered — no HTML, no markup escapes to fight.
 */
export function excerpt(markdown, maxChars = 80) {
  if (!markdown) return '';
  const text = String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, maxChars)) + '…';
}

/** 0-based on-chain index → 1-based display: `2n` → `"#3"`. */
export function fmtIndex(index) {
  return t('post.index', { index: Number(index) + 1 });
}

/** `22540123n` → `"22,540,123"` (comma grouping regardless of UI locale). */
export function fmtBlock(block) {
  if (block === null || block === undefined) return '';
  return BigInt(block).toLocaleString('en-US');
}



/**
 * THE one address form: `0x0000....0000` — `0x` + first 4 hex + `....` +
 * last 4 hex. Used everywhere an address (or hash) is shown: authors,
 * the contract, transaction hashes, console logs. Short input is returned
 * as-is.
 */
export function shortAddr(addr) {
  if (!addr) return '';
  const a = String(addr);
  return a.length > 10 ? `${a.slice(0, 6)}....${a.slice(-4)}` : a;
}

/**
 * Clean a decoded bytes32 title for display: strip trailing U+FFFD
 * replacement chars (truncated multibyte tails), return null when
 * nothing is left so callers can fall back to "Untitled".
 */
export function fmtTitle(title) {
  const clean = (title || '').replace(/\uFFFD+$/u, '');
  return clean === '' ? null : clean;
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
 * Date → `about 3 days ago` (Intl, numeric auto); `just now` under a
 * minute; null-safe. `exact` drops the "about": the time came from the
 * block itself.
 */
export function fmtRelTime(date, { exact = false } = {}) {
  if (!date) return null;
  const ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return null;
  const seconds = (ms - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return t('time.justNow');
  const [size, unit] = REL_UNITS.find(([s]) => abs >= s);
  const text = relFormat().format(Math.round(abs / size) * (seconds < 0 ? -1 : 1), unit);
  return exact ? text : t('time.about', { time: text });
}

const ABS_FMTS = new Map();
const absFormat = () => {
  const locale = getLocale();
  let fmt = ABS_FMTS.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    ABS_FMTS.set(locale, fmt);
  }
  return fmt;
};

const CLOCK_FMTS = new Map();
const clockFormat = () => {
  const locale = getLocale();
  let fmt = CLOCK_FMTS.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    CLOCK_FMTS.set(locale, fmt);
  }
  return fmt;
};

/** Seconds since the epoch → `04:00`, the hour of the day alone; null-safe. */
export function fmtClock(ts) {
  if (ts == null) return null;
  const date = new Date(Number(ts) * 1000);
  return Number.isNaN(date.getTime()) ? null : clockFormat().format(date);
}

/** Seconds since the epoch → `September 3, 2026 at 15:04`; null-safe. */
export function fmtAbsTime(ts) {
  if (ts == null) return null;
  const date = new Date(Number(ts) * 1000);
  return Number.isNaN(date.getTime()) ? null : absFormat().format(date);
}

/**
 * A node answering for a block it hasn't seen (scanner.js). Failures reach
 * this module as bare message strings — the Error and its flags are long
 * gone — so the scanner says it in a language-independent code and this is
 * where it becomes a sentence. Anything else here is a provider's own
 * English, matched by keyword.
 */
export const NODE_BEHIND_CODE = 'glyph:node-behind';
const NODE_BEHIND_RE = new RegExp(`^${NODE_BEHIND_CODE} (\\d+)$`);

/** Turn a raw provider error into a short, human-friendly hint. */
export function friendlyError(message) {
  const m = String(message || '');
  const behind = m.match(NODE_BEHIND_RE);
  if (behind) return t('error.nodeBehind', { block: behind[1] });
  if (/rate limit|429|too many requests/i.test(m)) return t('error.rateLimit');
  if (/archive|token|personal/i.test(m)) return t('error.unsupported');
  if (/can'?t route|suitable provider|no provider/i.test(m)) return t('error.unavailable');
  if (/network|fetch|econn|refused|failed/i.test(m)) return t('error.network');
  return t('error.generic');
}

/** Block-explorer transaction URL on `chainId` (Etherscan/Taikoscan). */
export function etherscanTxUrl(txHash, chainId) {
  return `${getChain(chainId).explorer}/tx/${txHash}`;
}

/** Block-explorer address URL on `chainId`. */
export function etherscanAddrUrl(address, chainId) {
  return `${getChain(chainId).explorer}/address/${address}`;
}
