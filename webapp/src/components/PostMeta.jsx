import { estimateBlockTime, fmtAbsTime, fmtRelTime } from '../lib/format';

/**
 * The shared meta line for article rows and the featured entry. `lead`
 * (e.g. the author link) renders first, `prefix` (e.g. 第 N 篇) before the
 * time. The chain name lives in the app footer only.
 *
 * The time is exact when the row carries its block's timestamp (`ts`), and
 * an estimate from the chain clock — 约-prefixed — until it does.
 */
export default function PostMeta({ block, clock, ts, prefix, className = '', lead }) {
  const exact = ts != null;
  const date = exact ? new Date(Number(ts) * 1000) : estimateBlockTime(clock, block);
  const rel = fmtRelTime(date, { exact });
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint tabular-nums ${className}`}
    >
      {lead}
      {lead && (prefix || rel) && <span className="select-none" aria-hidden="true">·</span>}
      {prefix && <span className="text-ink-ghost">{prefix}</span>}
      {prefix && rel && <span className="select-none" aria-hidden="true">·</span>}
      {rel && <span title={exact ? fmtAbsTime(ts) : undefined}>{rel}</span>}
    </span>
  );
}
