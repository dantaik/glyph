import { useState } from 'react';
import { chainName } from '../lib/chains';
import { READ_CHAIN_IDS, savePublishChainId } from '../lib/config';
import { useUrlState } from '../lib/router';
import { NO_WALLET, switchToConfiguredChain, useWallet } from '../lib/wallet';
import AddressLabel from './Address';
import ChainIcon from './ChainIcon';
import SectionHeader from './SectionHeader';
import { BTN_PILL, SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON } from './formStyles';

/**
 * 钱包与网络 — the write tab's own wallet corner: who is writing, and to
 * which chain. None of it belongs in the header: reading needs no wallet,
 * and the chain a post goes to is a decision made when writing it, not a
 * mode the whole app is in.
 *
 * `chainId` is the resolved publish chain (config.resolvePublishChain):
 * the one picked here, else the wallet's own when Glyph reads it, else
 * Ethereum. `picked` says whether it was chosen here. A wallet on some
 * other chain is told so, with the switch offered right there — the
 * publish button stays off until the two agree.
 */
export default function WalletPanel({ chainId, picked, disabled = false }) {
  const { account, chainId: walletChainId, isConnecting, connect } = useWallet();
  const [, navigate] = useUrlState();
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(false);
  const hasProvider = typeof window !== 'undefined' && Boolean(window.ethereum);
  const mismatch = Boolean(account) && walletChainId != null && walletChainId !== chainId;

  const handleConnect = async () => {
    setError(null);
    try {
      await connect();
    } catch (err) {
      if (err?.code !== 4001) setError(err?.message || '连接失败');
    }
  };

  const handleSwitch = async () => {
    setError(null);
    setSwitching(true);
    try {
      await switchToConfiguredChain(chainId);
    } catch (err) {
      setError(err?.code === 4001 ? '已取消' : '切换失败，请在钱包中手动切换');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section className="mb-10" data-wallet-panel="">
      <SectionHeader
        label="钱包与网络"
        right={
          account ? (
            <button
              type="button"
              onClick={() => navigate({ author: account })}
              className="text-xs text-ink-faint hover:text-accent transition-colors"
            >
              查看我的文章
            </button>
          ) : undefined
        }
      />
      <div className="rounded-lg border border-edge bg-paper-raised px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {account ? (
            <span className="inline-flex items-center gap-2 text-sm text-ink-soft" title={account}>
              <AddressLabel address={account} size={16} tailClassName="text-xs" />
              <span className="text-xs text-ink-faint">已连接</span>
            </span>
          ) : hasProvider ? (
            <button type="button" onClick={handleConnect} disabled={isConnecting} className={BTN_PILL}>
              {isConnecting ? '连接中…' : '连接钱包'}
            </button>
          ) : (
            <span className="max-w-md text-xs leading-relaxed text-ink-faint">{NO_WALLET}</span>
          )}

          <div role="group" aria-label="发布到" className="inline-flex items-center gap-2">
            <span className="text-xs text-ink-faint">发布到</span>
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

        {mismatch ? (
          <p role="alert" className="mt-3 text-xs leading-relaxed text-danger">
            钱包在{chainName(walletChainId)}（ID {walletChainId}），发布目标是{chainName(chainId)}。
            <button
              type="button"
              onClick={handleSwitch}
              disabled={switching}
              className="ml-2 font-medium underline underline-offset-2 hover:text-accent disabled:opacity-50"
            >
              {switching ? '切换中…' : '切换钱包网络'}
            </button>
          </p>
        ) : account && walletChainId != null ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            钱包已在{chainName(chainId)}上{picked ? '' : '；发布目标跟随钱包所在的网络'}。
          </p>
        ) : !account ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            发布时会请求连接钱包；文章会永久写入所选网络上的合约。
          </p>
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
