import { Fragment } from 'react';
import { chainName, fmtBlock, friendlyError } from '../lib/format';
import { t } from '../lib/i18n';
import { useFollowing } from '../lib/following';
import { useMergedFeed } from '../lib/mergedFeed';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ArticleListItem from './ArticleListItem';
import FrontierMarker from './FrontierMarker';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import ScanProgress from './ScanProgress';
import { ListSkeleton } from './Skeleton';
import { Hint } from './Text';

/**
 * Home feed: the most recent posts across all authors — and, by default,
 * across every chain, merged by time (mergedFeed.js) — as one list, every
 * post a row like the next (ArticleListItem), the newest first. Each
 * chain's scan is owned by its reader, not by
 * this component: leaving the page doesn't stop it, and coming back shows
 * what it found meanwhile. Rows appear window by window as the scans find
 * them; a marker shows where the merge stops being complete; loading
 * earlier posts deepens the chain that is furthest behind in time.
 *
 * `currentChain` is the URL's filter (null: all chains); the list header
 * says so and offers the way back.
 */
export default function HomeFeed({ view, navigate, currentChain = null, onStartWriting }) {
  const feed = useMergedFeed(view.feed);
  const following = useFollowing();
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
    ? t('feed.note', { chain: chainName(note.chainId), blocks: fmtBlock(note.fetched) })
    : null;

  /** The way to the following feed, once there is anyone in it. */
  const followingLink = following.length > 0 && (
    <>
      <span className="select-none" aria-hidden="true"> · </span>
      <a
        href={hrefFor({ following: '1' })}
        onClick={(e) => {
          e.preventDefault();
          navigate({ following: '1' });
        }}
        className="hover:text-accent transition-colors"
      >
        {t('following.link', { count: following.length })}
      </a>
    </>
  );

  const subtitle = single ? (
    <>
      {t('footer.onlyChain', { chain: chainName(chains[0].chainId) })}
      <span className="select-none" aria-hidden="true"> · </span>
      <a
        href={hrefFor({ chain: null })}
        onClick={(e) => {
          e.preventDefault();
          navigate({ chain: null });
        }}
        className="hover:text-accent transition-colors"
      >
        {t('feed.viewAll')}
      </a>
      {followingLink}
    </>
  ) : (
    <>
      {t('feed.subtitleAll', { count: chains.length })}
      {followingLink}
    </>
  );

  const marker = () =>
    frontier && (
      <FrontierMarker
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

  return (
    <div>
      <ListHeader title={t('feed.title')} subtitle={subtitle} />

      {loading ? (
        <>
          <ListSkeleton />
          <ChainProgress running={running} className="mt-10" />
        </>
      ) : allErrored && rows.length === 0 ? (
        <ErrorState error={chains[0].error} onRetry={() => view.feed.retry()} />
      ) : rows.length === 0 && done ? (
        <EmptyState title={t('feed.emptyEver')} actionLabel={t('feed.writeFirst')} onAction={onStartWriting} />
      ) : rows.length === 0 ? (
        <>
          <EmptyState title={t('feed.emptyRange')} />
          <ChainProgress running={running} className="mt-8" />
          <ChainErrors failed={failed} onRetry={(id) => view.feed.retry(id)} />
          <LoadMoreButton
            onClick={() => view.feed.loadMore()}
            loading={job === 'more'}
            disabled={job != null}
            hasMore={!done}
            note={noteText}
            label={t('feed.scanEarlier')}
          />
        </>
      ) : (
        <>
          <ul>
            {frontier?.after === -1 && marker()}
            {rows.map((r, i) => {
              const gap = gapAfter(i);
              return (
                <Fragment key={rowKey(r)}>
                  <ArticleListItem post={r} navigate={navigate} currentChain={currentChain} loadBody={view.loadPostBody} />
                  {frontier?.after === i && marker()}
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
          />
        </>
      )}
    </div>
  );
}

const jobLabel = (job) =>
  job === 'more' ? t('feed.jobMore') : job === 'gap' ? t('feed.jobGap') : t('feed.jobRefresh');

/** One progress line per chain with a sweep running, named after its chain. */
function ChainProgress({ running, className = '' }) {
  if (running.length === 0) return null;
  return (
    <div className={`space-y-4 ${className}`}>
      {running.map((c) => (
        <ScanProgress
          key={c.chainId}
          label={t('common.labelled', { label: chainName(c.chainId), value: jobLabel(c.job) })}
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
          {t('feed.readFailed', { chain: chainName(c.chainId), reason: friendlyError(c.error) })}
          <span className="select-none" aria-hidden="true"> · </span>
          <button
            type="button"
            onClick={() => onRetry(c.chainId)}
            className="underline-offset-4 hover:underline"
          >
            {t('common.retry')}
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
    <Hint as="li" nums className="py-3 text-center">
      {active && chain?.job === 'gap' ? (
        <span className="animate-pulse">
          {t('feed.gapFilling', { chain: name, blocks: fmtBlock(blocks) })}
          {progress
            ? t('feed.gapProgress', {
                read: fmtBlock(progress.fetched),
                budget: fmtBlock(chain.scanBlocks),
              })
            : ''}
          …
        </span>
      ) : (
        <>
          {t('feed.gapPending', { chain: name, blocks: fmtBlock(blocks) })}
          <span className="select-none" aria-hidden="true"> · </span>
          <button
            type="button"
            onClick={onFill}
            disabled={busy}
            className="underline-offset-4 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {t('feed.scanThisRange')}
          </button>
        </>
      )}
    </Hint>
  );
}
