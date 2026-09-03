import { useAuthorList } from '../lib/authorList';
import { useAsync } from '../lib/hooks';
import { friendlyError, shortAddr } from '../lib/format';
import EmptyState from './EmptyState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';

/**
 * Author page: address header, post count, title list with relative times,
 * load-more, and the empty/error/skeleton states. The rows come from the
 * reader's author-list controller — a walk that keeps going and keeps its
 * rows if the page is left mid-way — rendered block by block as it goes.
 */
export default function AuthorTitleList({ reader, author, navigate }) {
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
        <EmptyState
          tone="danger"
          title="加载失败"
          body={friendlyError(error)}
          detail={error}
          actionLabel="重试"
          onAction={() => controller.retry()}
        />
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
