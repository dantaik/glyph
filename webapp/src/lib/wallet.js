import { useEffect, useState } from 'react';

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

export function hasProvider() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connect() {
  const eth = window.ethereum;
  if (!eth) throw new Error('未检测到钱包，请安装 MetaMask 等浏览器钱包。');
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
    hasProvider: hasProvider(),
    connect,
  };
}
