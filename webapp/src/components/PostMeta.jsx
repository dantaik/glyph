import { estimateBlockTime, fmtRelTime } from '../lib/format';

/**
 * Relative time — the shared meta line for article rows and the featured
 * entry. `lead` (e.g. the author link) renders first, `prefix` (e.g.
 * 第 N 篇) before the time. The chain name lives in the app footer only.
 */
export default function PostMeta({ block, clock, prefix, className = '', lead }) {
  const rel = fmtRelTime(estimateBlockTime(clock, block));
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint tabular-nums ${className}`}
    >
      {lead}
      {lead && (prefix || rel) && <span className="select-none" aria-hidden="true">·</span>}
      {prefix && <span className="text-ink-ghost">{prefix}</span>}
      {prefix && rel && <span className="select-none" aria-hidden="true">·</span>}
      {rel && <span>{rel}</span>}
    </span>
  );
}
