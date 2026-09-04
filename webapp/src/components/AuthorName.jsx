import { useAsync } from '../lib/hooks';
import { useView } from '../lib/view';
import AddressLabel, { Identicon } from './Address';

/**
 * An author, named when ENS knows them and numbered when it does not.
 *
 * For the lists that show a bare address with no page of its own around it
 * — the followed authors on the settings page, chiefly. The lookup is
 * cached per address for ten minutes in `ens.js`, so a list of twenty
 * followed authors asks the node once each and then never again.
 */
export default function AuthorName({ address, size = 14, tailClassName = 'text-xs' }) {
  const view = useView();
  const profile = useAsync(() => view.ensProfile(address), [view, address]);
  const name = profile.value?.name ?? null;

  if (!name) return <AddressLabel address={address} size={size} tailClassName={tailClassName} />;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <Identicon address={address} size={size} avatar={profile.value?.avatar ?? null} />
      <span>{name}</span>
    </span>
  );
}
