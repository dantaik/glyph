import { useState } from 'react';
import { useT } from '../lib/i18n';
import { WALLETCONNECT, selectProvider } from '../lib/wallet';
import { SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON } from './formStyles';

/**
 * Which wallet signs. Shown only when there is a choice to make — one wallet
 * and no WalletConnect is not a choice, it is just the wallet.
 *
 * The icons come from the wallets themselves (EIP-6963 announces one as a
 * data URI), so this row looks like the wallets the reader installed rather
 * than like a list of names. WalletConnect has no icon of its own here; its
 * name is the whole entry.
 *
 * Props: { wallets, selected, disabled }
 */
export default function WalletChooser({ wallets, selected, disabled = false }) {
  const t = useT();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // the rdns being connected

  const pick = async (wallet) => {
    setError(null);
    setBusy(wallet.rdns);
    try {
      await selectProvider({ kind: wallet.kind, rdns: wallet.rdns });
    } catch (err) {
      // Closing the WalletConnect modal is a decision, not a failure.
      if (err?.code !== 4001 && !/user rejected|closed modal/i.test(String(err?.message ?? ''))) {
        setError(err?.message || t('wallet.connectFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3" data-wallet-chooser="">
      <div role="group" aria-label={t('wallet.chooseWallet')} className={SEGMENT_GROUP}>
        {wallets.map((wallet) => {
          const current =
            selected?.kind === wallet.kind &&
            (wallet.kind === WALLETCONNECT || selected?.rdns === wallet.rdns);
          return (
            <button
              key={`${wallet.kind}:${wallet.rdns}`}
              type="button"
              onClick={() => pick(wallet)}
              aria-pressed={current}
              disabled={disabled || busy != null}
              className={current ? SEGMENT_ON : SEGMENT_OFF}
            >
              {wallet.icon && (
                <img src={wallet.icon} alt="" aria-hidden="true" className="h-3.5 w-3.5 rounded-[3px]" />
              )}
              {busy === wallet.rdns ? t('wallet.connecting') : wallet.name}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
