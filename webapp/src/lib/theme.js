// theme.js — the theme preference: the setter, and the hook over it.
//
// Source of truth is the DOM (the `.dark` class on <html>), seeded before
// first paint by the inline FOUC script in index.html. The setter persists
// to localStorage, mutates the DOM, then announces the change on a
// `glyph:prefs` window event so every hook instance stays in sync — and so
// a settings file restored on the settings page applies at once.

import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'glyph.theme.v1';
const PREFS_EVENT = 'glyph:prefs';
const META_COLORS = { light: '#f7f8fa', dark: '#16181c' };

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // quota / disabled — in-memory state still works for this session
  }
}

const osPrefersDark = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;

function readTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? META_COLORS.dark : META_COLORS.light);
}

function broadcast() {
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

// --- The preferences themselves ------------------------------------------

/** The theme chosen: 'light' | 'dark', or null while following the OS. */
export function getThemePref() {
  const t = lsGet(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : null;
}

/** Choose a theme — or null to follow the OS again. Applies at once. */
export function setThemePref(theme) {
  const chosen = theme === 'light' || theme === 'dark' ? theme : null;
  lsSet(THEME_KEY, chosen);
  applyTheme(chosen ?? (osPrefersDark() ? 'dark' : 'light'));
  broadcast();
}

// --- Hooks ----------------------------------------------------------------

/**
 * Theme hook → `{ theme: 'light'|'dark', isDark, setTheme }`.
 * Follows the OS color-scheme only until the user picks one explicitly.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  const setTheme = useCallback((t) => setThemePref(t), []);

  useEffect(() => {
    const sync = () => setThemeState(readTheme());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMedia = (e) => {
      if (lsGet(THEME_KEY)) return;
      applyTheme(e.matches ? 'dark' : 'light');
      broadcast();
    };
    window.addEventListener(PREFS_EVENT, sync);
    media.addEventListener('change', onMedia);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      media.removeEventListener('change', onMedia);
    };
  }, []);

  return { theme, isDark: theme === 'dark', setTheme };
}
