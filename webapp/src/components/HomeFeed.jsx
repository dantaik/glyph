import { Fragment } from 'react';
import { chainName } from '../lib/chains';
import { fmtBlock, friendlyError } from '../lib/format';
import { useMergedFeed } from '../lib/mergedFeed';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import FrontierMarker from './FrontierMarker';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import ScanProgress from './ScanProgress';
import { FeedSkeleton } from './Skeleton';

const EXCERPT_CHARS = 80;

/**
 * Home feed: literary-magazine front page with the most recent posts
 * across all authors — and, by default, across every chain, merged by
 * time (mergedFeed.js). Each chain's scan is owned by its reader, not by
 * this component: leaving the page doesn't stop it, and coming back shows
 * what it found meanwhile. Rows appear window by window as the scans find
 * them; a marker shows where the merge stops being complete; 加载更早的文章
 * deepens the chain that is furthest behind in time.
 *
 * `currentChain` is the URL's filter (null: all chains); the list header
 * says so and offers the way back.
 */
export default function HomeFeed({ view, navigate, currentChain = null, onStartWriting }) {
  const feed = useMergedFeed(view.feed);
  const { rows, gaps, frontier, done, job, scanning, note, chains, allErrored } = feed;
  const single = chains.length === 1;
  const loading = rows.length === 0 && !allErrored && chains.some((c) => c.job === 'refresh');
  // What the per-chain status lines get: the fields they show, no coverage
  // ranges. React's DEV render log serialises arrays of primitives in
  // changed props with JSON.stringify, which throws on BigInt — a block
  // range in a prop would freeze the page in development.
  const running = chains.filter((c) => c.job).map(({ chainId, job, progress, scanBlocks }) => ({ chainId, job, progress, scanBlocks }));
  const failed = chains.filter((c) => c.error).map(({ chainId, error }) => ({ chainId, error }));
  const gapAfter = (i) => gaps.find((g) => g.after === i);
  const noteText = note
    ? `在${chainName(note.chainId)}上读取了 ${fmtBlock(note.fetched)} 个区块，没有找到更早的文章，可以继续加载。`
    : null;
  const exhaustedLabel = chains.every((c) => c.floor > 0n)
    ? '已扫描到合约部署的区块，没有更早的文章'
    : '已扫描到链的起点';

  const subtitle = single ? (
    <>
      只看{chainName(chains[0].chainId)}
      <span className="select-none" aria-hidden="true"> · </span>
      <a
        href={hrefFor({ chain: null })}
        onClick={(e) => {
          e.preventDefault();
          navigate({ chain: null });
        }}
        className="hover:text-accent transition-colors"
      >
        查看全部
      </a>
    </>
  ) : (
    `来自所有作者 · ${chains.map((c) => chainName(c.chainId)).join('与')}`
  );

  const marker = (as, className) =>
    frontier && (
      <FrontierMarker
        as={as}
        className={className}
        frontier={frontier}
        busy={job != null}
        onLoadMore={() => view.feed.loadMore()}
        onRetry={() => view.feed.retry()}
      />
    );

  const gapMarker = (gap) => (
    <GapMarker
      gap={gap}
      chain={running.find((c) => c.chainId === gap.chainId)}
      active={job === 'gap'}
      busy={job != null}
      onFill={() => view.feed.fillGap(gap.chainId, gap)}
    />
  );

  const featured = rows[0];
  const rest = rows.slice(1);

  return (
    <div>
      <section className="mb-9 text-center">
        <h1 className="text-2xl font-bold leading-snug tracking-wide text-ink sm:text-display">
          人海亿万，唯文字不朽。
        </h1>
      </section>

      <ListHeader title="最新文章" subtitle={subtitle} />

      {loading ? (
        <>
          <FeedSkeleton />
          <ChainProgress running={running} className="mt-10" />
        </>
      ) : allErrored && rows.length === 0 ? (
        <ErrorState error={chains[0].error} onRetry={() => view.feed.retry()} />
      ) : rows.length === 0 && done ? (
        <EmptyState title="此刻还没有文章" actionLabel="写第一篇" onAction={onStartWriting} />
      ) : rows.length === 0 ? (
        <>
          <EmptyState title="这一段区块里还没有文章" />
          <ChainProgress running={running} className="mt-8" />
          <ChainErrors failed={failed} onRetry={(id) => view.feed.retry(id)} />
          <LoadMoreButton
            onClick={() => view.feed.loadMore()}
            loading={job === 'more'}
            disabled={job != null}
            hasMore={!done}
            note={noteText}
            label="继续扫描更早的区块"
            exhaustedLabel={exhaustedLabel}
          />
        </>
      ) : (
        <>
          {frontier?.after === -1 && marker('div', 'mb-4 border-b border-edge')}
          <FeaturedPost
            view={view}
            post={featured}
            navigate={navigate}
            currentChain={currentChain}
            excerptChars={EXCERPT_CHARS}
          />

          <ul className="divide-y divide-edge">
            {frontier?.after === 0 && marker('li')}
            {gapAfter(0) && gapMarker(gapAfter(0))}
            {rest.map((r, i) => {
              const at = i + 1;
              const gap = gapAfter(at);
              return (
                <Fragment key={rowKey(r)}>
                  <ArticleListItem post={r} navigate={navigate} currentChain={currentChain} />
                  {frontier?.after === at && marker('li')}
                  {gap && gapMarker(gap)}
                </Fragment>
              );
            })}
          </ul>

          {scanning && job !== 'gap' && <ChainProgress running={running} className="mt-8" />}
          <ChainErrors failed={failed} onRetry={(id) => view.feed.retry(id)} />

          <LoadMoreButton
            onClick={() => view.feed.loadMore()}
            loading={job === 'more'}
            disabled={job != null}
            hasMore={!done}
            note={noteText}
            exhaustedLabel={exhaustedLabel}
          />
        </>
      )}
    </div>
  );
}

