// wallet.js — the signing half, which the browser cannot lend us.
//
// Everything else in this package is shared with the web app; this is the one
// layer that cannot be. In a browser the key lives in an extension and the
// app only ever asks it to sign. At a terminal there is no extension, so the
// key is here — which is why it comes from the environment and from nowhere
// else. NEVER an argument: arguments land in shell history and in `ps` output
// for every process on the machine to read, and a key that leaks once is a
// key that has to be abandoned along with the identity built on it.

import { createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { orderedTransport } from './chain.js';
import { getChain } from './shared.js';
import { fail } from './out.js';
import { msg } from './messages.js';

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * The account PRIVATE_KEY names, or a refusal. A key without the `0x` is
 * accepted — it is the form `cast wallet` and several key files print — but
 * nothing else is guessed at.
 */
export function accountFromEnv(env = process.env) {
  const raw = String(env.PRIVATE_KEY ?? '').trim();
  if (!raw) fail(msg.noKey);
  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!KEY_RE.test(key)) fail(msg.badKey);
  return privateKeyToAccount(key);
}

/**
 * A wallet client for `chainId` over the same endpoints the reads use. The
 * chain object matters: viem checks the wallet is on the chain it is asked to
 * sign for, so passing it here is what makes a wrong `--chain` a refusal
 * rather than a transaction on the wrong network.
 */
export function createWallet(chainId, urls, account) {
  const chain = getChain(chainId);
  return createWalletClient({ account, chain: chain.viem, transport: orderedTransport(urls, chain.viem) });
}
