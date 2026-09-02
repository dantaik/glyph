import { useEffect, useRef, useState } from 'react';
import { CHAINS, SELECTABLE_CHAIN_IDS } from '../lib/chains';
import { CHAIN_ID, setActiveChain } from '../lib/config';
import { Check, ChevronDown } from './Icons';

/**
 * Chain switcher in the masthead. Glyph is CREATE2-deployed to the same
 * address on every chain, so switching is purely a matter of which node the
 * reader talks to — picking one persists it and reloads, since the viem
 * client is built once at module load.
 *
 * The active chain is always listed even when it isn't one of the selectable
 * ones (a testnet from VITE_CHAIN_ID), so the menu never hides where you are.
 */
export default function ChainMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const ids = SELECTABLE_CHAIN_IDS.includes(CHAIN_ID)
    ? SELECTABLE_CHAIN_IDS
    : [...SELECTABLE_CHAIN_IDS, CHAIN_ID];
  const current = CHAINS[CHAIN_ID];

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
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-sunken hover:text-accent transition-colors"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <span className="hidden min-[380px]:inline">{current?.name ?? `链 ${CHAIN_ID}`}</span>
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-edge bg-paper-raised py-1 shadow-pop"
        >
          {ids.map((id) => {
            const chain = CHAINS[id];
            const active = id === CHAIN_ID;
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
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'text-accent' : 'text-ink-soft hover:bg-paper-sunken hover:text-accent'
                }`}
              >
                <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
                <span className="flex-1 truncate">{chain?.name ?? `链 ${id}`}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-ghost">{id}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
