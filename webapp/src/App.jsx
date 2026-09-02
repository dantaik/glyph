import { useEffect, useState } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import Settings from './components/Settings';
import { FIXTURES_MODE } from './lib/data';
import { GLYPH_ADDRESS, CHAIN_ID } from './lib/config';
import { useWallet, switchToConfiguredChain } from './lib/wallet';
import { etherscanAddrUrl, shortAddr, chainName, fmtBlock } from './lib/format';
import { readFeedScan } from './lib/blogReader';

const CONTRACT_CONFIGURED = GLYPH_ADDRESS !== '0xYourGlyphContractAddress';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { chainId: walletChainId } = useWallet();
  const chainMismatch = walletChainId != null && walletChainId !== CHAIN_ID;
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  // Persisted home-feed scan range (head + frontier), shown in the footer.
  const [feedScan, setFeedScan] = useState(readFeedScan);
  useEffect(() => {
    const sync = () => setFeedScan(readFeedScan());
    window.addEventListener('glyph:feedscan', sync);
    return () => window.removeEventListener('glyph:feedscan', sync);
  }, []);

  const handleSwitchChain = async () => {
    setSwitchError(null);
    setSwitching(true);
    try {
      await switchToConfiguredChain(CHAIN_ID);
    } catch (err) {
      setSwitchError(err?.code === 4001 ? '已取消' : '切换失败，请在钱包中手动切换');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        tab={tab}
        onTabChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {chainMismatch && (
        <div
          role="alert"
          className="border-b border-danger-wash bg-danger-wash/60 px-5 py-2 text-center text-sm text-danger"
        >
          钱包连接的链（ID {walletChainId}）与应用配置的链（ID {CHAIN_ID}）不一致。
          <button
            type="button"
            onClick={handleSwitchChain}
            disabled={switching}
            className="ml-2 font-medium underline underline-offset-2 hover:text-accent disabled:opacity-50"
          >
            {switching ? '切换中…' : '切换网络'}{switchError ? `（${switchError}）` : ''}
          </button>
        </div>
      )}
      <main className="flex-1 w-full mx-auto max-w-5xl px-5 sm:px-6 pt-8 pb-16">
        {tab === 'read' ? (
          <Reader onStartWriting={() => setTab('write')} />
        ) : (
          <Publisher />
        )}
      </main>
      <footer className="border-t border-edge py-10 text-center">
        {CONTRACT_CONFIGURED && (
          <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-faint tabular-nums">
            <span>{chainName()}</span>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={etherscanAddrUrl(GLYPH_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              title="在 Etherscan 查看合约"
              className="inline-block font-mono text-2xs tabular-nums text-ink-faint hover:text-accent transition-colors"
            >
              合约：{shortAddr(GLYPH_ADDRESS)}
            </a>
            {feedScan?.head != null && feedScan?.frontier != null && (
              <>
                <span className="select-none" aria-hidden="true">·</span>
                <span>扫描范围 {fmtBlock(feedScan.frontier)} 至 {fmtBlock(feedScan.head)}</span>
              </>
            )}
          </p>
        )}
      </footer>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {FIXTURES_MODE && (
        <div className="fixed bottom-3 right-3 z-50 rounded-full bg-paper-sunken px-2.5 py-1 text-2xs text-ink-ghost">
          演示数据
        </div>
      )}
    </div>
  );
}
