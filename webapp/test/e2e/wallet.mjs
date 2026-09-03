// wallet.mjs — an EIP-1193 provider for the browser tests, the way MetaMask
// answers: accounts (connected or not), the chain, switching (and adding)
// chains, and sending — a transaction is recorded and a hash handed back.
// Installed with page.addInitScript(); the page reads it as window.ethereum
// and the test reads what happened at window.__wallet.

function installWallet(opts) {
  const handlers = {};
  const calls = [];
  let chainId = opts.chainId;
  let connected = Boolean(opts.connected);
  const accounts = opts.accounts;
  const emit = (event, arg) => handlers[event]?.(arg);
  window.ethereum = {
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
          return `0x${(calls.length + 0x1000).toString(16).padStart(64, '0')}`;
        case 'eth_estimateGas':
          return '0x5208';
        case 'eth_gasPrice':
          return '0x3b9aca00';
        default:
          throw Object.assign(new Error(`wallet mock: ${method} is not supported`), { code: -32601 });
      }
    },
  };
  window.__wallet = {
    calls,
    get chainId() {
      return chainId;
    },
    setChain(id) {
      chainId = id;
      emit('chainChanged', id);
    },
  };
  window.dispatchEvent(new Event('ethereum#initialized'));
}

/** The init script installing the wallet with `opts`: { chainId, accounts, connected, unknownChains }. */
export function walletScript(opts = {}) {
  const full = {
    chainId: '0x1',
    accounts: ['0x327fa3369B1D1D42120d84bc407e5865ECa7c458'],
    connected: false,
    unknownChains: [],
    ...opts,
  };
  return `(${installWallet.toString()})(${JSON.stringify(full)})`;
}
