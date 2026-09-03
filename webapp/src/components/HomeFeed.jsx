import { Fragment } from 'react';
import { useFeed } from '../lib/feed';
import { useAsync } from '../lib/hooks';
import { fmtBlock, friendlyError } from '../lib/format';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import ScanProgress from './ScanProgress';
import { FeedSkeleton } from './Skeleton';

const EXCERPT_CHARS = 80;

const rowKey = (r) => `${r.txHash}:${r.eventIndex ?? 0}`;

/**
 * Home feed (no author in URL): literary-magazine front page with the most
 * recent posts across all authors. The rows are the chain's scan store,
 * rendered window by window as the feed's scan finds them — see feed.js.
 * The scan is owned by the reader, not by this component: leaving the page
 * doesn't stop it, and coming back shows what it found meanwhile.
 * 加载更早的文章 sweeps further back, skipping every block range an earlier
 * read already covered. The first entry is featured: tag chips and a
 * two-line excerpt are fetched from its tx calldata (silent degrade).
 */
export default function HomeFeed({ reader, navigate, onStartWriting }) {
  const feed = useFeed(reader.feed);
  const clock = useAsync(() => reader.clock(), [reader]);
  const { rows, gaps, job, progress, error, note, done, scanBlocks, floor } = feed;
  const scanning = job != null;
  // Nothing to show yet and the first scan still running: skeleton.
  const loading = rows.length === 0 && job === 'refresh';
  const gapAfter = (i) => gaps.find((g) => g.after === i);

  const noteText = note
    ? `这 ${fmtBlock(note.fetched)} 个区块里没有更早的文章，可以继续加载。`
    : null;
  const scanLabel =
    job === 'more' ? '正在扫描更早的文章…' : job === 'gap' ? '正在补扫中间的区块…' : '正在扫描最近区块…';
  const scanProgress = progress
    ? {
        fromBlock: progress.from,
        toBlock: progress.to,
        fraction: progress.fraction,
        fetched: progress.fetched,
        budget: scanBlocks,
      }
    : null;
  const exhaustedLabel =
    floor > 0n ? '已扫描到合约部署的区块，没有更早的文章' : '已扫描到链的起点';

  const featured = rows[0];
  const rest = rows.slice(1);

  return (
    <div>
      <section className="mb-9 text-center">
        <h1 className="text-2xl font-bold leading-snug tracking-wide text-ink sm:text-display">
          人海亿万，唯文字不朽。
        </h1>
      </section>

      <ListHeader title="最新文章" subtitle="来自所有作者" />

      {loading ? (
        <>
          <FeedSkeleton />
          <ScanProgress label={scanLabel} progress={scanProgress} className="mt-10" />
        </>
      ) : error && rows.length === 0 ? (
        <ErrorState error={error} onRetry={() => reader.feed.retry()} />
      ) : rows.length === 0 && done ? (
        <EmptyState
          title="此刻还没有文章"
          actionLabel="写第一篇"
          onAction={onStartWriting}
        />
      ) : rows.length === 0 ? (
        <>
          <EmptyState title="这一段区块里还没有文章" />
          {scanning && <ScanProgress label={scanLabel} progress={scanProgress} className="mt-8" />}
          <LoadMoreButton
            onClick={() => reader.feed.loadMore()}
            loading={job === 'more'}
            disabled={scanning}
            hasMore={!done}
            note={noteText}
            label="继续扫描更早的区块"
            exhaustedLabel={exhaustedLabel}
          />
        </>
      ) : (
        <>
          <FeaturedPost
            reader={reader}
            post={featured}
            clock={clock.value}
            navigate={navigate}
            excerptChars={EXCERPT_CHARS}
          />

          <ul className="divide-y divide-edge">
            {gapAfter(0) && (
              <GapMarker
                gap={gapAfter(0)}
                active={job === 'gap'}
                busy={scanning}
                progress={progress}
                scanBlocks={scanBlocks}
                onFill={() => reader.feed.fillGap(gapAfter(0))}
              />
            )}
            {rest.map((r, i) => {
              const gap = gapAfter(i + 1);
              return (
                <Fragment key={rowKey(r)}>
                  <ArticleListItem post={r} clock={clock.value} navigate={navigate} />
                  {gap && (
                    <GapMarker
                      gap={gap}
                      active={job === 'gap'}
                      busy={scanning}
                      progress={progress}
                      scanBlocks={scanBlocks}
                      onFill={() => reader.feed.fillGap(gap)}
                    />
                  )}
                </Fragment>
              );
            })}
          </ul>

          {scanning && job !== 'gap' && (
            <ScanProgress label={scanLabel} progress={scanProgress} className="mt-8" />
          )}
          {error && (
            <p className="mt-4 text-center text-sm text-danger">{friendlyError(error)}</p>
          )}

          <LoadMoreButton
            onClick={() => reader.feed.loadMore()}
            loading={job === 'more'}
            disabled={scanning}
            hasMore={!done}
            note={noteText}
            exhaustedLabel={exhaustedLabel}
          />
        </>
      )}
    </div>
  );
}

/**
 * Between two posts with unswept blocks between them — a scan ran out of
 * budget before reaching ground read on an earlier visit. Filling it puts
 * whatever those blocks hold right here, in order.
 */
function GapMarker({ gap, active, busy, progress, scanBlocks, onFill }) {
  const blocks = gap.to - gap.from + 1n;
  return (
    <li className="py-3 text-center text-xs tabular-nums text-ink-ghost">
      {active ? (
        <span className="animate-pulse">
          正在补扫中间的 {fmtBlock(blocks)} 个区块
          {progress ? `：已读 ${fmtBlock(progress.fetched)} / 最多 ${fmtBlock(scanBlocks)}` : ''}…
        </span>
      ) : (
        <>
          中间还有 {fmtBlock(blocks)} 个区块未扫描
          <span className="select-none" aria-hidden="true"> · </span>
          <button
            type="button"
            onClick={onFill}
            disabled={busy}
            className="underline-offset-4 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            扫描这一段
          </button>
        </>
      )}
    </li>
  );
}
