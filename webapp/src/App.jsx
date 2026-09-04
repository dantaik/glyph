import { useCallback, useState, useSyncExternalStore } from 'react';
import Header from './components/Header';
import Reader from './components/Reader';
import Publisher from './components/Publisher';
import SettingsPage from './components/SettingsPage';
import ChainIcon from './components/ChainIcon';
import UpdateNotice from './components/UpdateNotice';
import { FIXTURES_MODE } from './lib/data';
import { chainName, fmtBlock } from './lib/format';
import { t, useLang } from './lib/i18n';
import { lowest, highest } from './lib/segments';
import { isDesktop, openExternal } from './lib/platform';
import { hrefFor, isHeadless, useUrlState } from './lib/router';
import { getAllChainsView } from './lib/view';
import { Micro } from './components/Text';

export default function App() {
  const [tab, setTab] = useState('read'); // 'read' | 'write'
  const [params, navigate] = useUrlState();
  // The root subscribes to the interface language so that switching it
  // re-renders the whole tree — nothing below is memoised, and the phrases
  // are read at render time (i18n.js), so this is the only subscription
  // the change needs.
  useLang();

  // The URL names a surface — /scan, /tx/…, /author/…, /settings — and a
  // link to one of them IS the instruction to show it, whichever tab was
  // picked last. Without this, following the scanned-ranges link in the
  // footer while the write tab is open moves the URL to /scan and keeps
  // rendering the editor. Picking "write" is the opposite instruction, so
  // it clears the URL surface.
  const urlSurface = Boolean(params.settings || params.scan || params.tx || params.author);
  const writing = tab === 'write' && !urlSurface;

  // `?headless=1` on a post route: the letter alone, for embedding — no
  // masthead, no footer (PostPage drops its own navigation to match).
  const headless = isHeadless(params);

  const handleTabChange = useCallback(
    (key) => {
      if (key === 'write' && urlSurface) navigate({}, { replace: true });
      setTab(key);
    },
    [urlSurface, navigate],
  );

  // In the desktop app a link to another site — an explorer, an ENS
  // profile — must leave the app: following it inside the window would put
  // the reader in a browser with no address bar, no tabs and no way back.
  // One handler on the shell catches them all, because a link is a link
  // wherever it is written; the app's own links are same-origin and fall
  // through to the router untouched. On the web this does nothing.
  const handleClick = useCallback((e) => {
    if (!isDesktop() || e.defaultPrevented || e.button !== 0) return;
    const anchor = e.target?.closest?.('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin === window.location.origin) return;
    e.preventDefault();
    openExternal(url.href);
  }, []);

  return (
    <div className="min-h-screen flex flex-col" onClick={handleClick}>
      {!headless && (
        <Header
          // Settings is neither reading nor writing, so neither tab is
          // current while it is open. /tx, /author and /scan still are.
          tab={params.settings ? null : writing ? 'write' : 'read'}
          onTabChange={handleTabChange}
          onOpenSettings={() => navigate({ settings: '1' })}
        />
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
      {!headless && <Footer navigate={navigate} />}
      {FIXTURES_MODE && (
        <Micro as="div" className="fixed bottom-3 right-3 z-50 rounded-full bg-paper-sunken px-2.5 py-1">
          {t('app.fixtures')}
        </Micro>
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
    <footer data-noprint="" className="border-t border-edge px-4 py-10 text-center sm:px-6">
      <Micro as="ul" nums className="space-y-1">
        {feed.chains.map((c) => (
          <ChainLine key={c.chainId} chainId={c.chainId} span={scanSpan(c.coverage)} scanning={c.job != null} go={go} />
        ))}
      </Micro>
      <UpdateNotice />
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
    ? ` ${fmtBlock(lowest(segments))} - ${fmtBlock(highest(segments))}` +
      (segments.length > 1 ? ` · ${t('footer.segments', { count: segments.length })}` : '')
    : '';

/** One chain's line: its name (→ its view) and its scan range (→ /scan). */
function ChainLine({ chainId, span, scanning, go }) {
  const name = chainName(chainId);
  return (
    <li className="flex flex-wrap items-center justify-center gap-2" data-chain-line={chainId}>
      <a
        href={hrefFor({ chain: chainId })}
        onClick={go({ chain: chainId })}
        title={t('footer.onlyChain', { chain: name })}
        className={FOOT_LINK}
      >
        <ChainIcon chainId={chainId} size={12} className="shrink-0" />
        {name}
      </a>
      <span className="select-none" aria-hidden="true">·</span>
      <a href={hrefFor({ scan: '1' })} onClick={go({ scan: '1' })} title={t('footer.scanRanges')} className={FOOT_LINK}>
        {t('footer.scanned')}
        {span}
        {scanning && <span className="animate-pulse"> · {t('footer.scanning')}</span>}
      </a>
    </li>
  );
}
