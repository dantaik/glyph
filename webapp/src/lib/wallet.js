import { useEffect, useState } from 'react';

const EVT = 'cairn:wallet';
let state = { account: null, isConnecting: false };
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
  eth.on('disconnect', () => emit({ account: null }));
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
    emit({ account: accounts?.[0] || null, isConnecting: false });
    return accounts?.[0] || null;
  } catch (e) {
    emit({ isConnecting: false });
    throw e;
  }
}

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
    isConnecting: state.isConnecting,
    hasProvider: hasProvider(),
    connect,
  };
}