const jobLabel = (job) =>
  job === 'more' ? '正在扫描更早的文章…' : job === 'gap' ? '正在补扫中间的区块…' : '正在扫描最近区块…';

/** One progress line per chain with a sweep running, named after its chain. */
function ChainProgress({ running, className = '' }) {
  if (running.length === 0) return null;
  return (
    <div className={`space-y-4 ${className}`}>
      {running.map((c) => (
        <ScanProgress
          key={c.chainId}
          label={`${chainName(c.chainId)}：${jobLabel(c.job)}`}
          progress={
            c.progress
              ? {
                  fromBlock: c.progress.from,
                  toBlock: c.progress.to,
                  fraction: c.progress.fraction,
                  fetched: c.progress.fetched,
                  budget: c.scanBlocks,
                }
              : null
          }
        />
      ))}
    </div>
  );
}

/** A failed chain, named, with a retry — the other chains' rows stay. */
function ChainErrors({ failed, onRetry }) {
  if (failed.length === 0) return null;
  return (
    <div className="mt-4 space-y-1 text-center text-sm text-danger">
      {failed.map((c) => (
        <p key={c.chainId}>
          {chainName(c.chainId)} 读取失败：{friendlyError(c.error)}
          <span className="select-none" aria-hidden="true"> · </span>
          <button
            type="button"
            onClick={() => onRetry(c.chainId)}
            className="underline-offset-4 hover:underline"
          >
            重试
          </button>
        </p>
      ))}
    </div>
  );
}

/**
 * Between two posts of one chain with unswept blocks between them — a scan
 * ran out of budget before reaching ground read on an earlier visit.
 * Filling it puts whatever those blocks hold right here, in order.
 */
function GapMarker({ gap, chain, active, busy, onFill }) {
  const blocks = gap.to - gap.from + 1n;
  const name = chainName(gap.chainId);
  const progress = chain?.progress;
  return (
    <li className="py-3 text-center text-xs tabular-nums text-ink-ghost">
      {active && chain?.job === 'gap' ? (
        <span className="animate-pulse">
          {name}：正在补扫中间的 {fmtBlock(blocks)} 个区块
          {progress ? `：已读 ${fmtBlock(progress.fetched)} / 最多 ${fmtBlock(chain.scanBlocks)}` : ''}…
        </span>
      ) : (
        <>
          {name}：中间还有 {fmtBlock(blocks)} 个区块未扫描
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
