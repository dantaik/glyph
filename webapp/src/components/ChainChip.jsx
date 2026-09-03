import { chainName } from '../lib/chains';
import { hrefFor } from '../lib/router';

/**
 * The network a post lives on, as meta text: just its name — in a list
 * every row carries one, and a mark on each would be noise. It is the way
 * into a single-chain view — a link to `/ethereum` or `/taiko` — so it
 * reads like the author link beside it, not like a button. In a list
 * already filtered to that chain it is the same text without the link
 * (`current`): the way out is the list header's 查看全部.
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
      title={`只看${name}`}
      className={`hover:text-accent transition-colors ${className}`}
    >
      {name}
    </a>
  );
}
