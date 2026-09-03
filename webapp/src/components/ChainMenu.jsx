import { useEffect, useRef, useState } from 'react';
import { CHAINS, SELECTABLE_CHAIN_IDS } from '../lib/chains';
import { setActiveChain, useActiveChainId } from '../lib/config';
import { Check, ChevronDown } from './Icons';
import ChainIcon from './ChainIcon';

/**
 * Chain switcher in the masthead. Glyph is CREATE2-deployed to the same
 * address on every chain, so switching is purely a matter of which node the
 * reader talks to — picking one persists it and swaps the reader in place.
 * Nothing reloads: a scan running on the chain being left finishes in the
 * background and its results are cached for the next visit.
 *
 * The active chain is always listed even when it isn't one of the selectable
 * ones (a testnet from VITE_CHAIN_ID), so the menu never hides where you are.
 *
 * The trigger is the chain's mark alone; the menu is where the marks get
 * their names.
 */
export default function ChainMenu() {
  const chainId = useActiveChainId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const ids = SELECTABLE_CHAIN_IDS.includes(chainId)
    ? SELECTABLE_CHAIN_IDS
    : [...SELECTABLE_CHAIN_IDS, chainId];
  const current = CHAINS[chainId];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换网络"
        title={current?.name ?? `链 ${chainId}`}
        className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-ink-soft hover:bg-paper-sunken hover:text-accent transition-colors"
      >
        {/* Mark only — the chain's logo says which chain this is at any
            width, and the name would be the widest thing in the masthead.
            It is spelled out in the menu, and in the page footer. */}
        <ChainIcon chainId={chainId} size={18} className="shrink-0 text-accent" />
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-edge bg-paper-raised py-1 shadow-pop"
        >
          {ids.map((id) => {
            const chain = CHAINS[id];
            const active = id === chainId;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) setActiveChain(id);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                  active ? 'text-accent' : 'text-ink-soft hover:bg-paper-sunken hover:text-accent'
                }`}
              >
                <ChainIcon chainId={id} size={16} className="shrink-0" />
                <span className="flex-1 truncate">{chain?.name ?? `链 ${id}`}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-ghost">{id}</span>
                <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
