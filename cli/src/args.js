// args.js — the shapes an argument can take, and what they mean.
//
// Everything here is a pure reading of strings a person typed: which chain
// `taiko` is, which endpoints to use for it, which post `0x…/1` names. The
// commands do the work; this file makes sure they all understand the same
// vocabulary, and that a typo is refused with a sentence rather than a stack
// trace.

import { parseArgs } from 'node:util';
import { chainFromSlug, defaultRpcs, isKnownChain, SELECTABLE_CHAIN_IDS } from './shared.js';
import { fail } from './out.js';
import { msg } from './messages.js';

/** The options every command accepts, on top of its own. */
export const GLOBAL_OPTIONS = {
  rpc: { type: 'string', multiple: true },
  chain: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

/**
 * Read one command's arguments. `options` is that command's own table; the
 * global ones are merged in, so `--json` and `--rpc` need not be repeated.
 * A misspelled option is parseArgs' error, which already names it well.
 */
export function readArgs(argv, options = {}) {
  try {
    return parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    fail(err.message);
  }
}

/**
 * The chain a `--chain` value or a URL segment names.
 * `all` is only meaningful where reading several chains makes sense, so the
 * caller says whether it is allowed here.
 * @returns {number | 'all'}
 */
export function resolveChain(value, { allowAll = false, command = '' } = {}) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'all') {
    if (!allowAll) fail(msg.chainNotAll(command));
    return 'all';
  }
  const id = chainFromSlug(text);
  if (id == null || !isKnownChain(id)) fail(msg.unknownChain(value));
  return id;
}

/** The chains a resolved selection covers, as ids. */
export const chainIds = (selection) =>
  selection === 'all' ? [...SELECTABLE_CHAIN_IDS] : [Number(selection)];

/**
 * Read `--rpc` into an endpoint override.
 *
 * A bare `--rpc <url>` applies to every chain in play, which is what a
 * one-chain command wants. `--rpc <chain>=<url>` scopes one to a chain, which
 * is what `--chain all` needs — the same post-reference convention the app
 * uses for cross-chain links (`taiko:0x…`), written with `=` because a URL
 * already has a colon in it.
 *
 * Order is the preference order, exactly as typed: the first endpoint is
 * tried first and the next covers for it.
 */
export function readRpcOverrides(values = []) {
  const shared = [];
  const byChain = new Map();
  for (const raw of values) {
    const value = String(raw).trim();
    if (!value) fail(msg.badRpc(raw));
    const eq = value.indexOf('=');
    const prefix = eq > 0 ? value.slice(0, eq) : '';
    // Only a bare word before the first `=` can be a chain — a query string
    // (`https://node.example/?key=…`) must not be mistaken for one.
    const scoped = /^[a-z0-9-]+$/i.test(prefix) ? chainFromSlug(prefix) : null;
    if (scoped != null) {
      const url = value.slice(eq + 1);
      if (!url) fail(msg.badRpc(raw));
      byChain.set(scoped, [...(byChain.get(scoped) ?? []), url]);
    } else {
      shared.push(value);
    }
  }
  return { shared, byChain };
}

/**
 * The endpoints to try for `chainId`, in order: what `--rpc` said if it said
 * anything about this chain, otherwise the chain registry's own list.
 */
export function endpointsFor(chainId, overrides = { shared: [], byChain: new Map() }) {
  const scoped = overrides.byChain?.get(Number(chainId)) ?? [];
  const chosen = [...scoped, ...(overrides.shared ?? [])];
  return chosen.length ? chosen : defaultRpcs(chainId);
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * A post as the command line names it: `0x<64 hex>` with an optional `/<n>`
 * for the Post event's ordinal inside that transaction (one transaction can
 * publish several). The chain is its own argument here, so this is the plain
 * half of the app's post reference — no `taiko:` prefix to read.
 * @returns {{ txHash: string, eventIndex: number }}
 */
export function parsePostArg(value) {
  const text = String(value ?? '').trim();
  const [hash, ordinal = '0'] = text.split('/');
  if (!TX_HASH_RE.test(hash)) fail(msg.badTxHash(value));
  const eventIndex = Number(ordinal);
  if (!Number.isInteger(eventIndex) || eventIndex < 0) fail(msg.badTxHash(value));
  return { txHash: hash.toLowerCase(), eventIndex };
}

/**
 * An address, lowercased. Lowercase on purpose: viem refuses a mixed-case
 * address whose EIP-55 checksum does not match, which is exactly what an
 * address pasted from somewhere that lowercased half of it looks like, and
 * all-lowercase is the same address to every node.
 */
export function parseAddressArg(value) {
  const text = String(value ?? '').trim();
  if (!ADDRESS_RE.test(text)) fail(msg.badAddress(value));
  return text.toLowerCase();
}

/** `--limit`: a whole number of posts, or null for "all of them". */
export function parseLimit(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(msg.badLimit(value));
  return n === 0 ? null : n;
}

/** `--tags a,b` → `['a', 'b']`. */
export const parseTagsArg = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
