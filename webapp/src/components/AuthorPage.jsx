import { Fragment } from 'react';
import { useAsync } from '../lib/hooks';
import { chainName, friendlyError } from '../lib/format';
import { t } from '../lib/i18n';
import { useMergedAuthorList } from '../lib/mergedAuthorList';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import AddressLabel from './Address';
import AuthorProfile from './AuthorProfile';
import FollowButton from './FollowButton';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ArticleListItem from './ArticleListItem';
import FrontierMarker from './FrontierMarker';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import ScanProgress from './ScanProgress';
import { ListSkeleton } from './Skeleton';

/**
 * Author page: address header, post counts, title list, load-more, and the
 * empty/error/skeleton states. An author has a separate list on every
 * chain; the view merges the walks by time (mergedAuthorList.js), each row
 * naming its chain and its ordinal on that chain. The walks are owned by
 * the readers — they keep going and keep their rows if the page is left
 * mid-way — and render block by block as they go.
 */
export default function AuthorPage({ view, author, displayName = null, navigate, currentChain = null }) {
  const controller = view.authorList(author);
  const list = useMergedAuthorList(controller);
  const counts = useAsync(() => view.counts(author), [view, author]);
  // Everything ENS knows about this author: the name they have claimed (and
  // which claims them back), their avatar, and whatever they have written
  // about themselves. All optional, all best effort.
  const profile = useAsync(() => view.ensProfile(author), [view, author]);
  // `displayName` is the name in the URL, when the page was reached by one:
  // it is already known, so the header does not wait for the lookup.
  const name = displayName ?? profile.value?.name ?? null;

  const { rows, frontier, hasMore, job, scanning, chains, allErrored } = list;
  const single = chains.length === 1;
  const loading = rows.length === 0 && !allErrored && chains.some((c) => c.job === 'refresh');
  // The progress lines get the fields they show and nothing else (see
  // HomeFeed: a BigInt array in a prop freezes React's DEV render log).
  const running = chains.filter((c) => c.job).map(({ chainId, job, progress }) => ({ chainId, job, progress }));
  const empty = rows.length === 0 && !scanning && !list.anyError && chains.every((c) => c.refreshedAt > 0);

  // Both counts or none: the subtitle waits for every chain to answer.
  const subtitle = (() => {
    const c = counts.value;
    if (!c || c.total == null) return single ? undefined : undefined;
    const total = t('author.total', { count: Number(c.total) });
    if (single) return total;
    const per = chains.map((ch) => `${chainName(ch.chainId)} ${Number(c.byChain[ch.chainId] ?? 0n)}`).join(' · ');
    return `${total} · ${per}`;
  })();

  const marker = () =>
    frontier && (
      <FrontierMarker
        variant="author"
        frontier={frontier}
        busy={job != null}
        onLoadMore={() => controller.loadMore()}
        onRetry={() => controller.retry()}
      />
    );

  return (
    <div>
      <ListHeader
        title={
          name ? (
            `${t('author.postsByPrefix')}${name}${t('author.postsBySuffix')}`
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {t('author.postsByPrefix') && <span>{t('author.postsByPrefix')}</span>}
              <AddressLabel
                address={author}
                size={18}
                avatar={profile.value?.avatar ?? null}
                tailClassName="text-lg"
              />
              {t('author.postsBySuffix') && <span>{t('author.postsBySuffix')}</span>}
            </span>
          )
        }
        titleAttr={author}
        right={<FollowButton author={author} />}
        subtitle={
          single ? (
            <>
              {subtitle ? `${subtitle} · ` : ''}
              {t('footer.onlyChain', { chain: chainName(chains[0].chainId) })}
              <span className="select-none" aria-hidden="true"> · </span>
              <a
                href={hrefFor({ author, chain: null })}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ author, chain: null });
                }}
                className="hover:text-accent transition-colors"
              >
                {t('feed.viewAll')}
              </a>
            </>
          ) : (
            subtitle
          )
        }
      />

      <AuthorProfile profile={profile.value} />

      {loading && (
        <>
          <ListSkeleton />
          <ChainProgress running={running} className="mt-10" />
        </>
      )}

      {allErrored && rows.length === 0 && !loading && (
        <ErrorState error={chains[0].error} onRetry={() => controller.retry()} />
      )}

      {empty && <EmptyState title={t('author.empty')} />}

      {rows.length > 0 && (
        <ul>
          {frontier?.after === -1 && marker()}
          {rows.map((row, i) => (
            <Fragment key={rowKey(row)}>
              <ArticleListItem post={row} navigate={navigate} currentChain={currentChain} showIndex loadBody={view.loadPostBody} />
              {frontier?.after === i && marker()}
            </Fragment>
          ))}
        </ul>
      )}

      {scanning && rows.length > 0 && <ChainProgress running={running} className="mt-8" />}

      {rows.length > 0 && chains.some((c) => c.error) && (
        <div className="mt-4 space-y-1 text-center text-sm text-danger">
          {chains
            .filter((c) => c.error)
            .map((c) => (
              <p key={c.chainId}>
                {t('feed.readFailed', { chain: chainName(c.chainId), reason: friendlyError(c.error) })}
                <span className="select-none" aria-hidden="true"> · </span>
                <button
                  type="button"
                  onClick={() => controller.retry(c.chainId)}
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
          onClick={() => controller.loadMore()}
          loading={job === 'more'}
          disabled={job != null}
          hasMore={hasMore}
        />
      )}
    </div>
  );
}

/** One progress line per chain with a walk running, named after its chain. */
function ChainProgress({ running, className = '' }) {
  if (running.length === 0) return null;
  return (
    <div className={`space-y-4 ${className}`}>
      {running.map((c) => (
        <ScanProgress
          key={c.chainId}
          label={t('common.labelled', {
            label: chainName(c.chainId),
            value: c.job === 'more' ? t('author.jobMore') : t('author.jobRefresh'),
          })}
          progress={
            c.progress
              ? {
                  fromBlock: c.progress.block,
                  toBlock: c.progress.block,
                  posts: c.progress.target != null ? c.progress.found : null,
                  target: c.progress.target,
                  fraction: c.progress.target ? Math.min(1, c.progress.found / c.progress.target) : 0,
                }
              : null
          }
        />
      ))}
    </div>
  );
}
