// i18n.js — the interface language: the store, and the lookup over it.
//
// Xueni is read in English by default and can be switched to Chinese; both
// dictionaries live in ./locales and carry the same keys. A key is looked
// up in the chosen language and falls back to English, so a missing
// translation degrades to readable text instead of a blank.
//
// The choice is a preference like the theme: persisted to localStorage,
// applied to <html lang> so the browser and screen readers agree with the
// page, and announced on a `glyph:lang` window event so every hook — and a
// settings file restored on the settings page — takes effect at once,
// without a reload.
//
// `t()` is a plain function, not a hook: the lib modules (format.js,
// publish.js, wallet.js) build sentences too, and they have no React. The
// components subscribe through `useT()`, and App subscribes at the root,
// so the whole tree re-renders when the language changes.

import { useSyncExternalStore } from 'react';
import en from './locales/en';
import zh from './locales/zh';

const KEY_LANG = 'glyph.lang.v1';

/** Window event: the interface language changed. */
export const LANG_EVT = 'glyph:lang';

/** The languages the interface is written in, in the order the switch shows them. */
export const LANGS = ['en', 'zh'];

/** English unless the reader says otherwise — including on a first visit. */
export const DEFAULT_LANG = 'en';

/** What each language calls itself, for the switch. */
export const LANG_NAMES = { en: 'English', zh: '中文' };

/** The BCP 47 tag each language formats dates and numbers with. */
export const LANG_LOCALES = { en: 'en-US', zh: 'zh-CN' };

const DICTS = { en, zh };

export const isLang = (v) => LANGS.includes(v);

function lsGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // quota / privacy mode — the choice just doesn't persist
  }
}

function emit() {
  try {
    window.dispatchEvent(new CustomEvent(LANG_EVT));
  } catch {
    /* non-browser context */
  }
}

function applyToDocument(lang) {
  try {
    document.documentElement.lang = LANG_LOCALES[lang] ?? lang;
  } catch {
    /* non-browser context */
  }
}

// The language in force, seeded from storage. Held in memory as well as
// persisted so that the choice still works where localStorage does not —
// a private window, a browser with site data blocked, a test in Node.
let current = (() => {
  const stored = lsGet(KEY_LANG);
  return isLang(stored) ? stored : DEFAULT_LANG;
})();

/** The chosen language — English until one is chosen. */
export function getLang() {
  return current;
}

/** Choose the interface language. Applies at once, without a reload. */
export function setLang(lang) {
  current = isLang(lang) ? lang : DEFAULT_LANG;
  lsSet(KEY_LANG, current);
  applyToDocument(current);
  emit();
}

/** The locale tag to format dates and numbers with. */
export const getLocale = (lang = getLang()) => LANG_LOCALES[lang] ?? LANG_LOCALES[DEFAULT_LANG];

/**
 * A phrase, in `lang`. Dictionary entries are strings, or functions of the
 * interpolated parts — `t('feed.readFailed', { chain, reason })`. A key
 * missing from the chosen language falls back to English; one missing
 * from both is returned as itself, so a typo shows up on the page rather
 * than disappearing.
 */
export function translate(lang, key, params) {
  const entry = DICTS[lang]?.[key] ?? DICTS[DEFAULT_LANG][key];
  if (entry == null) return key;
  return typeof entry === 'function' ? entry(params ?? {}) : entry;
}

/** `translate` in the language currently chosen. */
export const t = (key, params) => translate(getLang(), key, params);

const subscribe = (callback) => {
  window.addEventListener(LANG_EVT, callback);
  return () => window.removeEventListener(LANG_EVT, callback);
};

/** React hook → the chosen language; re-renders when it changes. */
export function useLang() {
  return useSyncExternalStore(subscribe, getLang, () => DEFAULT_LANG);
}

/**
 * React hook → `t` bound to the chosen language. Subscribing is the point:
 * a component that translates re-renders when the language changes.
 */
export function useT() {
  const lang = useLang();
  return (key, params) => translate(lang, key, params);
}

// The stored choice has to reach <html lang> even before React mounts —
// index.html's inline script does it for the very first paint, and this
// covers a module-only context (tests, the DEV fixtures page).
applyToDocument(getLang());
