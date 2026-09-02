import { useState, useEffect, useCallback, useRef } from 'react';
import {
  loadTitleList,
  loadMoreTitles,
  findTitleMeta,
  findMetaByTx,
  getAuthorCount,
  getChainClock,
  FIXTURES_MODE,
} from '../lib/data';
import { friendlyError } from '../lib/format';
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
  const tx = params.tx;
  const txEvent = params.txEvent != null ? Number(params.txEvent) : 0;

  // /tx/<hash> deep link: undefined = resolving, null = not found, meta.
  const [txMeta, setTxMeta] = useState(undefined);
  const [txError, setTxError] = useState(null);
  const [txTick, setTxTick] = useState(0);
  useEffect(() => {
    if (!tx) {
      setTxMeta(undefined);
      setTxError(null);
      return undefined;
    }
    let cancelled = false;
    setTxMeta(undefined);
    setTxError(null);
    findMetaByTx(tx, txEvent)
      .then((m) => !cancelled && setTxMeta(m ?? null))
      .catch((err) => !cancelled && setTxError(err?.message || '加载失败'));
    return () => {
      cancelled = true;
    };
  }, [tx, txEvent, txTick]);

  // The author/index the open post belongs to — from the resolved tx meta.
  const postAuthor = txMeta && txMeta !== null ? txMeta.author : null;
  const postIdx = txMeta && txMeta !== null ? Number(txMeta.index) : undefined;
  const postIdxValid = postIdx != null && Number.isSafeInteger(postIdx) && postIdx >= 0;

  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
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

  // Legacy ?author= query links converge onto the /author/<addr> path
  // (replace, so history stays clean).
  useEffect(() => {
    if (!params.authorFromQuery) return;
    navigate({ author }, { replace: true });
  }, [params.authorFromQuery, author, navigate]);

  // Canonical tx URLs carry the event index: /tx/<hash> converges to
  // /tx/<hash>/0 (replace, so history stays clean).
  useEffect(() => {
    if (!tx || params.txEvent != null) return;
    navigate({ tx, txEvent: 0 }, { replace: true });
  }, [tx, params.txEvent, navigate]);


  // Neighbors for the open post: seed synchronously from the titles cache,
  // resolve misses via findTitleMeta in parallel; j<0 → null immediately;
  // when authorCount is known, j>=authorCount → null without RPC.
  useEffect(() => {
    if (!postAuthor || !postIdxValid) {
      setNeighbors({ prev: undefined, next: undefined });
      return undefined;
    }
    let cancelled = false;

    const seed = (j) => {
      if (j < 0) return null;
      if (authorCount != null && j >= Number(authorCount)) return null;
      const hit = titles.find((t) => Number(t.index) === j);
      if (hit) return hit;
      const key = `${postAuthor}:${j}`;
      return neighborCache.current.has(key) ? neighborCache.current.get(key) : undefined;
    };

    const resolve = (j, side) => {
      findTitleMeta(postAuthor, j)
        .then((m) => {
          neighborCache.current.set(`${postAuthor}:${j}`, m ?? null);
          if (!cancelled) setNeighbors((cur) => ({ ...cur, [side]: m ?? null }));
        })
        .catch(() => {
          if (!cancelled) setNeighbors((cur) => ({ ...cur, [side]: null }));
        });
    };

    const prev = seed(postIdx - 1);
    const next = seed(postIdx + 1);
    setNeighbors({ prev, next });
    if (prev === undefined) resolve(postIdx - 1, 'prev');
    if (next === undefined) resolve(postIdx + 1, 'next');

    return () => {
      cancelled = true;
    };
  }, [postAuthor, postIdx, postIdxValid, titles, authorCount]);

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

  // --- /tx/<hash> deep link view ---

  if (tx) {
    if (txError) {
      return (
        <EmptyState
          tone="danger"
          title="加载失败"
          body={friendlyError(txError)}
          detail={txError}
          actionLabel="重试"
          onAction={() => setTxTick((t) => t + 1)}
        />
      );
    }
    if (txMeta === undefined) {
      return (
        <div className="py-20 text-center text-sm text-ink-ghost animate-pulse">
          加载中…
        </div>
      );
    }
    if (txMeta === null) {
      return (
        <EmptyState
          title="没有找到这篇文章"
          body="这笔交易里没有发布记录，或交易哈希有误。"
          actionLabel="返回首页"
          onAction={() => navigate({})}
        />
      );
    }
    return (
      <PostPage
        meta={txMeta}
        onBack={() => navigate({ author: txMeta.author })}
        neighbors={neighbors}
        onNavigate={(m) => navigate({ tx: m.txHash, txEvent: m.eventIndex ?? 0 })}
        onOpenAuthor={() => navigate({ author: txMeta.author })}
      />
    );
  }

  if (!author) {
    return <HomeFeed navigate={navigate} onStartWriting={onStartWriting} />;
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
