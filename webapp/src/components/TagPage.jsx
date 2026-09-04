import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useBodiesFor } from '../lib/hooks';
import { t } from '../lib/i18n';
import { rowKey } from '../lib/timeline';
import ArticleListItem from './ArticleListItem';
import EmptyState from './EmptyState';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import { Hint } from './Text';

/**
 * `/tag/<name>` — the posts this browser has read that carry a tag.
 *
 * Deliberately not "every post with this tag": nothing on chain indexes the
 * inside of a body, so the only honest answer is drawn from what has been
 * read. The subtitle says how many posts that is, and the control at the
 * foot is the same "load earlier posts" as everywhere else — reading more is
 * how the answer grows.
 */
export default function TagPage({ view, tag, navigate, currentChain = null }) {
  const feed = useSyncExternalStore(view.feed.subscribe, view.feed.getSnapshot, view.feed.getSnapshot);
  const known = useMemo(
    () => view.knownRows(),
    // The feed snapshot changes whenever any chain's store does, which is
    // exactly when there might be more posts to consider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, feed],
  );
  const loadBody = useCallback((row) => view.loadPostBody(row), [view]);
  const { bodies, pending } = useBodiesFor(loadBody, known);

  const wanted = String(tag ?? '').trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      known.filter((row) => {
        const body = bodies.get(`${row.chainId}:${String(row.txHash).toLowerCase()}`);
        return (body?.tags ?? []).some((tg) => String(tg).toLocaleLowerCase() === wanted);
      }),
    [known, bodies, wanted],
  );

  return (
    <div data-tag-page="">
      <ListHeader
        title={t('tag.title', { tag })}
        subtitle={t('tag.scope', { count: known.length })}
      />

      {rows.length > 0 ? (
        <ul>
          {rows.map((row) => (
            <ArticleListItem
              key={rowKey(row)}
              post={row}
              navigate={navigate}
              currentChain={currentChain}
              loadBody={loadBody}
            />
          ))}
        </ul>
      ) : pending > 0 ? (
        <Hint className="py-16 text-center">{t('tag.reading')}</Hint>
      ) : (
        <EmptyState title={t('tag.none', { tag })} body={t('tag.noneBody')} />
      )}

      {pending > 0 && rows.length > 0 && <Hint className="mt-6 text-center">{t('tag.reading')}</Hint>}

      <LoadMoreButton
        onClick={() => view.feed.loadMore()}
        loading={feed.job === 'more'}
        disabled={feed.job != null}
        hasMore={!feed.done}
        label={t('tag.readMore')}
      />
    </div>
  );
}
