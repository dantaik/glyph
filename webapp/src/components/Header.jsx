import { useCallback } from 'react';
import { useUrlState } from '../lib/router';
import { useTheme } from '../lib/theme';
import { useWallet } from '../lib/wallet';
import { shortAddr } from '../lib/format';
import { GlyphMark, Sun, Moon, Sliders } from './Icons';

const ICON_BTN =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-faint hover:text-ink hover:bg-paper-sunken transition-colors';

const TABS = [
  ['read', '阅读'],
  ['write', '写作'],
];

/** Sticky masthead: brand, tabs, wallet pill, theme toggle, settings */
export default function Header({ tab, onTabChange, onOpenSettings }) {
  const { account, connect } = useWallet();
  const [, navigate] = useUrlState();
  const { isDark, setTheme } = useTheme();

  const handleConnect = useCallback(async () => {
    try {
      await connect();
    } catch (err) {
      if (err?.code !== 4001) console.warn('wallet connect failed:', err);
    }
  }, [connect]);

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <span className="flex shrink-0 select-none items-center gap-1.5">
            <GlyphMark size={20} className="text-accent" />
            <span className="font-serif text-lg font-bold tracking-wide">
              岩刻
            </span>
          </span>
          <nav className="flex items-center gap-2 sm:gap-4">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                aria-current={tab === key ? 'page' : undefined}
                className={`relative whitespace-nowrap px-1 py-4 text-sm transition-colors ${
                  tab === key
                    ? 'text-ink font-medium'
                    : 'text-ink-faint hover:text-ink'
                }`}
              >
                {label}
                {tab === key && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {account ? (
            <button
              onClick={() => {
                navigate({ author: account });
                onTabChange('read');
              }}
              aria-label="查看我的文章"
              className="inline-flex items-center gap-1.5 rounded-full bg-paper-sunken px-3 py-1 font-mono text-xs text-ink-soft hover:text-ink transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="hidden min-[400px]:inline">
                {shortAddr(account)}
              </span>
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="whitespace-nowrap rounded-full bg-accent-wash px-3 py-1 text-xs font-medium text-accent-strong hover:bg-accent hover:text-paper transition-colors"
            >
              连接钱包
            </button>
          )}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label="切换深色模式"
            className={ICON_BTN}
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
          <button
            onClick={onOpenSettings}
            aria-label="节点设置"
            className={ICON_BTN}
          >
            <Sliders />
          </button>
        </div>
      </div>
    </header>
  );
}
