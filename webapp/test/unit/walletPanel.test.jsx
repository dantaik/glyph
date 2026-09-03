// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const ACCOUNT = '0x327fa3369B1D1D42120d84bc407e5865ECa7c458';

/**
 * An EIP-1193 provider the way MetaMask answers: accounts, the chain, a
 * switch that may not know the chain (4902), and the events the app
 * listens for. `calls` records every request.
 */
function fakeProvider({ accounts = [], chainId = '0x1', unknownChains = [] } = {}) {
  const handlers = new Map();
  const calls = [];
  const p = {
    accounts,
    chainId,
    calls,
    on(event, fn) {
      handlers.set(event, fn);
    },
    emit(event, arg) {
      handlers.get(event)?.(arg);
    },
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case 'eth_accounts':
          return p.accounts;
        case 'eth_requestAccounts':
          p.accounts = [ACCOUNT];
          return p.accounts;
        case 'eth_chainId':
          return p.chainId;
        case 'wallet_switchEthereumChain': {
          const id = params[0].chainId;
          if (unknownChains.includes(id)) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
          p.chainId = id;
          p.emit('chainChanged', id);
          return null;
        }
        case 'wallet_addEthereumChain': {
          const id = params[0].chainId;
          p.chainId = id;
          p.emit('chainChanged', id);
          return null;
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
  return p;
}

// wallet.js and config.js keep module state (the provider subscription,
// the stored pick), so every case starts from fresh modules.
async function mountPanel({ provider = null, disabled = false } = {}) {
  vi.resetModules();
  if (provider) window.ethereum = provider;
  else delete window.ethereum;
  const [{ default: WalletPanel }, config, wallet] = await Promise.all([
    import('../../src/components/WalletPanel'),
    import('../../src/lib/config'),
    import('../../src/lib/wallet'),
  ]);
  // The write tab's own resolution, so the panel sees what Publisher sees.
  function Harness() {
    const { chainId: walletChainId } = wallet.useWallet();
    const picked = config.usePublishChainId();
    const chainId = config.resolvePublishChain(picked, walletChainId);
    return <WalletPanel chainId={chainId} picked={picked != null} disabled={disabled} />;
  }
  const utils = render(<Harness />);
  // Let the provider's initial eth_accounts / eth_chainId settle.
  await act(async () => {
    await Promise.resolve();
  });
  return { config, wallet, ...utils };
}

const pressed = (name) => screen.getByRole('button', { name, pressed: true });

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  delete window.ethereum;
});

describe('WalletPanel', () => {
  it('without a wallet, says so and still lets the chain be picked', async () => {
    await mountPanel();
    expect(screen.getByText(/未检测到钱包/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '连接钱包' })).toBeNull();
    expect(pressed('Ethereum')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Taiko' }));
    expect(pressed('Taiko')).toBeTruthy();
    expect(localStorage.getItem('glyph.publishChain.v1')).toBe('167000');
  });

  it('connects on request and offers the author page', async () => {
    const provider = fakeProvider();
    await mountPanel({ provider });
    fireEvent.click(screen.getByRole('button', { name: '连接钱包' }));
    await waitFor(() => expect(screen.getByText('已连接')).toBeTruthy());
    expect(provider.calls.map((c) => c.method)).toContain('eth_requestAccounts');
    expect(screen.getByTitle(ACCOUNT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看我的文章' }));
    expect(window.location.pathname).toBe(`/author/${ACCOUNT}`);
  });

  it('follows the wallet\'s chain when nothing was picked', async () => {
    await mountPanel({ provider: fakeProvider({ accounts: [ACCOUNT], chainId: '0x28c58' }) });
    await waitFor(() => expect(pressed('Taiko')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/发布目标跟随钱包/)).toBeTruthy();
  });

  it('flags a wallet on another chain than the pick, and switches it', async () => {
    const provider = fakeProvider({ accounts: [ACCOUNT], chainId: '0x28c58' });
    await mountPanel({ provider });
    await waitFor(() => expect(pressed('Taiko')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ethereum' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('钱包在Taiko');
    expect(alert.textContent).toContain('发布目标是Ethereum');
    fireEvent.click(screen.getByRole('button', { name: '切换钱包网络' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(provider.calls.at(-1)).toEqual({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    expect(screen.getByText(/钱包已在Ethereum上/)).toBeTruthy();
  });

  it('adds a chain the wallet does not know before switching to it', async () => {
    const provider = fakeProvider({ accounts: [ACCOUNT], chainId: '0x1', unknownChains: ['0x28c58'] });
    await mountPanel({ provider });
    await waitFor(() => expect(screen.getByText('已连接')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Taiko' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '切换钱包网络' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    const added = provider.calls.find((c) => c.method === 'wallet_addEthereumChain');
    expect(added.params[0]).toMatchObject({ chainId: '0x28c58', chainName: expect.any(String) });
  });

  it('a wallet on a chain Glyph does not read is told so', async () => {
    await mountPanel({ provider: fakeProvider({ accounts: [ACCOUNT], chainId: '0xaa36a7' }) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ID 11155111');
    expect(pressed('Ethereum')).toBeTruthy();
  });

  it('keeps the pick while a publish is in flight', async () => {
    await mountPanel({ disabled: true });
    expect(screen.getByRole('button', { name: 'Taiko' }).disabled).toBe(true);
  });
});
