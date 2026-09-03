import { Fragment, useCallback, useState, useSyncExternalStore } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import SettingsPage from './components/SettingsPage';
import ChainIcon from './components/ChainIcon';
import { ExternalLink } from './components/Icons';
import { FIXTURES_MODE } from './lib/data';
import { GLYPH_ADDRESS } from './lib/config';
import { etherscanAddrUrl, shortAddr, chainName, fmtBlock } from './lib/format';
import { lowest, highest } from './lib/segments';
import { IS_OFFLINE_BUILD, OFFLINE_FILE } from './lib/offline';
import { hrefFor, useUrlState } from './lib/router';
import { getAllChainsView } from './lib/view';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        // 设置 is neither reading nor writing, so neither tab is current
        // while it is open. /tx, /author and /scan still are 读.
        tab={params.settings ? null : writing ? 'write' : 'read'}
        onTabChange={handleTabChange}
        onOpenSettings={() => navigate({ settings: '1' })}
      />
      <main className="flex-1 w-full mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-16">
        {params.settings ? (
          <SettingsPage navigate={navigate} />
        ) : writing ? (
          <Publisher />
        ) : (
          <Reader onStartWriting={() => handleTabChange('write')} />
        )}
      </main>
      <Footer navigate={navigate} />
      {FIXTURES_MODE && (
        <div className="fixed bottom-3 right-3 z-50 rounded-full bg-paper-sunken px-2.5 py-1 text-2xs text-ink-ghost">
          演示数据
        </div>
      )}
    </div>
  );
}

const FOOT_LINK = 'inline-flex items-center gap-1 hover:text-accent transition-colors';

/**
 * The footer: the contract, then one line per chain the app reads — the
 * same lines whatever the page shows, because the chains are one journal
 * and the reader is told about all of them or none. Each line is the way
 * into that chain's view and to the scan page, and says how far the local
 * scan has got, live, window by window, while a scan runs.
 *
 * Subscribed to the all-chains feed directly: the footer must never start
 * a scan of its own.
 */
function Footer({ navigate }) {
  const all = getAllChainsView();
  const feed = useSyncExternalStore(all.feed.subscribe, all.feed.getSnapshot, all.feed.getSnapshot);
  const go = (next) => (e) => {
    e.preventDefault();
    navigate(next);
  };

  return (
    <footer className="border-t border-edge px-4 py-10 text-center sm:px-6">
      <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-faint tabular-nums">
        <span className="font-mono text-2xs">合约：{shortAddr(GLYPH_ADDRESS)}</span>
        {feed.chains.map((c) => (
          <Fragment key={c.chainId}>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={etherscanAddrUrl(GLYPH_ADDRESS, c.chainId)}
              target="_blank"
              rel="noreferrer"
              title={`在${chainName(c.chainId)}的区块浏览器查看合约`}
              className={`${FOOT_LINK} text-2xs`}
            >
              {chainName(c.chainId)}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </Fragment>
        ))}
        {/* The whole app as one file, for when this domain is gone. */}
        {!IS_OFFLINE_BUILD && (
          <>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={`/${OFFLINE_FILE}`}
              download={OFFLINE_FILE}
              title="把整个应用存成一个 HTML 文件，存到本地后双击即可阅读"
              className={`${FOOT_LINK} text-2xs`}
            >
              离线版
            </a>
          </>
        )}
      </p>
      <ul className="mt-2 space-y-1 text-2xs text-ink-faint tabular-nums">
        {feed.chains.map((c) => (
          <ChainLine key={c.chainId} chainId={c.chainId} span={scanSpan(c.coverage)} scanning={c.job != null} go={go} />
        ))}
      </ul>
    </footer>
  );
}

/**
 * Coverage is a set of ranges; the footer shows the outer span plus how
 * many separate ranges make it up. (Rendered to a string here rather than
 * passed down: React's DEV render log serialises arrays of primitives in
 * changed props with JSON.stringify, which throws on BigInt — a block
 * range would freeze the page in development.)
 */
const scanSpan = (segments) =>
  segments.length
    ? ` ${fmtBlock(lowest(segments))} 至 ${fmtBlock(highest(segments))}` +
      (segments.length > 1 ? ` · ${segments.length} 段` : '')
    : '';

/** One chain's line: its name (→ its view) and its scan range (→ /scan). */
function ChainLine({ chainId, span, scanning, go }) {
  const name = chainName(chainId);
  return (
    <li className="flex flex-wrap items-center justify-center gap-2" data-chain-line={chainId}>
      <a href={hrefFor({ chain: chainId })} onClick={go({ chain: chainId })} title={`只看${name}`} className={FOOT_LINK}>
        <ChainIcon chainId={chainId} size={12} className="shrink-0" />
        {name}
      </a>
      <span className="select-none" aria-hidden="true">·</span>
      <a href={hrefFor({ scan: '1' })} onClick={go({ scan: '1' })} title="查看扫描范围" className={FOOT_LINK}>
        扫描范围
        {span}
        {scanning && <span className="animate-pulse"> · 扫描中</span>}
      </a>
    </li>
  );
}
