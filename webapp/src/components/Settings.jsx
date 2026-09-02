import { useEffect, useRef, useState } from 'react';
import { RPC_URL, CHAIN_ID, saveEndpointConfig, STORAGE_KEYS } from '../lib/config';

const INPUT_CLS =
  'w-full rounded-lg border border-edge-strong bg-paper px-3 py-2 font-mono text-sm placeholder:text-ink-ghost focus:border-accent';
const BTN_QUIET =
  'rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-sunken transition-colors';
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-paper hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

/**
 * Settings modal: lets the user override RPC URL + chain ID at runtime.
 * Persists to localStorage and reloads so all viem clients pick it up.
 */
export default function Settings({ open, onClose }) {
  const [rpcUrl, setRpcUrl] = useState(RPC_URL);
  const [chainId, setChainId] = useState(String(CHAIN_ID));
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return undefined;
    }
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      // Keep Tab focus inside the dialog (simple focus trap).
      const focusables = [...dialog.querySelectorAll('input, button, a[href]')].filter(
        (el) => !el.disabled && el.offsetParent !== null,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = () => {
    saveEndpointConfig({ rpcUrl: rpcUrl.trim() || null, chainId: Number(chainId) || null });
  };

  const handleReset = () => {
    saveEndpointConfig({ rpcUrl: null, chainId: null });
  };

  const hasOverride =
    !!(typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEYS.RPC) || localStorage.getItem(STORAGE_KEYS.CHAIN)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="节点设置"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-xl border border-edge bg-paper-raised p-7 shadow-pop transition duration-150 ease-out motion-reduce:transition-none ${
          entered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-serif text-xl font-semibold">节点设置</h2>
          {hasOverride && <span className="text-xs text-success">已自定义</span>}
        </div>
        <p className="text-xs text-ink-faint mb-6">
          自定义以太坊 RPC 端点；保存后会刷新页面。
        </p>

        <label className="block mb-4">
          <span className="block text-xs tracking-label text-ink-faint mb-1.5">
            RPC 地址
          </span>
          <input
            type="text"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
            placeholder="https://你的节点地址"
            autoFocus
            className={INPUT_CLS}
          />
        </label>

        <label className="block mb-6">
          <span className="block text-xs tracking-label text-ink-faint mb-1.5">
            链 ID
          </span>
          <input
            type="number"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            className={INPUT_CLS}
          />
          <span className="block text-xs text-ink-faint mt-1">
            1 = 主网 · 11155111 = Sepolia 测试网
          </span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <button onClick={handleReset} className={BTN_QUIET}>
            恢复默认
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={BTN_QUIET}>
              取消
            </button>
            <button onClick={handleSave} className={BTN_PRIMARY}>
              保存并刷新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
