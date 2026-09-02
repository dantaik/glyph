import { useState } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import Settings from './components/Settings';
import { GlyphMark } from './components/Icons';
import { FIXTURES_MODE } from './lib/data';
import { GLYPH_ADDRESS } from './lib/config';
import { etherscanAddrUrl, shortAddr } from './lib/format';

const CONTRACT_CONFIGURED = GLYPH_ADDRESS !== '0xYourGlyphContractAddress';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-dvh flex flex-col">
      <Header
        tab={tab}
        onTabChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main
        className={`flex-1 w-full mx-auto px-5 sm:px-6 pt-8 pb-16 ${
          tab === 'read' ? 'max-w-[44rem]' : 'max-w-5xl'
        }`}
      >
        {tab === 'read' ? (
          <Reader onStartWriting={() => setTab('write')} />
        ) : (
          <Publisher />
        )}
      </main>
      <footer className="border-t border-edge py-10 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <GlyphMark size={16} className="text-ink-ghost" />
          <span className="font-serif text-sm text-ink-soft">雁过留声</span>
        </div>

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
