import { fmtBlock } from '../lib/format';
import { t } from '../lib/i18n';

/**
 * Live scan status — the scanning label plus, once the reader reports a
 * window, the block range being read, how much of this scan's budget has
 * been used (or the posts found so far, for author-chain walks) and a thin
 * accent bar. Shared by the initial feed scan and both load-more paths.
 *
 * `progress`: { fromBlock, toBlock, fraction, fetched?, budget?, posts?, target? }
 */
export default function ScanProgress({ label, progress, className = '' }) {
  const pct = progress ? Math.round((progress.fraction ?? 0) * 100) : 0;
  const sameBlock = progress && String(progress.fromBlock) === String(progress.toBlock);
  return (
    <div role="status" aria-live="polite" className={`text-center ${className}`}>
      <p className={`text-xs text-ink-ghost ${progress ? '' : 'animate-pulse'}`}>
        {label ?? t('scanProgress.default')}
      </p>
      {progress && (
        <>
          <p className="mt-2 text-2xs tabular-nums text-ink-faint">
            {sameBlock
              ? t('scanProgress.block', { block: fmtBlock(progress.fromBlock) })
              : t('scanProgress.blockRange', {
                  from: fmtBlock(progress.fromBlock),
                  to: fmtBlock(progress.toBlock),
                })}
            {progress.posts != null
              ? t('scanProgress.found', { posts: progress.posts, target: progress.target })
              : progress.fetched != null
                ? t('scanProgress.read', {
                    fetched: fmtBlock(progress.fetched),
                    budget: fmtBlock(progress.budget),
                  })
                : t('scanProgress.percent', { percent: pct })}
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
