// ens.js — the identity layer the contract deliberately does not have.
//
// Glyph knows only addresses: an author IS a wallet, there is no
// registration, and the contract would be worse if there were. But
// `0x8a1f…f4a5` is not a name, and a journal whose authors cannot be named
// is a journal nobody can recommend to anybody. ENS is the answer already
// on chain — a registry with no owner, on the same L1, which the reader can
// consult without trusting a server.
//
// Everything here is best effort. A name is a convenience laid over the
// address, never the thing itself: a lookup that fails, times out, or comes
// back empty leaves the address showing, and nothing anywhere waits on it.
//
// Only Ethereum mainnet hosts ENS. An address is the same on every chain,
// so a Taiko-only view still asks mainnet — `view.js` routes every lookup
// through `ensReader` for that reason.

import { makeTtlCache } from './ttlCache';

/** How long a name, avatar or profile is held. Records can change. */
const TTL_MS = 10 * 60_000;

/** The text records worth showing, and what they are called here. */
const PROFILE_RECORDS = [
  ['description', 'description'],
  ['url', 'url'],
  ['com.twitter', 'twitter'],
  ['com.github', 'github'],
];

/**
 * Does this look like an ENS name?
 *
 * Deliberately narrow: it decides whether `/author/<segment>` is a name to
 * resolve or a mistyped address, and a wrong "yes" costs a round trip while
 * a wrong "no" shows the wrong page. `.eth` only — other TLDs exist on ENS
 * but need a gateway, which is off-chain and out of scope.
 */
export const isEnsName = (value) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(String(value ?? '').trim().toLowerCase());

const norm = (a) => String(a ?? '').toLowerCase();

/**
 * ENS lookups over one reader, cached.
 *
 * `io` is a chainIO (or a fixture standing in for one). Three caches rather
 * than one: a name and a profile expire together, but they are asked for
 * from different places and at different times.
 */
export function createEns(io) {
  const names = makeTtlCache(() => TTL_MS); // address -> name | null
  const addresses = makeTtlCache(() => TTL_MS); // name -> address | null
  const profiles = makeTtlCache(() => TTL_MS); // address -> profile | null

  const enabled = Boolean(io?.hasEns);

  /** The name an address has claimed, and which claims it back. */
  function ensName(address) {
    if (!enabled || !address) return Promise.resolve(null);
    return names(norm(address), () => io.ensName(address).catch(() => null));
  }

  /** The address a name points at, or null when it points nowhere. */
  function resolveEnsName(name) {
    const key = String(name ?? '').trim().toLowerCase();
    if (!enabled || !isEnsName(key)) return Promise.resolve(null);
    return addresses(key, () => io.ensAddress(key).catch(() => null));
  }

  /**
   * Everything worth showing about an address, or null when it has no name.
   *
   * The reverse record is a claim the address makes about itself and is NOT
   * evidence: anyone may point their reverse record at any name. So the
   * name is resolved forward again and only trusted when it comes back to
   * the same address — the check every ENS client is expected to make, and
   * the difference between a name and an impersonation.
   */
  function ensProfile(address) {
    if (!enabled || !address) return Promise.resolve(null);
    return profiles(norm(address), async () => {
      const name = await ensName(address);
      if (!name) return null;
      const forward = await resolveEnsName(name);
      if (!forward || norm(forward) !== norm(address)) return null;

      const [avatar, ...records] = await Promise.all([
        io.ensAvatar(name).catch(() => null),
        ...PROFILE_RECORDS.map(([key]) => io.ensText(name, key).catch(() => null)),
      ]);
      const out = { name, avatar: avatar ?? null };
      PROFILE_RECORDS.forEach(([, field], i) => {
        out[field] = records[i] || null;
      });
      return out;
    });
  }

  return { enabled, ensName, resolveEnsName, ensProfile };
}

/** Does a profile hold anything worth a header of its own? */
export const hasProfileText = (profile) =>
  Boolean(profile && (profile.description || profile.url || profile.twitter || profile.github));

/**
 * An `url` record as somewhere safe to send a reader. Text records are
 * written by whoever owns the name, so `javascript:` is as likely as
 * anything else; only http(s) is a link.
 */
export function safeUrl(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A handle as its owner writes it, without the @ some people add. */
export const handle = (value) => String(value ?? '').trim().replace(/^@+/, '') || null;
