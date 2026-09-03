import { chainName } from '../lib/chains';
import { hrefFor } from '../lib/router';
import ChainIcon from './ChainIcon';

/**
 * The network a post lives on, as meta text: its mark and its name. It is
 * the way into a single-chain view — a link to `/ethereum` or `/taiko` —
 * so it reads like the author link beside it, not like a button. In a list
 * already filtered to that chain it is the same text without the link
 * (`current`): the way out is the list header's 查看全部.
 */
export default function ChainChip({ chainId, navigate, current = false, size = 12, className = '' }) {
  const name = chainName(chainId);
  const body = (
    <>
      <ChainIcon chainId={chainId} size={size} className="shrink-0" />
      <span>{name}</span>
    </>
  );
  const base = `inline-flex items-center gap-1 ${className}`;
  if (current) {
    return (
      <span className={base} aria-current="true">
        {body}
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
      className={`${base} hover:text-accent transition-colors`}
    >
      {body}
    </a>
  );
}
