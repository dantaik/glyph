// wallet.js — which wallet is signing, and how the app reaches it.
//
// Reading needs no wallet at all; this exists for the write tab alone.
//
// A browser with two wallet extensions used to be a coin toss: they fight
// over `window.ethereum` and whichever loaded last wins, with no way to say
// which one you meant. EIP-6963 replaced that with an announcement — each
// wallet dispatches itself, with a name, an icon and a reverse-DNS id — so
// the app can list them and the writer can choose. The choice is remembered.
//
// WalletConnect is offered as one more entry when the site is built with
// VITE_WALLETCONNECT_PROJECT_ID. It is the only way to sign on a device with
// no extension at all (a phone, the desktop app), and it is the one piece of
// this project that talks to a relay — for the wallet transport only, never
// for content. Without the variable the module never loads and the entry
// never appears.
//
// One shared store, as before: every component reads the same state and is
// re-rendered by the same event.

import { useEffect, useState } from 'react';
import { DEFAULT_CHAIN_ID, walletChainParams } from './chains';
import { READ_CHAIN_IDS, getRpcUrls } from './config';
import { t } from './i18n';

/** Why the write tab shows no connect button, in the reader's language. */
export const noWalletMessage = () => t('wallet.none');

const EVT = 'cairn:wallet';
const KEY_CHOICE = 'glyph.wallet.choice.v1';

/** The two kinds of wallet the app can reach. */
export const INJECTED = 'injected';
export const WALLETCONNECT = 'walletconnect';

/** The id a lone `window.ethereum` is listed under when it announces nothing. */
export const BARE_INJECTED_RDNS = 'injected';

const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

/**
 * Whether this build offers WalletConnect at all. A literal at build time, so
 * a build without the project id drops the import below entirely.
 */
export const walletConnectEnabled = Boolean(WC_PROJECT_ID);

let state = { account: null, chainId: null, isConnecting: false, selected: null };
let initialized = false;

/** rdns → { info, provider }, as the wallets announce themselves. */
const announced = new Map();
/** The WalletConnect provider, once someone has actually asked for it. */
let wcProvider = null;

function emit(next = {}) {
  state = { ...state, ...next };
  try {
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* non-browser context */
  }
}

function lsGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* quota / privacy mode — the choice just doesn't persist */
  }
}

/** The remembered choice, or null. */
function loadChoice() {
  try {
    const raw = JSON.parse(lsGet(KEY_CHOICE) || 'null');
    if (raw?.kind === WALLETCONNECT) return { kind: WALLETCONNECT };
    if (raw?.kind === INJECTED && typeof raw.rdns === 'string') {
      return { kind: INJECTED, rdns: raw.rdns };
    }
    return null;
  } catch {
    return null;
  }
}

const saveChoice = (choice) => lsSet(KEY_CHOICE, choice ? JSON.stringify(choice) : null);

// --- Listening to whichever provider is current ---------------------------
//
// The events have to follow the selection: a wallet that is no longer the one
// signing must not keep reporting account and chain changes into the app.

let listening = null; // { provider, handlers }

function detach() {
  if (!listening) return;
  const { provider, handlers } = listening;
  for (const [event, fn] of Object.entries(handlers)) {
    try {
      provider.removeListener?.(event, fn);
    } catch {
      /* a provider that will not let go — nothing to do about it */
    }
  }
  listening = null;
}

function attach(provider) {
  if (!provider?.on || listening?.provider === provider) return;
  detach();
  const handlers = {
    accountsChanged: (accounts) => emit({ account: accounts?.[0] || null }),
    chainChanged: (id) => emit({ chainId: id ? Number(id) : null }),
    disconnect: () => emit({ account: null }),
  };
  for (const [event, fn] of Object.entries(handlers)) provider.on(event, fn);
  listening = { provider, handlers };
}

// --- Discovery -------------------------------------------------------------

