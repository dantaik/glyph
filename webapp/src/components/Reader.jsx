import { useState, useEffect, useRef } from 'react';
import { useReader } from '../lib/data';
import { useAsync } from '../lib/hooks';
import { friendlyError } from '../lib/format';
import { CONTRACT_CONFIGURED } from '../lib/config';
import { useUrlState, ADDRESS_RE } from '../lib/router';
import EmptyState from './EmptyState';
import PostPage from './PostPage';
import HomeFeed from './HomeFeed';
import AuthorTitleList from './AuthorTitleList';
import ScanPage from './ScanPage';

/**
 * The reading surfaces, picked by URL: `/` the home feed, `/author/<addr>`
 * one author's list, `/tx/<hash>/<n>` one post, `/scan` the local scan
 * status. Every surface reads through the reader of the chain being shown;
 * switching chains swaps the reader in place.
 */
export default function Reader({ onStartWriting }) {
  const [params, navigate] = useUrlState();
  const reader = useReader();
  const author = params.author && ADDRESS_RE.test(params.author) ? params.author : null;
  const tx = params.tx;
  const txEvent = params.txEvent != null ? Number(params.txEvent) : 0;
  const isConfigured = CONTRACT_CONFIGURED || Boolean(reader.io.ephemeral);

  // A transaction belongs to one chain: switching chains while a post is
  // open goes back to the home feed of the new chain.
  const shownChain = useRef(reader.chainId);
  useEffect(() => {
    if (shownChain.current === reader.chainId) return;
    shownChain.current = reader.chainId;
    if (tx) navigate({}, { replace: true });
  }, [reader.chainId, tx, navigate]);

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

  if (params.scan) return <ScanPage navigate={navigate} />;

  if (tx) {
    return <TxRoute reader={reader} txHash={tx} eventIndex={txEvent} navigate={navigate} />;
  }

  if (!author) {
    return <HomeFeed reader={reader} navigate={navigate} onStartWriting={onStartWriting} />;
  }

  return <AuthorTitleList reader={reader} author={author} navigate={navigate} />;
}

/** `/tx/<hash>/<n>`: resolve the post's metadata, then show it. */
function TxRoute({ reader, txHash, eventIndex, navigate }) {
  const meta = useAsync(() => reader.findMetaByTx(txHash, eventIndex), [reader, txHash, eventIndex]);
  const neighbors = useNeighbors(reader, meta.value ?? null);

  if (meta.error) {
    return (
      <EmptyState
        tone="danger"
        title="加载失败"
        body={friendlyError(meta.error)}
        detail={meta.error}
        actionLabel="重试"
        onAction={meta.retry}
      />
    );
  }
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
