import { useMemo } from 'react';
import { blo } from 'blo';
import { shortAddr } from '../lib/format';

/**
 * How a person is shown in Xueni.
 *
 * Every wallet is its own author here, and the addresses are unrelated to
 * each other — so the eye needs something it can tell apart at a glance in a
 * list. The blockies identicon (`blo`, the same 8×8 seed every wallet
 * draws) does the identifying, and the unified `0x0000....0000` address
 * form (see `shortAddr`) is what confirms it against a wallet or an
 * explorer.
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
 * Identicon + the unified `0x0000....0000` address form — the standard way
 * an author is written. `title` carries the full address for copy/inspect.
 */
export default function AddressLabel({ address, size = 16, className = '', tailClassName = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 align-middle ${className}`}>
      <Identicon address={address} size={size} />
      <span className={`tabular-nums ${tailClassName}`}>{shortAddr(address)}</span>
    </span>
  );
}