function discoverProviders() {
  if (typeof window === 'undefined') return;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = event.detail ?? {};
    // rdns is the wallet's identity; two announcements of the same wallet
    // (they re-announce on request) are one wallet.
    if (!info?.rdns || !provider || announced.has(info.rdns)) return;
    announced.set(info.rdns, { info, provider });
    // A wallet announcing itself after the choice was restored is the wallet
    // that choice named: start listening to it.
    if (state.selected?.kind === INJECTED && state.selected.rdns === info.rdns) {
      attach(provider);
      readAccount();
      readChainId();
    }
    emit();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/**
 * The wallets on offer: everything announced, or a lone `window.ethereum`
 * under a generic name when nothing announces itself (an older extension),
 * plus WalletConnect where this build has it.
 */
export function listWallets() {
  const out = [...announced.values()].map(({ info }) => ({
    kind: INJECTED,
    rdns: info.rdns,
    name: info.name,
    icon: info.icon ?? null,
  }));
  if (out.length === 0 && typeof window !== 'undefined' && window.ethereum) {
    out.push({ kind: INJECTED, rdns: BARE_INJECTED_RDNS, name: t('wallet.browserWallet'), icon: null });
  }
  if (walletConnectEnabled) {
    out.push({ kind: WALLETCONNECT, rdns: WALLETCONNECT, name: t('wallet.walletConnect'), icon: null });
  }
  return out;
}

/**
 * The provider to sign with: the one chosen, else the only one announced,
 * else whatever took `window.ethereum`. Null when there is nothing at all —
 * and null, deliberately, for a remembered WalletConnect choice that has not
 * been reconnected yet, so that opening the write tab never puts a QR code on
 * screen nobody asked for.
 */
export function getProvider() {
  const choice = state.selected;
  if (choice?.kind === WALLETCONNECT) return wcProvider;
  if (choice?.kind === INJECTED) {
    const hit = announced.get(choice.rdns);
    if (hit) return hit.provider;
    if (choice.rdns === BARE_INJECTED_RDNS) {
      return (typeof window !== 'undefined' && window.ethereum) || null;
    }
  }
  if (announced.size === 1) return [...announced.values()][0].provider;
  return (typeof window !== 'undefined' && window.ethereum) || null;
}

/** The wallet currently signing, as an entry of `listWallets()`, or null. */
export function selectedWallet() {
  const choice = state.selected;
  if (!choice) return null;
  return listWallets().find((w) => w.kind === choice.kind && (choice.kind === WALLETCONNECT || w.rdns === choice.rdns)) ?? null;
}

// --- WalletConnect ---------------------------------------------------------

async function initWalletConnect() {
  if (!WC_PROJECT_ID) return null; // folded to `return null` in a build without the id
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const [first, ...rest] = READ_CHAIN_IDS.includes(DEFAULT_CHAIN_ID)
    ? [DEFAULT_CHAIN_ID, ...READ_CHAIN_IDS.filter((id) => id !== DEFAULT_CHAIN_ID)]
    : READ_CHAIN_IDS;
  const provider = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    // One required chain and the rest optional: a wallet that only knows
    // Ethereum can still connect, and Taiko is asked for when it is needed.
    chains: [first],
    optionalChains: rest,
    showQrModal: true,
    rpcMap: Object.fromEntries(READ_CHAIN_IDS.map((id) => [id, getRpcUrls(id)[0]])),
    metadata: {
      name: 'Xueni',
      description: 'A writing system that lives entirely on Ethereum',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://xueni.xyz',
      icons: [],
    },
  });
  await provider.enable(); // shows the QR, or resumes a session that exists
  return provider;
}

// --- Reading what the provider says ---------------------------------------

async function readAccount() {
  const provider = getProvider();
  if (!provider) return;
  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts?.[0]) emit({ account: accounts[0] });
  } catch {
    /* read-only until the user connects */
  }
}

async function readChainId() {
  const provider = getProvider();
  if (!provider) return;
  try {
    const id = await provider.request({ method: 'eth_chainId' });
    emit({ chainId: id ? Number(id) : null });
  } catch {
    /* chainId stays null — the UI treats it as "unknown" */
  }
}

async function init() {
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined') return;
  state.selected = loadChoice();
  discoverProviders();
  const provider = getProvider();
  if (!provider) return;
  attach(provider);
  await readAccount();
  await readChainId();
}

// --- Choosing, connecting, disconnecting -----------------------------------

/**
 * Sign with this wallet from now on. For WalletConnect this is also the
 * moment the QR code appears; for an extension it is instant.
 */
export async function selectProvider(choice) {
  if (choice?.kind === WALLETCONNECT) {
    if (!walletConnectEnabled) throw new Error(t('wallet.none'));
    emit({ isConnecting: true });
    try {
      wcProvider = await initWalletConnect();
    } finally {
      emit({ isConnecting: false });
    }
  }
  state.selected = choice ?? null;
  saveChoice(choice ?? null);
  detach();
  attach(getProvider());
  emit({ account: null });
  await readAccount();
  await readChainId();
}

/** Stop signing with the current wallet (and end a WalletConnect session). */
export async function disconnectWallet() {
  if (state.selected?.kind === WALLETCONNECT && wcProvider?.disconnect) {
    await wcProvider.disconnect().catch(() => {});
  }
  wcProvider = null;
  detach();
  saveChoice(null);
  emit({ selected: null, account: null, chainId: null });
}

/**
 * Ask the wallet to switch to `chainId`. If the wallet doesn't know the
 * chain yet (4902), add it first and the switch follows automatically.
 * The provider's chainChanged event updates the shared store afterwards.
 */
export async function switchToConfiguredChain(chainId) {
  const provider = getProvider();
  if (!provider) throw new Error(noWalletMessage());
  const hex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
  } catch (err) {
    const params = walletChainParams(chainId);
    if (err?.code === 4902 && params) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, ...params }],
      });
    } else {
      throw err;
    }
  }
}

export async function connect() {
  // A remembered WalletConnect choice is not live until it is reconnected;
  // asking to connect is the moment to do that.
  if (state.selected?.kind === WALLETCONNECT && !wcProvider) {
    await selectProvider(state.selected);
    return state.account;
  }
  const provider = getProvider();
  if (!provider) throw new Error(noWalletMessage());
  attach(provider);
  emit({ isConnecting: true });
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
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
 * with the chosen provider via accountsChanged / chainChanged / disconnect.
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
    selected: state.selected,
    connect,
  };
}
