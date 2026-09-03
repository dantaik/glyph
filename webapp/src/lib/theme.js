// theme.js — theme + article font-size preferences: the setters, and the
// hooks over them.
//
// Source of truth is the DOM (<html> `.dark` class / `data-fontsize`
// attribute), seeded before first paint by the inline FOUC script in
// index.html. Setters persist to localStorage, mutate the DOM, then
// announce the change on a `glyph:prefs` window event so every hook
// instance (header toggle, editor, font-size control…) stays in sync —
// and so a settings file restored on the settings page applies at once.

import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'glyph.theme.v1';
const FONTSIZE_KEY = 'glyph.fontsize.v1';
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

function readFontSize() {
  const f = document.documentElement.dataset.fontsize;
  return f === 's' || f === 'l' ? f : 'm';
}

function applyFontSize(size) {
  if (size === 's' || size === 'l') document.documentElement.dataset.fontsize = size;
  else delete document.documentElement.dataset.fontsize;
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

/** The article font size chosen: 's' | 'm' | 'l' ('m' when none was). */
export function getFontSizePref() {
  const f = lsGet(FONTSIZE_KEY);
  return f === 's' || f === 'l' ? f : 'm';
}

/** Choose the article font size. Applies at once. */
export function setFontSizePref(size) {
  const chosen = size === 's' || size === 'l' ? size : 'm';
  lsSet(FONTSIZE_KEY, chosen);
  applyFontSize(chosen);
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

/**
 * Article font-size hook → `{ size: 's'|'m'|'l', setSize }`.
 * 'm' is the default and clears the html[data-fontsize] attribute.
 */
export function useFontSize() {
  const [size, setSizeState] = useState(readFontSize);

  const setSize = useCallback((s) => setFontSizePref(s), []);

  useEffect(() => {
    const sync = () => setSizeState(readFontSize());
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, []);

  return { size, setSize };
}
