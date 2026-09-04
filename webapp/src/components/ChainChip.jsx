import { chainName } from '../lib/format';
import { t } from '../lib/i18n';
import { hrefFor } from '../lib/router';

/**
 * The network a post lives on, as meta text: just its name — in a list
 * every row carries one, and a mark on each would be noise. It is the way
 * into a single-chain view — a link to `/ethereum` or `/taiko` — so it
 * reads like the author link beside it, not like a button. In a list
 * already filtered to that chain it is the same text without the link
 * (`current`): the way out is the list header's "view all".
 */
export default function ChainChip({ chainId, navigate, current = false, className = '' }) {
  const name = chainName(chainId);
  if (current) {
    return (
      <span className={className} aria-current="true">
        {name}
      </span>
    );
  }
  return (
    <a
      href={hrefFor({ chain: chainId })}
      onClick={(e) => {
        e.preventDefault();
        navigate?.({ chain: chainId });
      }}
      title={t('footer.onlyChain', { chain: name })}
      className={`hover:text-accent transition-colors ${className}`}
    >
      {name}
    </a>
  );
}
