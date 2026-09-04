import { useState, useEffect } from 'react';
import { useAsync } from '../lib/hooks';
import { t } from '../lib/i18n';
import { Body } from './Text';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import PostPage from './PostPage';

/**
 * `/tx/<hash>/<n>`: resolve the post's metadata through the reader of the
 * chain being shown, then show the post with its prev/next neighbours.
 * `headless` (from `?headless=1`) takes the page's navigation off, so the
 * neighbours are neither shown nor worth resolving.
 */
export default function PostRoute({ reader, txHash, eventIndex, navigate, headless = false }) {
  const meta = useAsync(() => reader.findMetaByTx(txHash, eventIndex), [reader, txHash, eventIndex]);
  const neighbors = useNeighbors(reader, headless ? null : (meta.value ?? null));

  if (meta.error) return <ErrorState error={meta.error} onRetry={meta.retry} />;
  if (meta.loading) {
    return (
      <Body as="div" className="animate-pulse py-20 text-center">
        {t('common.loading')}
      </Body>
    );
  }
  if (meta.value === null) {
    return (
      <EmptyState
        title={t('post.notFound')}
        body={t('post.notFoundBody')}
        actionLabel={t('common.backToFeed')}
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
      onNavigate={(m) => navigate({ chain: reader.chainId, tx: m.txHash, txEvent: m.eventIndex ?? 0 })}
      onOpenAuthor={() => navigate({ author: post.author })}
      headless={headless}
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
