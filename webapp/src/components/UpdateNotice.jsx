import { useCallback, useEffect, useState } from 'react';
import { desktopVersion, isDesktop, openExternal } from '../lib/platform';
import { useT } from '../lib/i18n';
import { Micro } from './Text';

/**
 * The one place the desktop app asks the network something that is not a
 * node: whether a newer release exists. A downloaded application has no
 * host to update it, so it either says nothing and quietly rots, or it
 * checks — and the smallest honest check is the GitHub release the DMG was
 * downloaded from.
 *
 * Best effort throughout: no network, a rate limit, a renamed repository,
 * all show nothing at all. An app that works is a bad place to learn that
 * github.com is down.
 *
 * On the web this renders nothing and asks nothing.
 */
const LATEST_RELEASE_API = 'https://api.github.com/repos/dantaik/glyph/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/dantaik/glyph/releases/latest';
const SEEN_KEY = 'glyph.desktop.updateSeen.v1';
const A_DAY = 24 * 60 * 60 * 1000;

/** The version whose notice was dismissed, or null. */
function lastDismissed() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function rememberDismissed(version) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* privacy mode — the notice comes back tomorrow, which is survivable */
  }
}

/**
 * Whether `latest` is a later version than `running`. Both are dotted
 * numbers, optionally with a leading `v`; anything that is not a number
 * counts as zero, so a tag nobody expected can only ever mean "not newer".
 */
export function isNewerVersion(latest, running) {
  const parts = (v) =>
    String(v ?? '')
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(running);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export default function UpdateNotice() {
  const t = useT();
  const [version, setVersion] = useState(null);

  useEffect(() => {
    if (!isDesktop()) return undefined;
    let alive = true;

    const check = async () => {
      try {
        const running = await desktopVersion();
        const response = await fetch(LATEST_RELEASE_API, {
          headers: { accept: 'application/vnd.github+json' },
        });
        if (!response.ok) return;
        const latest = String((await response.json())?.tag_name ?? '').replace(/^v/, '');
        if (!alive || !latest) return;
        if (isNewerVersion(latest, running) && lastDismissed() !== latest) setVersion(latest);
      } catch {
        /* offline, rate-limited, or GitHub having a bad day: say nothing */
      }
    };

    // On launch, and once a day for an app that is left open for weeks.
    // The interval is the whole of "once a day": remembering the last check
    // across launches would buy one saved request and a second stored key.
    check();
    const timer = setInterval(check, A_DAY);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVersion((v) => {
      if (v) rememberDismissed(v);
      return null;
    });
  }, []);

  if (!version) return null;

  return (
    <Micro as="p" className="mt-4" data-update-notice="">
      {t('desktop.updateAvailable', { version })}
      <span className="select-none" aria-hidden="true"> · </span>
      <button
        type="button"
        onClick={() => openExternal(LATEST_RELEASE_PAGE)}
        className="underline underline-offset-4 transition-colors hover:text-accent"
      >
        {t('desktop.download')}
      </button>
      <span className="select-none" aria-hidden="true"> · </span>
      <button type="button" onClick={dismiss} className="transition-colors hover:text-accent">
        {t('desktop.dismiss')}
      </button>
    </Micro>
  );
}
