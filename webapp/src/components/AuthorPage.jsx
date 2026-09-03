import { Fragment } from 'react';
import { chainName } from '../lib/chains';
import { useAsync } from '../lib/hooks';
import { friendlyError } from '../lib/format';
import { useMergedAuthorList } from '../lib/mergedAuthorList';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import AddressLabel from './Address';
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
 * naming its chain and its 第 N 篇 on that chain. The walks are owned by
 * the readers — they keep going and keep their rows if the page is left
 * mid-way — and render block by block as they go.
 */
export default function AuthorPage({ view, author, navigate, currentChain = null }) {
  const controller = view.authorList(author);
  const list = useMergedAuthorList(controller);
  const counts = useAsync(() => view.counts(author), [view, author]);
  // Show the author's ENS name when the address has one, else the address.
  const ens = useAsync(() => view.ensName(author), [view, author]);

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
    const total = `共 ${Number(c.total)} 篇`;
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
          ens.value ? (
            `${ens.value} 的文章`
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <AddressLabel address={author} size={18} tailClassName="text-lg" />
              <span>的文章</span>
            </span>
          )
        }
        titleAttr={author}
        subtitle={
          single ? (
            <>
              {subtitle ? `${subtitle} · ` : ''}只看{chainName(chains[0].chainId)}
              <span className="select-none" aria-hidden="true"> · </span>
              <a
                href={hrefFor({ author, chain: null })}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ author, chain: null });
                }}
                className="hover:text-accent transition-colors"
              >
                查看全部
              </a>
            </>
          ) : (
            subtitle
          )
        }
      />

      {loading && (
        <>
          <ListSkeleton />
          <ChainProgress running={running} className="mt-10" />
        </>
      )}

      {allErrored && rows.length === 0 && !loading && (
        <ErrorState error={chains[0].error} onRetry={() => controller.retry()} />
      )}

      {empty && <EmptyState title="该地址没发表过文章" />}

      {rows.length > 0 && (
        <ul className="divide-y divide-edge">
          {frontier?.after === -1 && marker()}
          {rows.map((t, i) => (
            <Fragment key={rowKey(t)}>
              <ArticleListItem post={t} navigate={navigate} currentChain={currentChain} showIndex loadBody={view.loadPostBody} />
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
                {chainName(c.chainId)} 读取失败：{friendlyError(c.error)}
                <span className="select-none" aria-hidden="true"> · </span>
                <button
                  type="button"
                  onClick={() => controller.retry(c.chainId)}
                  className="underline-offset-4 hover:underline"
                >
                  重试
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
          label={`${chainName(c.chainId)}：${c.job === 'more' ? '正在扫描更早的文章…' : '正在读取文章列表…'}`}
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
