import { fmtBlock } from '../lib/format';

/**
 * Live scan status — the scanning label plus, once the reader reports a
 * window, the block range being read, how much of this scan's budget has
 * been used (or the posts found so far, for author-chain walks) and a thin
 * accent bar. Shared by the initial feed scan and both 加载更早的文章 paths.
 *
 * `progress`: { fromBlock, toBlock, fraction, fetched?, budget?, posts?, target? }
 */
export default function ScanProgress({ label = '正在扫描…', progress, className = '' }) {
  const pct = progress ? Math.round((progress.fraction ?? 0) * 100) : 0;
  const sameBlock = progress && String(progress.fromBlock) === String(progress.toBlock);
  return (
    <div role="status" aria-live="polite" className={`text-center ${className}`}>
      <p className={`text-xs text-ink-ghost ${progress ? '' : 'animate-pulse'}`}>{label}</p>
      {progress && (
        <>
          <p className="mt-2 text-2xs tabular-nums text-ink-faint">
            {sameBlock
              ? `区块 ${fmtBlock(progress.fromBlock)}`
              : `区块 ${fmtBlock(progress.fromBlock)} 至 ${fmtBlock(progress.toBlock)}`}
            {progress.posts != null
              ? ` · 已找到 ${progress.posts}/${progress.target} 篇`
              : progress.fetched != null
                ? ` · 本次已读 ${fmtBlock(progress.fetched)} / 最多 ${fmtBlock(progress.budget)} 个区块`
                : ` · 约 ${pct}%`}
          </p>
          <div className="mx-auto mt-1.5 h-1 w-44 max-w-full overflow-hidden rounded-full bg-paper-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}
