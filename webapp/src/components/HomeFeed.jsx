import { useState, useEffect, useCallback } from 'react';
import {
  loadRecentAcrossAuthors,
  loadMoreAcrossAuthors,
  getChainClock,
} from '../lib/data';
import { friendlyError } from '../lib/format';
import EmptyState from './EmptyState';
import ArticleListItem from './ArticleListItem';
import FeaturedPost from './FeaturedPost';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';

const FEED_SIZE = 20;
const EXCERPT_CHARS = 80;

const rowKey = (r) => `${r.txHash}:${r.eventIndex ?? 0}`;

/**
 * Home feed (no author in URL): literary-magazine front page with the most
 * recent posts across all authors. Best-effort, bounded block scan — see
 * loadRecentAcrossAuthors(). 加载更早的文章 sweeps further back, skipping
 * every block range an earlier read already covered. The first entry is
 * featured: tag chips and a two-line excerpt are fetched from its tx
 * calldata (silent degrade).
 */
export default function HomeFeed({ navigate, onStartWriting }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // The sweep only knows it is finished once it reaches block 0; short of
  // that there may always be older posts further down.
  const [done, setDone] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDone(false);
    setNote(null);
    loadRecentAcrossAuthors(FEED_SIZE)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message || '加载失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Chain clock for 约-relative times; silently degrade to block numbers.
  useEffect(() => {
    let cancelled = false;
    getChainClock()
      .then((c) => !cancelled && setClock(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const loadMore = useCallback(async () => {
    if (loadingMore || done) return;
    setLoadingMore(true);
    setNote(null);
    try {
      const oldest = rows[rows.length - 1] ?? null;
      const { rows: more = [], done: finished } =
        (await loadMoreAcrossAuthors(oldest, FEED_SIZE)) ?? {};
      setRows((cur) => {
        const seen = new Set(cur.map(rowKey));
        return [...cur, ...more.filter((r) => !seen.has(rowKey(r)))];
      });
      if (finished) setDone(true);
      else if (more.length === 0) setNote('这一段区块里没有更早的文章，可以继续加载。');
    } catch (e) {
      setNote(friendlyError(e?.message));
    } finally {
      setLoadingMore(false);
    }
  }, [rows, loadingMore, done]);

  const featured = rows[0];
  const rest = rows.slice(1);

  return (
    <div>
      <section className="mb-9 text-center">
        <h1 className="text-2xl font-bold leading-snug tracking-wide text-ink sm:text-display">
          人过留名，雁过留声。
          <br />
          人海亿万，唯留字者不朽。
        </h1>
      </section>

      <ListHeader title="最新文章" subtitle="来自所有作者" />

      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <EmptyState
          tone="danger"
          title="加载失败"
          body={friendlyError(error)}
          detail={error}
          actionLabel="重试"
          onAction={() => setTick((t) => t + 1)}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="此刻还没有文章"
          actionLabel="写第一篇"
          onAction={onStartWriting}
        />
      ) : (
        <>
          <FeaturedPost post={featured} clock={clock} navigate={navigate} excerptChars={EXCERPT_CHARS} />

          <ul className="divide-y divide-edge">
            {rest.map((r) => (
              <ArticleListItem
                key={rowKey(r)}
                post={r}
                clock={clock}
                navigate={navigate}
              />
            ))}
          </ul>

          <LoadMoreButton
            onClick={loadMore}
            loading={loadingMore}
            hasMore={!done}
            note={note}
            exhaustedLabel="已扫描到链的起点"
          />
        </>
      )}
    </div>
  );
}


function FeedSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="border-b border-edge pb-8">
        <div className="h-7 w-3/5 animate-pulse rounded bg-paper-sunken" />
        <div className="mt-4 h-4 w-full animate-pulse rounded bg-paper-sunken" />
        <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-paper-sunken" />
        <div className="mt-4 h-3 w-2/5 animate-pulse rounded bg-paper-sunken" />
      </div>
      <ul className="divide-y divide-edge">
        {[0, 1, 2, 3].map((k) => (
          <li key={k} className="py-5">
            <div className="h-5 w-2/3 animate-pulse rounded bg-paper-sunken" />
            <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-paper-sunken" />
          </li>
        ))}
      </ul>
      <p className="mt-10 animate-pulse text-center text-xs text-ink-ghost">
        正在扫描最近区块…
      </p>
    </div>
  );
}
