import { useEffect, useState } from 'react';
import { friendlyError, shortAddr } from '../lib/format';
import { resolveEnsName } from '../lib/data';
import EmptyState from './EmptyState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import ListHeader from './ListHeader';

/**
 * Author page: address header, post count, title list with relative times,
 * load-more, and the empty/error/skeleton states. Pure render — data lives
 * in Reader.jsx.
 */
export default function AuthorTitleList({
  author,
  titles,
  loading,
  loadingMore,
  hasMore,
  error,
  authorCount,
  clock,
  onLoadMore,
  onRetry,
  navigate,
}) {
  // Show the author's ENS name when the address has one, else the address.
  const [ensName, setEnsName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setEnsName(null);
    resolveEnsName(author).then((name) => !cancelled && setEnsName(name));
    return () => {
      cancelled = true;
    };
  }, [author]);

  return (
    <div>
      <ListHeader
        title={`${ensName || shortAddr(author)} 的文章`}
        titleAttr={author}
        subtitle={authorCount != null ? `共 ${Number(authorCount)} 篇` : undefined}
      />

      {loading && titles.length === 0 && <ListSkeleton />}

      {error && titles.length === 0 && !loading && (
        <EmptyState
          tone="danger"
          title="加载失败"
          body={friendlyError(error)}
          detail={error}
          actionLabel="重试"
          onAction={onRetry}
        />
      )}

      {!loading && titles.length === 0 && !error && (
        <EmptyState title="该地址没发表过文章" />
      )}

      {titles.length > 0 && (
        <>
          <FeaturedPost post={titles[0]} clock={clock} navigate={navigate} />
          {titles.length > 1 && (
            <ul className="divide-y divide-edge">
              {titles.slice(1).map((t) => (
                <ArticleListItem
                  key={`${t.block}-${t.index}`}
                  post={t}
                  clock={clock}
                  navigate={navigate}
                  showIndex
                />
              ))}
            </ul>
          )}
        </>
      )}

      {error && titles.length > 0 && (
        <p className="mt-4 text-center text-sm text-danger">{friendlyError(error)}</p>
      )}

      {titles.length > 0 && (
        <div className="mt-8 text-center">
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="rounded-full border border-edge px-5 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loadingMore ? '正在加载…' : '加载更多'}
            </button>
          ) : (
            <p className="text-xs text-ink-ghost">已是全部文章</p>
          )}
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-edge" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((k) => (
        <li key={k} className="flex items-baseline gap-4 py-4">
          <span className="h-3 w-8 animate-pulse rounded bg-paper-sunken" />
          <span className="h-5 max-w-[60%] flex-1 animate-pulse rounded bg-paper-sunken" />
          <span className="ml-auto h-3 w-16 animate-pulse rounded bg-paper-sunken" />
        </li>
      ))}
    </ul>
  );
}
