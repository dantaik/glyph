// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const KEY = 'glyph.wallet.choice.v1';

/** An EIP-1193 provider that records what was asked of it. */
function makeProvider({ accounts = ['0xabc'], chainId = '0x1' } = {}) {
  const handlers = {};
  const calls = [];
  return {
    handlers,
    calls,
    on(event, fn) {
      handlers[event] = fn;
    },
    removeListener(event) {
      delete handlers[event];
    },
    async request({ method }) {
      calls.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts;
      if (method === 'eth_chainId') return chainId;
      return null;
    },
  };
}

const wallet = (rdns, name, provider) => ({ info: { rdns, name, uuid: rdns, icon: '' }, provider });

/**
 * A fresh module (the store is module state) with `wallets` announcing
 * themselves the way real ones do: on request, and only then.
 */
async function walletStore({ wallets = [], stored = null, bareInjected = null } = {}) {
  vi.resetModules();
  localStorage.clear();
  if (stored) localStorage.setItem(KEY, JSON.stringify(stored));
  window.ethereum = bareInjected ?? wallets[0]?.provider ?? undefined;

  const announce = () => {
    for (const { info, provider } of wallets) {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info, provider } }));
    }
  };
  window.addEventListener('eip6963:requestProvider', announce);

  const mod = await import('../../src/lib/wallet');
  // The store wakes up with the hook, the way it does in the app.
  renderHook(() => mod.useWallet());
  return {
    mod,
    stop: () => window.removeEventListener('eip6963:requestProvider', announce),
  };
}

beforeEach(() => {
  localStorage.clear();
  delete window.ethereum;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('discovering the wallets a browser has', () => {
  it('lists each one once, however often it announces itself', async () => {
    const a = makeProvider();
    const b = makeProvider();
    const { mod, stop } = await walletStore({
      // The same wallet twice, as a re-announcement looks.
      wallets: [wallet('io.one', 'One', a), wallet('io.two', 'Two', b), wallet('io.one', 'One', a)],
    });
    await waitFor(() => expect(mod.listWallets()).toHaveLength(2));
    expect(mod.listWallets().map((w) => w.name)).toEqual(['One', 'Two']);
    stop();
  });

  it('signs with the only wallet there is, without being asked', async () => {
    const only = makeProvider();
    const { mod, stop } = await walletStore({ wallets: [wallet('io.only', 'Only', only)] });
    await waitFor(() => expect(mod.listWallets()).toHaveLength(1));
    expect(mod.getProvider()).toBe(only);
    stop();
  });

  it('falls back to a lone window.ethereum that announces nothing', async () => {
    const bare = makeProvider();
    const { mod, stop } = await walletStore({ bareInjected: bare });
    expect(mod.getProvider()).toBe(bare);
    expect(mod.listWallets()).toHaveLength(1);
    expect(mod.listWallets()[0].rdns).toBe(mod.BARE_INJECTED_RDNS);
    stop();
  });

  it('has nothing to offer when the browser has no wallet at all', async () => {
    const { mod, stop } = await walletStore({});
    expect(mod.listWallets()).toEqual([]);
    expect(mod.getProvider()).toBeNull();
    stop();
  });
});

describe('choosing between them', () => {
  it('remembers the choice, and honours it on the next visit', async () => {
    const a = makeProvider();
    const b = makeProvider();
    const { mod, stop } = await walletStore({
      wallets: [wallet('io.one', 'One', a), wallet('io.two', 'Two', b)],
      stored: { kind: 'injected', rdns: 'io.two' },
    });
    await waitFor(() => expect(mod.getProvider()).toBe(b));
    expect(mod.selectedWallet()?.name).toBe('Two');
    stop();
  });

  it('moves its ear to the wallet just chosen', async () => {
    const a = makeProvider();
    const b = makeProvider();
    const { mod, stop } = await walletStore({
      wallets: [wallet('io.one', 'One', a), wallet('io.two', 'Two', b)],
    });
    await waitFor(() => expect(mod.listWallets()).toHaveLength(2));
    // With two announced and no choice, the app listens to window.ethereum,
    // which is the first of them.
    expect(Object.keys(a.handlers)).toContain('accountsChanged');

    await mod.selectProvider({ kind: 'injected', rdns: 'io.two' });

    // The wallet that is no longer signing must not keep reporting changes.
    expect(Object.keys(a.handlers)).toEqual([]);
    expect(Object.keys(b.handlers)).toEqual(
      expect.arrayContaining(['accountsChanged', 'chainChanged', 'disconnect']),
    );
    expect(mod.getProvider()).toBe(b);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ kind: 'injected', rdns: 'io.two' });
    stop();
  });

  it('forgets the wallet on disconnect', async () => {
    const a = makeProvider();
    const { mod, stop } = await walletStore({ wallets: [wallet('io.one', 'One', a)] });
    await mod.selectProvider({ kind: 'injected', rdns: 'io.one' });
    await mod.disconnectWallet();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mod.selectedWallet()).toBeNull();
    expect(Object.keys(a.handlers)).toEqual([]);
    stop();
  });
});

describe('WalletConnect, in a build that was not given a project id', () => {
  it('is not offered, and is never reached for', async () => {
    const a = makeProvider();
    const { mod, stop } = await walletStore({ wallets: [wallet('io.one', 'One', a)] });
    expect(mod.walletConnectEnabled).toBe(false);
    expect(mod.listWallets().some((w) => w.kind === mod.WALLETCONNECT)).toBe(false);
    // Asking for it anyway is refused rather than loading anything.
    await expect(mod.selectProvider({ kind: mod.WALLETCONNECT })).rejects.toThrow();
    stop();
  });
});
