import { useEffect } from 'react';
import { getReader } from '../lib/data';
import { useUrlState, isHeadless, ADDRESS_RE } from '../lib/router';
import { useView } from '../lib/view';
import AuthorPage from './AuthorPage';
import HomeFeed from './HomeFeed';
import PostLocator from './PostLocator';
import PostRoute from './PostRoute';
import ScanPage from './ScanPage';

/**
 * The reading surface: which page the URL asks for, over the view it asks
 * for. `/` and `/author/…` read every chain at once; `/taiko` and
 * `/taiko/author/…` read one. A post is on one chain, so `/taiko/tx/…`
 * goes to that chain's reader; a chainless `/tx/…` is looked up on every
 * chain first.
 */
export default function Reader({ onStartWriting }) {
  const [params, navigate] = useUrlState();
  const view = useView();
  const author = params.author && ADDRESS_RE.test(params.author) ? params.author : null;
  const tx = params.tx;
  const txEvent = params.txEvent != null ? Number(params.txEvent) : 0;
  // `?headless=1`: the post with no app around it (router.js). It is not
  // carried by in-app links, but the two replaces below stay on the SAME
  // post, so they must not drop it.
  const headless = isHeadless(params);

  // Legacy ?author= query links converge onto the /author/<addr> path
  // (replace, so history stays clean).
  useEffect(() => {
    if (!params.authorFromQuery) return;
    navigate({ author }, { replace: true });
  }, [params.authorFromQuery, author, navigate]);

  // Canonical post URLs carry the event index: /taiko/tx/<hash> converges
  // to /taiko/tx/<hash>/0 (replace, so history stays clean).
  useEffect(() => {
    if (!tx || params.chain == null || params.txEvent != null) return;
    navigate({ chain: params.chain, tx, txEvent: 0, ...(headless && { headless: '1' }) }, { replace: true });
  }, [tx, params.chain, params.txEvent, headless, navigate]);

  if (params.scan) return <ScanPage navigate={navigate} />;
  if (tx && params.chain == null) {
    return (
      <PostLocator
        view={view}
        txHash={tx}
        eventIndex={txEvent}
        navigate={navigate}
        headless={headless}
      />
    );
  }
  if (tx) {
    return (
      <PostRoute
        reader={getReader(params.chain)}
        txHash={tx}
        eventIndex={txEvent}
        navigate={navigate}
        headless={headless}
        onStartWriting={onStartWriting}
      />
    );
  }
  if (author) return <AuthorPage view={view} author={author} navigate={navigate} currentChain={params.chain} />;
  return <HomeFeed view={view} navigate={navigate} currentChain={params.chain} onStartWriting={onStartWriting} />;
}
