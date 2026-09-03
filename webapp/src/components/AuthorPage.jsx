import { useAuthorList } from '../lib/authorList';
import { useAsync } from '../lib/hooks';
import { friendlyError, shortAddr } from '../lib/format';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import { ListSkeleton } from './Skeleton';

/**
 * Author page: address header, post count, title list with relative times,
 * load-more, and the empty/error/skeleton states. The rows come from the
 * reader's author-list controller — a walk that keeps going and keeps its
 * rows if the page is left mid-way — rendered block by block as it goes.
 */
export default function AuthorPage({ reader, author, navigate }) {
  const controller = reader.authorList(author);
  const list = useAuthorList(controller);
  const count = useAsync(() => reader.count(author), [reader, author]);
  const clock = useAsync(() => reader.clock(), [reader]);
  // Show the author's ENS name when the address has one, else the address.
  const ens = useAsync(() => reader.ensName(author), [reader, author]);

  const { rows: titles, job, hasMore, error } = list;
  const loading = titles.length === 0 && job === 'refresh';
  const empty = titles.length === 0 && job == null && !error;

  return (
    <div>
      <ListHeader
        title={`${ens.value || shortAddr(author)} 的文章`}
        titleAttr={author}
        subtitle={count.value != null ? `共 ${Number(count.value)} 篇` : undefined}
      />

      {loading && <ListSkeleton />}

      {error && titles.length === 0 && !loading && (
        <ErrorState error={error} onRetry={() => controller.retry()} />
      )}

      {empty && <EmptyState title="该地址没发表过文章" />}

      {titles.length > 0 && (
        <>
          <FeaturedPost reader={reader} post={titles[0]} clock={clock.value} navigate={navigate} />
          {titles.length > 1 && (
            <ul className="divide-y divide-edge">
              {titles.slice(1).map((t) => (
                <ArticleListItem
                  key={`${t.block}-${t.index}`}
                  post={t}
                  clock={clock.value}
                  navigate={navigate}
                  showIndex
                />
              ))}
            </ul>
          )}
        </>
      )}

      {job === 'refresh' && titles.length > 0 && (
        <p className="mt-6 animate-pulse text-center text-xs text-ink-ghost">正在读取最新文章…</p>
      )}

      {error && titles.length > 0 && (
        <p className="mt-4 text-center text-sm text-danger">{friendlyError(error)}</p>
      )}

      {titles.length > 0 && (
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
