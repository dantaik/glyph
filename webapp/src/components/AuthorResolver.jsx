import { useEffect } from 'react';
import { useAsync } from '../lib/hooks';
import { useT } from '../lib/i18n';
import AuthorPage from './AuthorPage';
import EmptyState from './EmptyState';
import ListHeader from './ListHeader';
import { ListSkeleton } from './Skeleton';

/**
 * `/author/<name>.eth` — the author page, reached by name.
 *
 * The name stays in the URL and the address is looked up on each visit: a
 * link with a name in it is the one worth sharing, and a name that has moved
 * to a different address should lead to the new one. Only Ethereum hosts
 * ENS, so a Taiko-only view still resolves through mainnet (view.js).
 */
export default function AuthorResolver({ view, name, navigate, currentChain = null }) {
  const t = useT();
  const resolved = useAsync(() => view.resolveEnsName(name), [view, name]);
  const address = resolved.value ?? null;

  // The page title is the name; the address underneath is what confirms it.
  useEffect(() => {
    if (address) document.title = `${name} · Xueni`;
  }, [address, name]);

  if (resolved.loading) {
    return (
      <div data-author-resolver="">
        <ListHeader title={name} subtitle={t('ens.resolving')} />
        <ListSkeleton />
      </div>
    );
  }

  if (!address) {
    return (
      <div data-author-resolver="">
        <ListHeader title={name} />
        <EmptyState
          title={t('ens.notFound', { name })}
          body={t('ens.notFoundBody')}
          actionLabel={t('ens.goHome')}
          onAction={() => navigate({})}
        />
      </div>
    );
  }

  return (
    <AuthorPage
      view={view}
      author={address}
      displayName={name}
      navigate={navigate}
      currentChain={currentChain}
    />
  );
}
