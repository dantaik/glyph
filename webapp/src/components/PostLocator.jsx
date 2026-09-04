import { useEffect } from 'react';
import { chainName } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { t } from '../lib/i18n';
import { Body } from './Text';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';

/**
 * `/tx/<hash>/<n>` with no chain — a link from before post URLs named
 * their chain. The post is looked up on every chain the view reads (one
 * receipt read each) and the URL replaced with the one that has it, so the
 * link keeps working and the address bar ends up telling the truth.
 */
export default function PostLocator({ view, txHash, eventIndex, navigate, headless = false }) {
  const hit = useAsync(() => view.findPostAnywhere(txHash, eventIndex), [view, txHash, eventIndex]);

  // The replace lands on the SAME post, so `?headless=1` rides along —
  // otherwise a chainless headless link would grow a masthead on arrival.
  useEffect(() => {
    if (!hit.value) return;
    navigate(
      { chain: hit.value.chainId, tx: txHash, txEvent: eventIndex, ...(headless && { headless: '1' }) },
      { replace: true },
    );
  }, [hit.value, navigate, txHash, eventIndex, headless]);

  if (hit.error) return <ErrorState error={hit.error} onRetry={hit.retry} />;
  if (hit.loading || hit.value) {
    return (
      <Body as="div" className="animate-pulse py-20 text-center">
        {t('post.locating')}
      </Body>
    );
  }
  const names = view.chainIds.map(chainName).join(t('common.joinAnd'));
  return (
    <EmptyState
      title={t('post.notFound')}
      body={t('post.notFoundOnChains', { names })}
      actionLabel={t('common.backToFeed')}
      onAction={() => navigate({})}
    />
  );
}
