import { useEffect, useState } from 'react';
import {
  fmtTitle,
  fmtIndex,
  estimateBlockTime,
  fmtRelTime,
  chainName,
  friendlyError,
} from '../lib/format';
import { resolveEnsName } from '../lib/data';
import EmptyState from './EmptyState';

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
      <header className="mb-8 border-b border-edge pb-5">
        <p className="text-xs tracking-label text-ink-faint">作者</p>
        <p className="mt-1 font-mono text-sm text-ink-soft break-all select-all" title={author}>
          {ensName || author}
        </p>
        <p className="mt-2 text-xs text-ink-faint tabular-nums">
          共{' '}
          {authorCount == null ? (
            <span
              className={`text-ink-ghost${authorCount === undefined ? ' animate-pulse' : ''}`}
            >
              —
            </span>
          ) : (
            Number(authorCount)
          )}{' '}
          篇
        </p>
      </header>

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
        <ul className="divide-y divide-edge">
          {titles.map((t) => {
            const rel = fmtRelTime(estimateBlockTime(clock, t.block));
            return (
              <li key={`${t.block}-${t.index}`}>
                <a
                  href={`?author=${author}&i=${t.index}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ author, i: String(t.index) });
                  }}
                  className="group flex items-baseline gap-4 py-4"
                >

                  <span className="flex-1 font-serif text-lg leading-snug group-hover:text-accent transition-colors">
                    {fmtTitle(t.title) ?? <span className="text-ink-ghost">无标题</span>}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-faint tabular-nums whitespace-nowrap">
                    <span className="text-ink-ghost">{fmtIndex(t.index)}</span>
                    {rel && <span>{rel}</span>}
                    <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-2xs">{chainName()}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
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
              className="rounded-full border border-edge px-5 py-2 text-sm text-ink-soft hover:border-edge-strong hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
