// theme.js — theme + article font-size preference hooks.
//
// Source of truth is the DOM (<html> `.dark` class / `data-fontsize`
// attribute), seeded before first paint by the inline FOUC script in
// index.html. Setters persist to localStorage, mutate the DOM, then
// announce the change on a `glyph:prefs` window event so every hook
// instance (header toggle, editor, font-size control…) stays in sync.

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
    localStorage.setItem(key, value);
  } catch {
    // quota / disabled — in-memory state still works for this session
  }
}

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

/**
 * Theme hook → `{ theme: 'light'|'dark', isDark, setTheme }`.
 * Follows the OS color-scheme only until the user picks one explicitly.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  const setTheme = useCallback((t) => {
    lsSet(THEME_KEY, t);
    applyTheme(t);
    broadcast();
  }, []);

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

  const setSize = useCallback((s) => {
    lsSet(FONTSIZE_KEY, s);
    applyFontSize(s);
    broadcast();
  }, []);

  useEffect(() => {
    const sync = () => setSizeState(readFontSize());
    window.addEventListener(PREFS_EVENT, sync);
    return () => window.removeEventListener(PREFS_EVENT, sync);
  }, []);

  return { size, setSize };
}
