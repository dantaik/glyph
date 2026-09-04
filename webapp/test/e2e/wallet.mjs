// wallet.mjs — EIP-1193 providers for the browser tests, the way MetaMask
// answers: accounts (connected or not), the chain, switching (and adding)
// chains, and sending — a transaction is recorded and a hash handed back.
//
// Each wallet also announces itself the EIP-6963 way, which is how the app
// discovers wallets and how a browser with two of them lets the writer pick.
// Installed with page.addInitScript(); the page reads them as window.ethereum
// (the first one, for anything that still looks there) and the test reads what
// happened at window.__wallet, or window.__wallets[i] for a particular one.

function installWallets(opts) {
  const made = opts.wallets.map((spec, i) => {
    const handlers = {};
    const calls = [];
    let chainId = spec.chainId ?? opts.chainId;
    let connected = Boolean(spec.connected ?? opts.connected);
    const accounts = spec.accounts ?? opts.accounts;
    const emit = (event, arg) => handlers[event]?.(arg);

    const provider = {
      isMetaMask: true,
      on(event, fn) {
        handlers[event] = fn;
      },
      removeListener(event) {
        delete handlers[event];
      },
      async request({ method, params = [] }) {
        calls.push({ method, params });
        switch (method) {
          case 'eth_accounts':
            return connected ? accounts : [];
          case 'eth_requestAccounts':
            connected = true;
            return accounts;
          case 'eth_chainId':
            return chainId;
          case 'net_version':
            return String(parseInt(chainId, 16));
          case 'wallet_switchEthereumChain':
            if (opts.unknownChains?.includes(params[0].chainId)) {
              throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
            }
            chainId = params[0].chainId;
            emit('chainChanged', chainId);
            return null;
          case 'wallet_addEthereumChain':
            chainId = params[0].chainId;
            emit('chainChanged', chainId);
            return null;
          case 'eth_sendTransaction':
            return `0x${(calls.length + 0x1000 + i * 0x100).toString(16).padStart(64, '0')}`;
          case 'eth_estimateGas':
            return '0x5208';
          case 'eth_gasPrice':
            return '0x3b9aca00';
          default:
            throw Object.assign(new Error(`wallet mock: ${method} is not supported`), { code: -32601 });
        }
      },
    };

    return {
      info: { uuid: `uuid-${i}`, name: spec.name, rdns: spec.rdns, icon: spec.icon ?? '' },
      provider,
      handle: {
        calls,
        get chainId() {
          return chainId;
        },
        setChain(id) {
          chainId = id;
          emit('chainChanged', id);
        },
      },
    };
  });

  // Anything still reaching for window.ethereum finds the first wallet, the
  // way a browser with one extension behaves.
  window.ethereum = made[0].provider;
  window.__wallet = made[0].handle;
  window.__wallets = made.map((w) => w.handle);

  // EIP-6963: announce on request, and once now for anything already listening.
  const announce = () => {
    for (const { info, provider } of made) {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({ info, provider }),
        }),
      );
    }
  };
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  window.dispatchEvent(new Event('ethereum#initialized'));
}

/**
 * The init script installing the wallets with `opts`:
 * `{ chainId, accounts, connected, unknownChains, wallets }`, where `wallets`
 * is a list of `{ rdns, name }` (and may override chainId/accounts/connected
 * per wallet). One mock wallet by default.
 */
export function walletScript(opts = {}) {
  const full = {
    chainId: '0x1',
    accounts: ['0x327fa3369B1D1D42120d84bc407e5865ECa7c458'],
    connected: false,
    unknownChains: [],
    wallets: [{ rdns: 'io.mock.wallet', name: 'Mock Wallet' }],
    ...opts,
  };
  return `(${installWallets.toString()})(${JSON.stringify(full)})`;
}
