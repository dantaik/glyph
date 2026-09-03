import { useEffect } from 'react';
import { chainName } from '../lib/chains';
import { useAsync } from '../lib/hooks';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';

/**
 * `/tx/<hash>/<n>` with no chain — a link from before post URLs named
 * their chain. The post is looked up on every chain the view reads (one
 * receipt read each) and the URL replaced with the one that has it, so the
 * link keeps working and the address bar ends up telling the truth.
 */
export default function PostLocator({ view, txHash, eventIndex, navigate }) {
  const hit = useAsync(() => view.findPostAnywhere(txHash, eventIndex), [view, txHash, eventIndex]);

  useEffect(() => {
    if (hit.value) navigate({ chain: hit.value.chainId, tx: txHash, txEvent: eventIndex }, { replace: true });
  }, [hit.value, navigate, txHash, eventIndex]);

  if (hit.error) return <ErrorState error={hit.error} onRetry={hit.retry} />;
  if (hit.loading || hit.value) {
    return <div className="py-20 text-center text-sm text-ink-ghost animate-pulse">正在查找这笔交易…</div>;
  }
  const names = view.chainIds.map(chainName).join('和');
  return (
    <EmptyState
      title="没有找到这篇文章"
      body={`在${names}上都没有找到这笔交易的发布记录，或交易哈希有误。`}
      actionLabel="返回首页"
      onAction={() => navigate({})}
    />
  );
}
