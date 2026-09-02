import { estimateBlockTime, fmtRelTime, chainName } from '../lib/format';

/**
 * Chain name · relative time — the shared meta line for article rows and
 * the featured entry. `prefix` (e.g. 第 N 篇) renders before the chain
 * name. The chain name is plain text everywhere.
 */
export default function PostMeta({ block, clock, prefix, className = '' }) {
  const rel = fmtRelTime(estimateBlockTime(clock, block));
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint tabular-nums ${className}`}
    >
      {prefix && <span className="text-ink-ghost">{prefix}</span>}
      <span>{chainName()}</span>
      {rel && (
        <>
          <span className="select-none" aria-hidden="true">·</span>
          <span>{rel}</span>
        </>
      )}
    </span>
  );
}
