import { useMemo } from 'react';
import { blo } from 'blo';
import { addrTail } from '../lib/format';

/**
 * How a person is shown in Glyph.
 *
 * Every wallet is its own author here, and the addresses are unrelated to
 * each other — so the eye needs something it can tell apart at a glance in a
 * list. `0x8a1f…F4a5` is not that: six of its ten characters are the same on
 * every row. The blockies identicon (`blo`, the same 8×8 seed every wallet
 * draws) does the identifying, and the last 6 characters below it are what
 * confirms it against a wallet or an explorer.
 *
 * Contract and transaction hashes keep `0x…` (see `shortAddr`) — they are
 * addressed, not recognised.
 */

/** The blockies square for `address`. Decorative: the tail beside it is the label. */
export function Identicon({ address, size = 16, className = '' }) {
  const src = useMemo(
    () => (address ? blo(address, size * 4) : null),
    [address, size],
  );
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable="false"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[3px] ring-1 ring-edge ring-inset ${className}`}
    />
  );
}

/**
 * Identicon + the address's last 6 characters — the standard way an author
 * is written. `title` carries the full address for copy/inspect.
 */
export default function AddressLabel({ address, size = 16, className = '', tailClassName = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 align-middle ${className}`}>
      <Identicon address={address} size={size} />
      <span className={`font-mono tabular-nums ${tailClassName}`}>{addrTail(address)}</span>
    </span>
  );
}
