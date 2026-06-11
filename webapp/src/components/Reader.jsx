import { useState, useEffect, useCallback, useRef } from 'react';
import {
  loadTitleList,
  loadMoreTitles,
  findTitleMeta,
  getAuthorCount,
  getChainClock,
  FIXTURES_MODE,
} from '../lib/data';
import { GLYPH_ADDRESS } from '../lib/config';
import { useUrlState, ADDRESS_RE } from '../lib/router';
import {
  fmtBlock,
  fmtTitle,
  estimateBlockTime,
  fmtRelTime,
} from '../lib/format';
import EmptyState from './EmptyState';
import PostPage from './PostPage';
import HomeFeed from './HomeFeed';

const PAGE_SIZE = 20;

export default function Reader({ onStartWriting }) {
  const [params, navigate] = useUrlState();
  const author = params.author && ADDRESS_RE.test(params.author) ? params.author : null;
  const i = params.i;

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [currentMeta, setCurrentMeta] = useState(null);
  // undefined = resolving, null = unavailable, bigint = known.
  const [authorCount, setAuthorCount] = useState(undefined);
  const [clock, setClock] = useState(null);
  // Neighbors of the open post: undefined = resolving, null = absent, meta = exists.
  const [neighbors, setNeighbors] = useState({ prev: undefined, next: undefined });
  const [listTick, setListTick] = useState(0);
  const neighborCache = useRef(new Map());

  const isConfigured =
    Boolean(FIXTURES_MODE) || GLYPH_ADDRESS !== '0xYourGlyphContractAddress';

  // Load title list when author changes.
  useEffect(() => {
    setTitles([]);
    setError(null);
    setHasMore(true);
    if (!isConfigured || !author) return undefined;
    let cancelled = false;
    setLoading(true);
    loadTitleList(author, PAGE_SIZE)
      .then((rows) => {
        if (cancelled) return;
        setTitles(rows);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .catch((err) => !cancelled && setError(err.message || '加载失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [author, isConfigured, listTick]);

  // Chain clock for 约-relative times; silently degrade to block numbers.
  useEffect(() => {
    if (!isConfigured || !author) return undefined;
    let cancelled = false;
    getChainClock()
      .then((c) => !cancelled && setClock(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [author, isConfigured]);

  // 共 N 篇 — total post count for the author header.
  useEffect(() => {
    setAuthorCount(undefined);
    if (!isConfigured || !author) return undefined;
    let cancelled = false;
    getAuthorCount(author)
      .then((c) => !cancelled && setAuthorCount(c))
      .catch(() => !cancelled && setAuthorCount(null));
    return () => {
      cancelled = true;
    };
  }, [author, isConfigured]);

  // Resolve the meta for the currently-selected post.
  useEffect(() => {
    if (!author || !i) {
      setCurrentMeta(null);
      return undefined;
    }
    const cached = titles.find((t) => Number(t.index) === Number(i));
    if (cached) {
      setCurrentMeta(cached);
      return undefined;
    }
    let cancelled = false;
    findTitleMeta(author, Number(i)).then((m) => !cancelled && setCurrentMeta(m));
    return () => {
      cancelled = true;
    };
  }, [author, i, titles]);

  // Neighbors for the open post: seed synchronously from the titles cache,
  // resolve misses via findTitleMeta in parallel; j<0 → null immediately;
  // when authorCount is known, j>=authorCount → null without RPC.
  useEffect(() => {
    const idx = author && i != null && i !== '' ? Number(i) : null;
    if (idx === null || Number.isNaN(idx)) {
      setNeighbors({ prev: undefined, next: undefined });
      return undefined;
    }
    let cancelled = false;

    const seed = (j) => {
      if (j < 0) return null;
      if (authorCount != null && j >= Number(authorCount)) return null;
      const hit = titles.find((t) => Number(t.index) === j);
      if (hit) return hit;
      const key = `${author}:${j}`;
      return neighborCache.current.has(key) ? neighborCache.current.get(key) : undefined;
    };

    const resolve = (j, side) => {
      findTitleMeta(author, j)
        .then((m) => {
          neighborCache.current.set(`${author}:${j}`, m ?? null);
          if (!cancelled) setNeighbors((cur) => ({ ...cur, [side]: m ?? null }));
        })
        .catch(() => {
          if (!cancelled) setNeighbors((cur) => ({ ...cur, [side]: null }));
        });
    };

    const prev = seed(idx - 1);
    const next = seed(idx + 1);
    setNeighbors({ prev, next });
    if (prev === undefined) resolve(idx - 1, 'prev');
    if (next === undefined) resolve(idx + 1, 'next');

    return () => {
      cancelled = true;
    };
  }, [author, i, titles, authorCount]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !author) return;
    setLoadingMore(true);
    try {
      const oldest = titles[titles.length - 1];
      if (!oldest || oldest.index === 0n) {
        setHasMore(false);
        return;
      }
      const more = await loadMoreTitles(author, oldest, PAGE_SIZE);
      setTitles((cur) => [...cur, ...more]);
      setHasMore(more.length >= PAGE_SIZE);
    } catch (err) {
      setError(err.message || '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  }, [author, titles, loadingMore, hasMore]);

  // --- Empty / error states ---

  if (!isConfigured) {
    return (
      <EmptyState
        title="尚未配置"
        body={
          <>
            请先部署 Glyph 合约，然后通过{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 font-mono text-xs text-ink-soft">
              VITE_GLYPH_ADDRESS
            </code>{' '}
            配置合约地址。
          </>
        }
      />
    );
  }

  if (!author) {
    return <HomeFeed navigate={navigate} onStartWriting={onStartWriting} />;
  }

  // --- Single post view ---

  if (i != null) {
    if (currentMeta == null) {
      return (
        <div className="py-20 text-center text-sm text-ink-ghost animate-pulse">
          加载中…
        </div>
      );
    }
    return (
      <PostPage
        meta={currentMeta}
        onBack={() => navigate({ author })}
        neighbors={neighbors}
        onNavigateIndex={(j) => navigate({ author, i: String(j) })}
      />
    );
  }

  // --- Title list view ---

  return (
    <div>
      <header className="mb-8 border-b border-edge pb-5">
        <p className="text-xs tracking-label text-ink-faint">作者</p>
        <p className="mt-1 font-mono text-sm text-ink-soft break-all select-all">
          {author}
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
          body={error}
          actionLabel="重试"
          onAction={() => setListTick((t) => t + 1)}
        />
      )}

      {!loading && titles.length === 0 && !error && (
        <EmptyState title="还没有岩刻" body="这位作者还没有在链上刻过字。" />
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
                  <span className="min-w-[2.5rem] font-mono text-xs text-ink-ghost tabular-nums">
                    #{Number(t.index) + 1}
                  </span>
                  <span className="flex-1 font-serif text-[1.05rem] leading-snug group-hover:text-accent transition-colors">
                    {fmtTitle(t.title) ?? <span className="text-ink-ghost">无标题</span>}
                  </span>
                  <span className="text-xs text-ink-faint tabular-nums whitespace-nowrap">
                    {rel ?? `区块 ${fmtBlock(t.block)}`}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {error && titles.length > 0 && (
        <p className="mt-4 text-center text-sm text-danger">{error}</p>
      )}

      {titles.length > 0 && (
        <div className="mt-8 text-center">
          {hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-full border border-edge px-5 py-2 text-sm text-ink-soft hover:border-edge-strong hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loadingMore ? '正在加载…' : '加载更多'}
            </button>
          ) : (
            <p className="text-xs text-ink-ghost">已是全部岩刻</p>
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
