import { useState } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import Settings from './components/Settings';
import { GlyphMark } from './components/Icons';
import { FIXTURES_MODE } from './lib/data';
import { GLYPH_ADDRESS, CHAIN_ID } from './lib/config';
import { useWallet } from './lib/wallet';
import { etherscanAddrUrl, shortAddr } from './lib/format';

const CONTRACT_CONFIGURED = GLYPH_ADDRESS !== '0xYourGlyphContractAddress';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { chainId: walletChainId } = useWallet();
  const chainMismatch = walletChainId != null && walletChainId !== CHAIN_ID;

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
          钱包连接的链（ID {walletChainId}）与应用配置的链（ID {CHAIN_ID}）不一致，请在钱包中切换网络后重试。
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
        <GlyphMark size={16} className="text-ink-ghost" />

        {CONTRACT_CONFIGURED && (
          <a
            href={etherscanAddrUrl(GLYPH_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            title="在 Etherscan 查看合约"
            className="mt-3 inline-block font-mono text-[11px] tabular-nums text-ink-faint bg-paper-sunken rounded px-1.5 py-0.5 hover:text-accent transition-colors"
          >
            {shortAddr(GLYPH_ADDRESS)}
          </a>
        )}
      </footer>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {FIXTURES_MODE && (
        <div className="fixed bottom-3 right-3 z-50 rounded-full bg-paper-sunken px-2.5 py-1 text-[10px] text-ink-ghost">
          演示数据
        </div>
      )}
    </div>
  );
}
