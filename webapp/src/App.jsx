import { useCallback, useState, useSyncExternalStore } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import SettingsPage from './components/SettingsPage';
import { FIXTURES_MODE, useReader } from './lib/data';
import { GLYPH_ADDRESS } from './lib/config';
import { useWallet, switchToConfiguredChain } from './lib/wallet';
import { etherscanAddrUrl, shortAddr, chainName, fmtBlock } from './lib/format';
import { lowest, highest } from './lib/segments';
import { IS_OFFLINE_BUILD, OFFLINE_FILE } from './lib/offline';
import { hrefFor, useUrlState } from './lib/router';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
  const { chainId: walletChainId } = useWallet();
  const [params, navigate] = useUrlState();

  // The URL names a surface — /scan, /tx/…, /author/…, /settings — and a
  // link to one of them IS the instruction to show it, whichever tab was
  // picked last. Without this, following 扫描范围 in the footer while the
  // 写 tab is open moves the URL to /scan and keeps rendering the editor.
  // Picking 写 is the opposite instruction, so it clears the URL surface.
  const urlSurface = Boolean(params.settings || params.scan || params.tx || params.author);
  const writing = tab === 'write' && !urlSurface;

  const handleTabChange = useCallback(
    (key) => {
      if (key === 'write' && urlSurface) navigate({}, { replace: true });
      setTab(key);
    },
    [urlSurface, navigate],
  );
  const reader = useReader();
  const chainId = reader.chainId;
  const chainMismatch = walletChainId != null && walletChainId !== chainId;
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);

  // Covered home-feed block ranges of the chain being shown, summarized in
  // the footer — live, window by window, while a scan runs. (Subscribed
  // directly: the footer must never start a scan of its own.)
  const feed = useSyncExternalStore(
    reader.feed.subscribe,
    reader.feed.getSnapshot,
    reader.feed.getSnapshot,
  );

  // Coverage is a set of ranges; the footer shows the outer span plus how
  // many separate ranges make it up.
  const segments = feed.coverage;
  const scanSpan = segments.length
    ? ` ${fmtBlock(lowest(segments))} 至 ${fmtBlock(highest(segments))}` +
      (segments.length > 1 ? ` · ${segments.length} 段` : '')
    : '';

  const handleSwitchChain = async () => {
    setSwitchError(null);
    setSwitching(true);
    try {
      await switchToConfiguredChain(chainId);
    } catch (err) {
      setSwitchError(err?.code === 4001 ? '已取消' : '切换失败，请在钱包中手动切换');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        tab={writing ? 'write' : 'read'}
        onTabChange={handleTabChange}
        onOpenSettings={() => navigate({ settings: '1' })}
      />
      {chainMismatch && (
        <div
          role="alert"
          className="border-b border-danger-wash bg-danger-wash/60 px-4 py-2 text-center text-sm text-danger sm:px-6"
        >
          钱包连接的链（ID {walletChainId}）与正在阅读的链（ID {chainId}）不一致。
          <button
            type="button"
            onClick={handleSwitchChain}
            disabled={switching}
            className="ml-2 font-medium underline underline-offset-2 hover:text-accent disabled:opacity-50"
          >
            {switching ? '切换中…' : '切换钱包网络'}{switchError ? `（${switchError}）` : ''}
          </button>
        </div>
      )}
      <main className="flex-1 w-full mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-16">
        {params.settings ? (
          <SettingsPage navigate={navigate} />
        ) : writing ? (
          <Publisher />
        ) : (
          <Reader onStartWriting={() => handleTabChange('write')} />
        )}
      </main>
      <footer className="border-t border-edge px-4 py-10 text-center sm:px-6">
        <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-faint tabular-nums">
          <span>{chainName(chainId)}</span>
          <span className="select-none" aria-hidden="true">·</span>
          <a
            href={etherscanAddrUrl(GLYPH_ADDRESS, chainId)}
            target="_blank"
            rel="noreferrer"
            title="在区块浏览器查看合约"
            className="inline-block font-mono text-2xs tabular-nums text-ink-faint hover:text-accent transition-colors"
          >
            合约：{shortAddr(GLYPH_ADDRESS)}
          </a>
          <span className="select-none" aria-hidden="true">·</span>
          <a
            href={hrefFor({ scan: '1' })}
            onClick={(e) => {
              e.preventDefault();
              navigate({ scan: '1' });
            }}
            title="查看扫描范围"
            className="inline-block text-2xs tabular-nums text-ink-faint hover:text-accent transition-colors"
          >
            扫描范围
            {scanSpan}
            {feed.job && <span className="animate-pulse"> · 扫描中</span>}
          </a>
          {/* The whole app as one file, for when this domain is gone. */}
          {!IS_OFFLINE_BUILD && (
            <>
              <span className="select-none" aria-hidden="true">·</span>
              <a
                href={`/${OFFLINE_FILE}`}
                download={OFFLINE_FILE}
                title="把整个应用存成一个 HTML 文件，存到本地后双击即可阅读"
                className="inline-block text-2xs text-ink-faint hover:text-accent transition-colors"
              >
                离线版
              </a>
            </>
          )}
        </p>
      </footer>
      {FIXTURES_MODE && (
        <div className="fixed bottom-3 right-3 z-50 rounded-full bg-paper-sunken px-2.5 py-1 text-2xs text-ink-ghost">
          演示数据
        </div>
      )}
    </div>
  );
}
