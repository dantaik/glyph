import { useState, useEffect } from 'react';
import { useAsync } from '../lib/hooks';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import PostPage from './PostPage';

/**
 * `/tx/<hash>/<n>`: resolve the post's metadata through the reader of the
 * chain being shown, then show the post with its prev/next neighbours.
 */
export default function PostRoute({ reader, txHash, eventIndex, navigate }) {
  const meta = useAsync(() => reader.findMetaByTx(txHash, eventIndex), [reader, txHash, eventIndex]);
  const neighbors = useNeighbors(reader, meta.value ?? null);

  if (meta.error) return <ErrorState error={meta.error} onRetry={meta.retry} />;
  if (meta.loading) {
    return (
      <div className="py-20 text-center text-sm text-ink-ghost animate-pulse">
        加载中…
      </div>
    );
  }
  if (meta.value === null) {
    return (
      <EmptyState
        title="没有找到这篇文章"
        body="这笔交易里没有发布记录，或交易哈希有误。"
        actionLabel="返回首页"
        onAction={() => navigate({})}
      />
    );
  }
  const post = meta.value;
  return (
    <PostPage
      reader={reader}
      meta={post}
      navigate={navigate}
      onBack={() => navigate({ author: post.author })}
      neighbors={neighbors}
      onNavigate={(m) => navigate({ tx: m.txHash, txEvent: m.eventIndex ?? 0 })}
      onOpenAuthor={() => navigate({ author: post.author })}
    />
  );
}

/**
 * Neighbors of the open post: seeded synchronously from what the session
 * has already read, misses resolved through the reader in parallel.
 * j<0 → null immediately; when the author's count is known, j>=count →
 * null without RPC. `undefined` = resolving, `null` = absent.
 */
function useNeighbors(reader, meta) {
  const author = meta?.author ?? null;
  const idx = meta ? Number(meta.index) : null;
  const valid = idx != null && Number.isSafeInteger(idx) && idx >= 0;
  const count = useAsync(author ? () => reader.count(author) : null, [reader, author]);
  const total = count.value != null ? Number(count.value) : null;
  const [neighbors, setNeighbors] = useState({ prev: undefined, next: undefined });

  useEffect(() => {
    if (!author || !valid) {
      setNeighbors({ prev: undefined, next: undefined });
      return undefined;
    }
    let cancelled = false;
    const seed = (j) => {
      if (j < 0) return null;
      if (total != null && j >= total) return null;
      return reader.store.knownPost(author, BigInt(j)) ?? undefined;
    };
    const resolve = (j, side) => {
      reader.findTitleMeta(author, j).then(
        (m) => !cancelled && setNeighbors((cur) => ({ ...cur, [side]: m ?? null })),
        () => !cancelled && setNeighbors((cur) => ({ ...cur, [side]: null })),
      );
    };
    const prev = seed(idx - 1);
    const next = seed(idx + 1);
    setNeighbors({ prev, next });
    if (prev === undefined) resolve(idx - 1, 'prev');
    if (next === undefined) resolve(idx + 1, 'next');
    return () => {
      cancelled = true;
    };
  }, [reader, author, idx, valid, total]);

  return neighbors;
}
