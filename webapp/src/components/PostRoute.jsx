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
export default function PostRoute({ reader, txHash, eventIndex, navigate, headless = false, onStartWriting }) {
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
      onStartWriting={onStartWriting}
      headless={headless}
    />
  );
}

/**
 * How many pages of the author's list the page will turn on its own to
 * find a post's neighbours before it settles for the index on the post's
 * own contract. The author page turns pages one click at a time; a post
 * deep in a long list should not quietly read the whole list above it.
 */
const MAX_AUTO_PAGES = 40;

/**
 * Neighbours of the open post: the one before and the one after it in the
 * author's list on this chain, as the author page shows that list.
 *
 * With one contract that list is the index — seeded synchronously from
 * what the session has already read, misses resolved through the reader in
 * parallel (j<0 → null immediately; when the author's count is known,
 * j>=count → null without RPC). With two contracts the author has a list
 * on each and the page shows them merged by block, so the neighbours come
 * from that same merged list (`reader.authorList`), deepened a page at a
 * time until the post and the one below it are in view — which costs no
 * request at all when the post was opened from the author page, whose
 * controller this is. `undefined` = resolving, `null` = absent.
 */
function useNeighbors(reader, meta) {
  const author = meta?.author ?? null;
  const idx = meta ? Number(meta.index) : null;
  const version = Number(meta?.version ?? 1);
  const txHash = meta?.txHash ?? null;
  const eventIndex = Number(meta?.eventIndex ?? 0);
  const valid = idx != null && Number.isSafeInteger(idx) && idx >= 0;
  const merged = (reader.versions?.length ?? 1) > 1;
  const count = useAsync(author && !merged ? () => reader.countOf(author, version) : null, [reader, author, version, merged]);
  const total = count.value != null ? Number(count.value) : null;
  const [neighbors, setNeighbors] = useState({ prev: undefined, next: undefined });

  useEffect(() => {
    if (!author || !valid) {
      setNeighbors({ prev: undefined, next: undefined });
      return undefined;
    }
    let cancelled = false;

    // The index on the post's own contract: prev is idx-1, next is idx+1.
    const byIndex = (sides) => {
      const seed = (j) => {
        if (j < 0) return null;
        if (total != null && j >= total) return null;
        return reader.store.knownPost(author, BigInt(j), version) ?? undefined;
      };
      const resolve = (j, side) => {
        reader.findTitleMeta(author, j, version).then(
          (m) => !cancelled && setNeighbors((cur) => ({ ...cur, [side]: m ?? null })),
          () => !cancelled && setNeighbors((cur) => ({ ...cur, [side]: null })),
        );
      };
      const found = {};
      for (const side of sides) found[side] = seed(side === 'prev' ? idx - 1 : idx + 1);
      setNeighbors((cur) => ({ ...cur, ...found }));
      for (const side of sides) if (found[side] === undefined) resolve(side === 'prev' ? idx - 1 : idx + 1, side);
    };

    if (!merged) {
      byIndex(['prev', 'next']);
      return () => {
        cancelled = true;
      };
    }

    // Two contracts: the merged list, exactly as the author page has it.
    const list = reader.authorList(author);
    const keyOf = (r) => `${String(r.txHash).toLowerCase()}:${Number(r.eventIndex ?? 0)}`;
    const me = `${String(txHash).toLowerCase()}:${eventIndex}`;
    let pages = 0;
    let done = false;
    let unsubscribe = () => {};
    const finish = () => {
      done = true;
      unsubscribe();
    };
    // Turn one more page, if the list has one and nothing is already
    // reading; false when there is nothing more to be had this way.
    const deepen = (snap) => {
      if (snap.job) return true;
      if (snap.error || !snap.hasMore || pages >= MAX_AUTO_PAGES) return false;
      pages += 1;
      list.loadMore();
      return true;
    };
    const settle = () => {
      if (cancelled || done) return;
      const snap = list.getSnapshot();
      // While any stream is still reading, nothing is concluded: the
      // newer neighbour may well be on the contract that has not answered
      // yet, and the cards say "resolving" until it has.
      if (snap.job) return;
      const rows = snap.rows;
      const k = rows.findIndex((r) => keyOf(r) === me);
      if (k < 0) {
        if (deepen(snap)) return;
        // Too deep to page to, or a stream that will not answer: the
        // post's own contract still knows its own list.
        finish();
        byIndex(['prev', 'next']);
        return;
      }
      const next = k > 0 ? rows[k - 1] : null;
      if (k + 1 < rows.length) {
        finish();
        setNeighbors({ prev: rows[k + 1], next });
        return;
      }
      if (deepen(snap)) {
        setNeighbors({ prev: undefined, next });
        return;
      }
      finish();
      if (snap.hasMore) {
        setNeighbors({ prev: undefined, next });
        byIndex(['prev']);
      } else {
        setNeighbors({ prev: null, next });
      }
    };
    unsubscribe = list.subscribe(settle);
    list.ensureFresh();
    settle();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reader, author, idx, valid, total, version, merged, txHash, eventIndex]);

  return neighbors;
}
