import { Fragment, useEffect, useMemo, useRef } from 'react';
import { chainName, friendlyError, fmtRelTime } from '../lib/format';
import { getSeenTs, setSeenTs, useFollowing } from '../lib/following';
import { useFollowFeed } from '../lib/followFeed';
import { t } from '../lib/i18n';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import ArticleListItem from './ArticleListItem';
import EmptyState from './EmptyState';
import FrontierMarker from './FrontierMarker';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import ScanProgress from './ScanProgress';
import { ListSkeleton } from './Skeleton';
import { Hint } from './Text';

/**
 * `/following` — the newest posts of the authors this reader follows.
 *
 * The cheap path the contract was designed for: one head read per author per
 * chain and then a walk down their reverse-linked list, with no range scan
 * anywhere. A reader who follows people rather than browsing pays almost
 * nothing to keep up.
 */
export default function FollowingPage({ view, navigate, currentChain = null, onStartWriting }) {
  const following = useFollowing();
  const feed = useMemo(() => view.followFeed(following), [view, following.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useFollowFeed(feed);
  const { rows, frontier, done, job, scanning, chains, silent, allErrored } = snapshot;

  // Where the reader got to last time. Read once on mount so the divider
  // does not jump as new rows arrive.
  const seenAt = useRef(getSeenTs());
  const newest = rows[0]?.ts ?? 0;
  useEffect(() => {
    // Leaving the page — or the tab — is what records how far they got.
    const remember = () => setSeenTs(newest);
    window.addEventListener('pagehide', remember);
    return () => {
      window.removeEventListener('pagehide', remember);
      remember();
    };
  }, [newest]);

  const loading = rows.length === 0 && !allErrored && scanning;
  const running = chains.filter((c) => c.job);
  const failed = chains.filter((c) => c.error);
  // The first row older than the last visit: everything above it is new.
  const newSince = rows.findIndex((r) => (r.ts ?? 0) <= seenAt.current);

  if (following.length === 0) {
    return (
      <div data-following-page="">
        <ListHeader title={t('following.title')} />
        <EmptyState
          title={t('following.empty')}
          body={t('following.emptyBody')}
          actionLabel={t('following.goRead')}
          onAction={() => navigate({})}
        />
      </div>
    );
  }

  return (
    <div data-following-page="">
      <ListHeader
        title={t('following.title')}
        subtitle={
          <>
            {t('following.subtitle', { count: following.length })}
            {silent.length > 0 && t('following.neverPublished', { count: silent.length })}
            <span className="select-none" aria-hidden="true"> · </span>
            <a
              href={hrefFor({})}
              onClick={(e) => {
                e.preventDefault();
                navigate({});
              }}
              className="hover:text-accent transition-colors"
            >
              {t('following.allPosts')}
            </a>
          </>
        }
      />

      {loading && <ListSkeleton />}

      {rows.length > 0 && (
        <ul>
          {frontier?.after === -1 && <Marker frontier={frontier} busy={job != null} feed={feed} />}
          {rows.map((row, i) => (
            <Fragment key={rowKey(row)}>
              {i === newSince && newSince > 0 && (
                <Hint as="li" className="border-t border-edge py-3 text-center" data-new-since="">
                  {t('following.newSince', { when: fmtRelTime(new Date(seenAt.current * 1000), { exact: true }) })}
                </Hint>
              )}
              <ArticleListItem
                post={row}
                navigate={navigate}
                currentChain={currentChain}
                loadBody={view.loadPostBody}
              />
              {frontier?.after === i && <Marker frontier={frontier} busy={job != null} feed={feed} />}
            </Fragment>
          ))}
        </ul>
      )}

      {rows.length === 0 && !loading && !allErrored && (
        <EmptyState title={t('following.nothingYet')} body={t('following.nothingYetBody')} actionLabel={t('following.write')} onAction={onStartWriting} />
      )}

      {running.length > 0 && (
        <div className="mt-8 space-y-4">
          {running.map((c) => (
            <ScanProgress
              key={c.chainId}
              label={t('common.labelled', { label: chainName(c.chainId), value: t('following.reading') })}
              progress={
                c.progress
                  ? { fromBlock: c.progress.block, toBlock: c.progress.block, fraction: 0 }
                  : null
              }
            />
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <div className="mt-4 space-y-1 text-center text-sm text-danger">
          {failed.map((c) => (
            <p key={c.chainId}>
              {t('feed.readFailed', { chain: chainName(c.chainId), reason: friendlyError(c.error) })}
              <span className="select-none" aria-hidden="true"> · </span>
              <button
                type="button"
                onClick={() => feed.retry(c.chainId)}
                className="underline-offset-4 hover:underline"
              >
                {t('common.retry')}
              </button>
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <LoadMoreButton
          onClick={() => feed.loadMore()}
          loading={job === 'more'}
          disabled={job != null}
          hasMore={!done}
        />
      )}
    </div>
  );
}

/** Where the merge stops being complete, named by author rather than chain. */
function Marker({ frontier, busy, feed }) {
  return (
    <FrontierMarker
      variant="following"
      frontier={frontier}
      busy={busy}
      onLoadMore={() => feed.loadMore()}
      onRetry={() => feed.retry()}
    />
  );
}
