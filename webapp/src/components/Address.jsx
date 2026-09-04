import { useEffect, useMemo, useState } from 'react';
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
 *
 * An author who has claimed an ENS avatar gets that instead, at the same
 * size and in the same square. It is a picture the author chose, so it is
 * strictly better than the one arithmetic chose for them — but it arrives
 * over the network, and a list that reflows when it lands is worse than one
 * that never changes. So the avatar is only ever swapped in once it has
 * actually loaded, and a broken image leaves the identicon standing.
 */

/** The blockies square for `address`. Decorative: the tail beside it is the label. */
export function Identicon({ address, size = 16, avatar = null, className = '' }) {
  const src = useMemo(
    () => (address ? blo(address, size * 4) : null),
    [address, size],
  );
  // Only once the avatar has decoded: an <img> that swaps src mid-list
  // flickers, and one that 404s would leave a hole where a face was.
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    setLoaded(null);
    if (!avatar || typeof Image === 'undefined') return undefined;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => !cancelled && setLoaded(avatar);
    probe.onerror = () => {};
    probe.src = avatar;
    return () => {
      cancelled = true;
    };
  }, [avatar]);

  if (!src) return null;
  return (
    <img
      src={loaded ?? src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable="false"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[3px] object-cover ring-1 ring-edge ring-inset ${className}`}
    />
  );
}

/**
 * Identicon + the unified `0x0000....0000` address form — the standard way
 * an author is written. `title` carries the full address for copy/inspect.
 */
export default function AddressLabel({
  address,
  size = 16,
  avatar = null,
  className = '',
  tailClassName = '',
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 align-middle ${className}`}>
      <Identicon address={address} size={size} avatar={avatar} />
      <span className={`tabular-nums ${tailClassName}`}>{shortAddr(address)}</span>
    </span>
  );
}
