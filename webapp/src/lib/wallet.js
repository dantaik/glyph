import { useEffect, useState } from 'react';
import { walletChainParams } from './chains';
import { t } from './i18n';

/** Why the write tab shows no connect button, in the reader's language. */
export const noWalletMessage = () => t('wallet.none');

const EVT = 'cairn:wallet';
let state = { account: null, chainId: null, isConnecting: false };
let initialized = false;

function emit(next) {
  state = { ...state, ...next };
  window.dispatchEvent(new CustomEvent(EVT));
}

function subscribeProvider() {
  const eth = window.ethereum;
  if (!eth?.on) return;
  eth.on('accountsChanged', (accounts) => {
    emit({ account: accounts?.[0] || null });
  });
  eth.on('chainChanged', (id) => {
    emit({ chainId: id ? Number(id) : null });
  });
  eth.on('disconnect', () => emit({ account: null }));
}

async function readChainId() {
  try {
    const id = await window.ethereum.request({ method: 'eth_chainId' });
    emit({ chainId: id ? Number(id) : null });
  } catch {
    // chainId stays null — UI treats it as "unknown"
  }
}

async function init() {
  if (initialized) return;
  initialized = true;
  const eth = window.ethereum;
  if (!eth) return;
  subscribeProvider();
  try {
    const accounts = await eth.request({ method: 'eth_accounts' });
    if (accounts?.[0]) emit({ account: accounts[0] });
    await readChainId();
  } catch {
    /* silent: read-only until user connects */
  }
}


/**
 * Ask the wallet to switch to `chainId`. If the wallet doesn't know the
 * chain yet (4902), add it first and the switch follows automatically.
 * The provider's chainChanged event updates the shared store afterwards.
 */
export async function switchToConfiguredChain(chainId) {
  const eth = window.ethereum;
  if (!eth) throw new Error(noWalletMessage());
  const hex = `0x${chainId.toString(16)}`;
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
  } catch (err) {
    const params = walletChainParams(chainId);
    if (err?.code === 4902 && params) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, ...params }],
      });
    } else {
      throw err;
    }
  }
}

export async function connect() {
  const eth = window.ethereum;
  if (!eth) throw new Error(noWalletMessage());
  emit({ isConnecting: true });
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const account = accounts?.[0] || null;
    emit({ account, isConnecting: false });
    await readChainId();
    return account;
  } catch (e) {
    emit({ isConnecting: false });
    throw e;
  }
}

/**
 * Wallet hook — every component reads the same shared store, kept in sync
 * with the provider via accountsChanged / chainChanged / disconnect.
 */
export function useWallet() {
  const [, force] = useState(0);
  useEffect(() => {
    init();
    const onChange = () => force((n) => n + 1);
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);
  return {
    account: state.account,
    chainId: state.chainId,
    isConnecting: state.isConnecting,
    connect,
  };
}
