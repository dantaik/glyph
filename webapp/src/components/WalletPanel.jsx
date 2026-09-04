import { useState } from 'react';
import { READ_CHAIN_IDS, savePublishChainId } from '../lib/config';
import { chainName } from '../lib/format';
import { useUrlState } from '../lib/router';
import { useT } from '../lib/i18n';
import {
  disconnectWallet,
  listWallets,
  selectedWallet,
  switchToConfiguredChain,
  useWallet,
} from '../lib/wallet';
import AddressLabel from './Address';
import ChainIcon from './ChainIcon';
import WalletChooser from './WalletChooser';
import SectionHeader from './SectionHeader';
import { BTN_PILL, SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON } from './formStyles';
import { Body, Meta, Note } from './Text';

/**
 * Wallet and network — the write tab's own wallet corner: who is writing,
 * and to which chain. None of it belongs in the header: reading needs no wallet,
 * and the chain a post goes to is a decision made when writing it, not a
 * mode the whole app is in.
 *
 * `chainId` is the resolved publish chain (config.resolvePublishChain):
 * the one picked here, else the wallet's own when Xueni reads it, else
 * Ethereum. `picked` says whether it was chosen here. A wallet on some
 * other chain is told so, with the switch offered right there — the
 * publish button stays off until the two agree.
 */
export default function WalletPanel({ chainId, picked, disabled = false }) {
  const t = useT();
  const { account, chainId: walletChainId, isConnecting, selected, connect } = useWallet();
  const [, navigate] = useUrlState();
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(false);
  // Every wallet that announced itself, plus WalletConnect where this build
  // has it. Read on each render: wallets announce asynchronously, and the
  // store re-renders this panel when one does.
  const wallets = listWallets();
  const current = selectedWallet();
  const hasProvider = wallets.length > 0;
  const mismatch = Boolean(account) && walletChainId != null && walletChainId !== chainId;

  const handleConnect = async () => {
    setError(null);
    try {
      await connect();
    } catch (err) {
      if (err?.code !== 4001) setError(err?.message || t('wallet.connectFailed'));
    }
  };

  const handleSwitch = async () => {
    setError(null);
    setSwitching(true);
    try {
      await switchToConfiguredChain(chainId);
    } catch (err) {
      setError(err?.code === 4001 ? t('wallet.cancelled') : t('wallet.switchFailed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section className="mb-10" data-wallet-panel="">
      <SectionHeader
        label={t('wallet.heading')}
        right={
          account ? (
            <Meta
              as="button"
              type="button"
              onClick={() => navigate({ author: account })}
              className="hover:text-accent transition-colors"
            >
              {t('wallet.myPosts')}
            </Meta>
          ) : undefined
        }
      />
      <div className="rounded-lg border border-edge bg-paper-raised px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {account ? (
            <Body as="span" className="inline-flex items-center gap-2" title={account}>
              <AddressLabel address={account} size={16} tailClassName="text-xs" />
              <Meta as="span">
                {current ? t('wallet.connectedWith', { wallet: current.name }) : t('wallet.connected')}
              </Meta>
              <Meta
                as="button"
                type="button"
                onClick={() => disconnectWallet()}
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                {t('wallet.disconnect')}
              </Meta>
            </Body>
          ) : hasProvider ? (
            <button type="button" onClick={handleConnect} disabled={isConnecting} className={BTN_PILL}>
              {isConnecting ? t('wallet.connecting') : t('wallet.connect')}
            </button>
          ) : (
            <Note as="span" className="max-w-md">{t('wallet.none')}</Note>
          )}

          <div role="group" aria-label={t('wallet.publishTo')} className="inline-flex items-center gap-2">
            <Meta as="span">{t('wallet.publishTo')}</Meta>
            <div className={SEGMENT_GROUP}>
              {READ_CHAIN_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => savePublishChainId(id)}
                  aria-pressed={id === chainId}
                  disabled={disabled}
                  className={id === chainId ? SEGMENT_ON : SEGMENT_OFF}
                >
                  <ChainIcon chainId={id} size={12} />
                  {chainName(id)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Only when there is a choice to make: one wallet is not a choice. */}
        {wallets.length > 1 && (
          <WalletChooser wallets={wallets} selected={selected} disabled={disabled} />
        )}

        {mismatch ? (
          <p role="alert" className="mt-3 text-xs leading-relaxed text-danger">
            {t('wallet.mismatch', {
              walletChain: chainName(walletChainId),
              walletChainId,
              targetChain: chainName(chainId),
            })}
            <button
              type="button"
              onClick={handleSwitch}
              disabled={switching}
              className="ml-2 font-medium underline underline-offset-2 hover:text-accent disabled:opacity-50"
            >
              {switching ? t('wallet.switching') : t('wallet.switch')}
            </button>
          </p>
        ) : account && walletChainId != null ? (
          <Note className="mt-3">
            {picked
              ? t('wallet.onTarget', { chain: chainName(chainId) })
              : t('wallet.followingWallet', { chain: chainName(chainId) })}
          </Note>
        ) : !account ? (
          <Note className="mt-3">{t('wallet.willConnect')}</Note>
        ) : null}
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
