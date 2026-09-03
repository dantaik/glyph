import { useEffect, useRef } from 'react';
import { useReader } from '../lib/data';
import { useUrlState, ADDRESS_RE } from '../lib/router';
import PostRoute from './PostRoute';
import HomeFeed from './HomeFeed';
import AuthorPage from './AuthorPage';
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

  if (params.scan) return <ScanPage navigate={navigate} />;
  if (tx) return <PostRoute reader={reader} txHash={tx} eventIndex={txEvent} navigate={navigate} />;
  if (author) return <AuthorPage reader={reader} author={author} navigate={navigate} />;
  return <HomeFeed reader={reader} navigate={navigate} onStartWriting={onStartWriting} />;
}
