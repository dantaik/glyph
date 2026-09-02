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
import EmptyState from './EmptyState';
import PostPage from './PostPage';
import HomeFeed from './HomeFeed';
import AuthorTitleList from './AuthorTitleList';

const PAGE_SIZE = 20;

export default function Reader({ onStartWriting }) {
  const [params, navigate] = useUrlState();
  const author = params.author && ADDRESS_RE.test(params.author) ? params.author : null;
  const i = params.i;
  // Selected index from the URL: undefined = none, invalid = null.
  const idx = i != null && i !== '' ? Number(i) : undefined;
  const idxValid = idx != null && Number.isSafeInteger(idx) && idx >= 0;

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  // undefined = resolving, null = not found, meta = found.
  const [currentMeta, setCurrentMeta] = useState(undefined);
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
    if (!author || idx === undefined) {
      setCurrentMeta(undefined);
      return undefined;
    }
    if (!idxValid) {
      setCurrentMeta(null); // not found — index is not a valid number
      return undefined;
    }
    const cached = titles.find((t) => Number(t.index) === idx);
    if (cached) {
      setCurrentMeta(cached);
      return undefined;
    }
    let cancelled = false;
    setCurrentMeta(undefined);
    findTitleMeta(author, idx).then((m) => !cancelled && setCurrentMeta(m ?? null));
    return () => {
      cancelled = true;
    };
  }, [author, idx, idxValid, titles]);

  // Neighbors for the open post: seed synchronously from the titles cache,
  // resolve misses via findTitleMeta in parallel; j<0 → null immediately;
  // when authorCount is known, j>=authorCount → null without RPC.
  useEffect(() => {
    if (!author || !idxValid) {
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
  }, [author, idx, idxValid, titles, authorCount]);

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
    if (currentMeta === undefined) {
      return (
        <div className="py-20 text-center text-sm text-ink-ghost animate-pulse">
          加载中…
        </div>
      );
    }
    if (currentMeta === null) {
      return (
        <EmptyState
          title="没有找到这篇文章"
          body="链接里的序号不存在（可能已越界或格式有误）。"
          actionLabel="返回作者列表"
          onAction={() => navigate({ author })}
        />
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
    <AuthorTitleList
      author={author}
      titles={titles}
      loading={loading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      error={error}
      authorCount={authorCount}
      clock={clock}
      onLoadMore={loadMore}
      onRetry={() => setListTick((t) => t + 1)}
      navigate={navigate}
    />
  );
}
