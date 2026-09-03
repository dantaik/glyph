import { useCallback, useEffect, useRef, useState } from 'react';
import { hrefFor, useUrlState } from '../lib/router';
import { LANG_NAMES, setLang, useLang, useT } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { GlyphMark, Globe, Sun, Moon, Sliders, MoreHorizontal } from './Icons';

// No display utility here on purpose: call sites choose between `inline-flex`
// and `hidden sm:inline-flex`, and both set `display`. Baking `inline-flex`
// into the shared string would let it win by stylesheet order and the
// "hidden" buttons would never actually hide.
const ICON_BTN =
  'h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-accent hover:bg-paper-sunken transition-colors';

const TABS = [
  ['read', 'nav.read'],
  ['write', 'nav.write'],
];

/** Two languages, so the switch is a toggle: the other one. */
const OTHER_LANG = { en: 'zh', zh: 'en' };

/**
 * How each language names itself in one glyph's worth of space — the
 * header button shows the language it would switch TO, in that language's
 * own script, the way a language switch is read everywhere.
 */
const LANG_SHORT = { en: 'EN', zh: '中' };

/**
 * Sticky masthead: brand, tabs, language, theme, settings. Nothing about
 * chains or wallets: the reader reads every chain at once (a post's chain
 * label is the way into one chain's view), and the wallet belongs to the
 * write tab, the only place it is needed.
 *
 * A phone has ~288px of usable width, so below `sm` the three rarest
 * controls — language, theme and settings — fold into the ⋯ menu, and the
 * wordmark waits for 380px. Everything else stays on one 56px row.
 *
 * Every child of the row is `shrink-0` and the trailing group is pushed out
 * with `ml-auto`, so the leading group can never shrink below its own
 * content and paint the tabs under the trailing controls.
 */
export default function Header({ tab, onTabChange, onOpenSettings }) {
  const [, navigate] = useUrlState();
  const { isDark, setTheme } = useTheme();
  const t = useT();
  const lang = useLang();
  const other = OTHER_LANG[lang];

  // The brand is the front door: the merged feed, every chain, no filter.
  const goHome = useCallback(() => {
    navigate({ chain: null }, { replace: true });
    onTabChange('read');
  }, [navigate, onTabChange]);

  // "Read" = the feed as it was being read: any author/post params are
  // cleared, the chain filter (if one is on) stays. The router keeps the
  // fixtures demo flag automatically.
  const handleTabChange = useCallback(
    (key) => {
      if (key === 'read') navigate({}, { replace: true });
      onTabChange(key);
    },
    [navigate, onTabChange],
  );

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        {/* Brand — the way back to the front page from anywhere. */}
        <a
          href={hrefFor({ chain: null })}
          onClick={(e) => {
            e.preventDefault();
            goHome();
          }}
          aria-label={t('nav.home')}
          className="flex shrink-0 select-none items-center gap-1.5 rounded-lg py-1 pr-1 text-accent hover:text-accent-strong transition-colors"
        >
          {/* Mark and wordmark are one thing, in one colour. */}
          <GlyphMark size={26} />
          <span className="hidden text-lg font-bold tracking-wide min-[380px]:inline">
            {t('brand.wordmark')}
          </span>
        </a>

        <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
          {TABS.map(([key, labelKey]) => {
            const label = t(labelKey);
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                aria-current={tab === key ? 'page' : undefined}
                className={`relative flex h-14 min-w-[2.25rem] items-center justify-center px-1.5 text-sm transition-colors sm:min-w-[3rem] sm:px-2 ${
                  tab === key ? 'text-ink' : 'text-ink-faint hover:text-accent'
                }`}
              >
                {/* Bold when active, but the box is always the bold width —
                    both copies share one grid cell, so the cell measures the
                    wider (bold) one and a font-weight swap moves nothing. */}
                <span className="grid">
                  <span
                    className={`col-start-1 row-start-1 ${tab === key ? 'font-medium' : ''}`}
                  >
                    {label}
                  </span>
                  <span
                    className="invisible col-start-1 row-start-1 font-medium"
                    aria-hidden="true"
                  >
                    {label}
                  </span>
                </span>
                {tab === key && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Everything after this is pushed to the trailing edge. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          {/* sm+: language, theme and settings as their own buttons. */}
          <button
            onClick={() => setLang(other)}
            aria-label={t('nav.switchLanguage', { name: LANG_NAMES[other] })}
            title={t('nav.switchLanguage', { name: LANG_NAMES[other] })}
            className={`hidden text-xs font-medium sm:inline-flex ${ICON_BTN}`}
          >
            {LANG_SHORT[other]}
          </button>
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={t('nav.toggleTheme')}
            className={`hidden sm:inline-flex ${ICON_BTN}`}
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
          <button
            onClick={onOpenSettings}
            aria-label={t('nav.settings')}
            className={`hidden sm:inline-flex ${ICON_BTN}`}
          >
            <Sliders />
          </button>

          {/* Below sm: the same three, folded into ⋯. */}
          <OverflowMenu
            className="sm:hidden"
            isDark={isDark}
            otherLang={other}
            onSwitchLanguage={() => setLang(other)}
            onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * The ⋯ menu — language, theme and settings on screens with no room for
 * them as separate buttons. Dismissed by an outside click or Escape.
 */
function OverflowMenu({
  className = '',
  isDark,
  otherLang,
  onSwitchLanguage,
  onToggleTheme,
  onOpenSettings,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const t = useT();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn) => () => {
    setOpen(false);
    fn();
  };

  const ITEM =
    'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-paper-sunken hover:text-accent transition-colors';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('nav.more')}
        className={`inline-flex ${ICON_BTN}`}
      >
        <MoreHorizontal />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-edge bg-paper-raised py-1 shadow-pop"
        >
          <button type="button" role="menuitem" onClick={pick(onSwitchLanguage)} className={ITEM}>
            <Globe size={16} />
            {LANG_NAMES[otherLang]}
          </button>
          <button type="button" role="menuitem" onClick={pick(onToggleTheme)} className={ITEM}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
            {isDark ? t('nav.lightMode') : t('nav.darkMode')}
          </button>
          <button type="button" role="menuitem" onClick={pick(onOpenSettings)} className={ITEM}>
            <Sliders size={16} />
            {t('nav.settings')}
          </button>
        </div>
      )}
    </div>
  );
}
