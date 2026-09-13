// @vitest-environment jsdom
// publisherHooks.test.jsx — the write tab on a chain where the v2 contract
// is deployed: the hook section, publishing through a hook, and signing a
// post for a relayer instead of sending it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../src/lib/price', () => ({
  getMarketStates: async () => ({}),
  estimatePublishGas: () => 21_000,
  estimateImageGas: () => 21_000,
  gasToCost: () => ({ eth: null, usd: null }),
  fmtEth: () => '—',
  fmtUsd: () => '',
  fmtGwei: () => '—',
}));
vi.mock('../../src/lib/clients', () => ({ getClient: () => ({}) }));

const published = [];
const signed = [];
vi.mock('../../src/lib/publish', async () => {
  const real = await vi.importActual('../../src/lib/publish');
  return {
    ...real,
    measurePayload: async () => ({ bytes: 100, limit: 1000, ok: true }),
    publishPost: async (args) => {
      published.push(args);
      return `0x${'22'.repeat(32)}`;
    },
    signRelayTicket: async (args) => {
      signed.push(args);
      return {
        xueni: { relay: 1 },
        chainId: args.chainId,
        contract: '0x0000008d02020df6bcdd56a888cfc9ed9b9053ec',
        author: '0x327fa3369b1d1d42120d84bc407e5865eca7c458',
        title: `0x${'00'.repeat(32)}`,
        titleText: args.title,
        payload: '0x3b',
        hook: args.hook ?? null,
        hookData: args.hookData ?? '0x',
        index: 4,
        deadline: 1_900_000_000,
        signature: `0x${'ab'.repeat(65)}`,
        value: String(args.value ?? 0n),
      };
    },
  };
});

let v2 = true;
// One reader object, handed out every time: the write tab keys its
// "is v2 here?" effect on the reader, as the real `getReader` returns the
// same one per chain, and a fresh object per render would loop forever.
const reader = {
  chainId: 1,
  isDeployed: async (version) => (version === 2 ? v2 : true),
  countOf: async () => 3n,
  count: async () => 3n,
  baseFees: async () => [],
  resolveImages: async (md) => ({ markdown: md, urls: [] }),
};
vi.mock('../../src/lib/data', () => ({
  FIXTURES_MODE: null,
  getReader: () => reader,
}));

vi.mock('../../src/lib/wallet', () => ({
  useWallet: () => ({ account: '0x327fa3369B1D1D42120d84bc407e5865ECa7c458', chainId: 1, isConnecting: false, selected: null, connect: async () => '0x327fa3369B1D1D42120d84bc407e5865ECa7c458' }),
  listWallets: () => [],
  selectedWallet: () => null,
  selectProvider: async () => {},
  disconnectWallet: async () => {},
  switchToConfiguredChain: async () => {},
  walletConnectEnabled: false,
  noWalletMessage: () => 'no wallet',
  INJECTED: 'injected',
  WALLETCONNECT: 'walletconnect',
}));

const Publisher = (await import('../../src/components/Publisher')).default;
const { clearDraft } = await import('../../src/lib/drafts');
const { setLang, t } = await import('../../src/lib/i18n');

window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const titleBox = () => screen.getByPlaceholderText(t('publish.titlePlaceholder'));

beforeEach(async () => {
  localStorage.clear();
  setLang('en');
  v2 = true;
  published.length = 0;
  signed.length = 0;
  await clearDraft();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the write tab with the v2 contract', () => {
  it('offers a hook and publishes through it to v2', async () => {
    render(<Publisher />);
    await waitFor(() => expect(document.querySelector('[data-publish-target="2"]')).toBeTruthy());
    expect(screen.getByText('This post goes to Xueni on Ethereum.')).toBeTruthy();
    fireEvent.change(titleBox(), { target: { value: 'Through a hook' } });
    fireEvent.click(screen.getByRole('button', { name: 'One hook' }));
    fireEvent.change(screen.getByLabelText('Hook address'), { target: { value: '0x00000000000000000000000000000000000000ab' } });
    fireEvent.change(screen.getByLabelText('Hook data (hex)'), { target: { value: '0x01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish on-chain' }));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({
      chainId: 1,
      title: 'Through a hook',
      version: 2,
      hook: '0x00000000000000000000000000000000000000ab',
      hookData: '0x01',
      value: 0n,
    });
    await waitFor(() => expect(screen.getByText('Published to Ethereum')).toBeTruthy());
  });

  it('will not publish through a hook that is malformed', async () => {
    render(<Publisher />);
    await waitFor(() => expect(document.querySelector('[data-publish-target="2"]')).toBeTruthy());
    fireEvent.change(titleBox(), { target: { value: 'Nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'One hook' }));
    fireEvent.change(screen.getByLabelText('Hook address'), { target: { value: '0x12' } });
    expect(screen.getByRole('button', { name: 'Publish on-chain' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Publish on-chain' }).disabled).toBe(false);
  });

  it('signs for a relayer instead of sending, and shows the ticket', async () => {
    render(<Publisher />);
    await waitFor(() => expect(document.querySelector('[data-publish-target="2"]')).toBeTruthy());
    fireEvent.change(titleBox(), { target: { value: 'Signed, not sent' } });
    fireEvent.change(screen.getByLabelText('Valid for'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign for a relayer instead' }));
    await waitFor(() => expect(document.querySelector('[data-relay-ticket]')).toBeTruthy());
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({ chainId: 1, title: 'Signed, not sent', days: 30, hook: null });
    expect(published).toHaveLength(0);
    expect(document.querySelector('[data-relay-ticket]').textContent).toContain('as your post #5 on Xueni on Ethereum');
    expect(document.querySelector('[data-relay-ticket] textarea').value).toContain('"xueni"');
  });

  it('without v2 on the chain, says so and publishes to v1', async () => {
    v2 = false;
    render(<Publisher />);
    await waitFor(() => expect(document.querySelector('[data-publish-target="1"]')).toBeTruthy());
    expect(screen.getByText(/Hooks need Xueni, which is not deployed on Ethereum yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign for a relayer instead' })).toBeNull();
    expect(document.querySelector('[data-relay-panel]')).toBeNull();
    fireEvent.change(titleBox(), { target: { value: 'Plain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish on-chain' }));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ version: 1, hook: null, hookData: '0x' });
  });
});
