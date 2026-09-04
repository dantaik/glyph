// settingsFile.js — the reader's preferences as one file, out and back in.
//
// Everything the settings page can change — the endpoint lists per chain,
// the rescan delay, the publish chain, the interface language, the theme
// and the console log switch — collected into one small JSON document, and
// read back with every value checked before any of it is applied.
// Applying goes through the same setters the page uses, so a restored
// file takes effect at once, with no reload, and nothing here knows how
// a setting is stored.
//
// The file names its format (`glyph.settings`): a document in some later,
// different format is refused rather than half-applied.

import { defaultRpcs, isKnownChain } from './chains';
import { chainName } from './format';
import {
  READ_CHAIN_IDS,
  getPublishChainId,
  getRescanDelayMs,
  getRpcUrls,
  savePublishChainId,
  saveRescanDelay,
  saveRpcUrls,
} from './config';
import { getThemePref, setThemePref } from './theme';
import { LANG_NAMES, getLang, isLang, setLang, t } from './i18n';
import * as rpcLog from './rpcLog';

export const SETTINGS_FORMAT = 1;

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
const sameList = (a, b) => a.length === b.length && a.every((u, i) => u === b[i]);

/** Every preference, as it stands. */
export function collectSettings() {
  const rpcs = {};
  for (const id of READ_CHAIN_IDS) rpcs[id] = getRpcUrls(id);
  return {
    glyph: { settings: SETTINGS_FORMAT },
    exportedAt: new Date().toISOString(),
    rpcs,
    rescanDelayMinutes: getRescanDelayMs() / 60_000,
    publishChain: getPublishChainId(),
    lang: getLang(),
    theme: getThemePref(),
    log: rpcLog.isEnabled(),
  };
}

/** The document as text, the way the file holds it. */
export const serializeSettings = () => JSON.stringify(collectSettings(), null, 2);

/** The file's name — dated, so two exports don't overwrite each other. */
export const settingsFileName = (date = new Date()) => `glyph-settings-${date.toISOString().slice(0, 10)}.json`;

/**
 * Read a settings file. Returns what can be applied (`settings`: only the
 * keys that were present and valid), what was wrong with the rest
 * (`problems`, one line each), and what applying would do (`summary`, one
 * line each). Unknown keys are ignored.
 */
export function parseSettingsFile(text) {
  const settings = {};
  const problems = [];
  const summary = [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { settings, problems: [t('settingsFile.notJson')], summary };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { settings, problems: [t('settingsFile.notObject')], summary };
  }
  const format = doc.glyph?.settings;
  if (format !== SETTINGS_FORMAT) {
    problems.push(
      format == null
        ? t('settingsFile.notGlyph')
        : t('settingsFile.badFormat', { format, supported: SETTINGS_FORMAT }),
    );
    return { settings, problems, summary };
  }

  if (doc.rpcs != null) {
    if (typeof doc.rpcs !== 'object' || Array.isArray(doc.rpcs)) {
      problems.push(t('settingsFile.rpcsShape'));
    } else {
      const rpcs = {};
      for (const [key, list] of Object.entries(doc.rpcs)) {
        const id = Number(key);
        if (!isKnownChain(id)) {
          problems.push(t('settingsFile.unknownChain', { id: key }));
          continue;
        }
        if (!Array.isArray(list)) {
          problems.push(t('settingsFile.chainListShape', { chain: chainName(id) }));
          continue;
        }
        const good = list.filter(isHttpUrl).map((u) => u.trim());
        if (good.length < list.length) {
          problems.push(
            t('settingsFile.droppedEndpoints', { chain: chainName(id), count: list.length - good.length }),
          );
        }
        rpcs[id] = good;
        const custom = good.length > 0 && !sameList(good, defaultRpcs(id));
        summary.push(
          custom
            ? t('settingsFile.customEndpoints', { chain: chainName(id), count: good.length })
            : t('settingsFile.defaultEndpoints', { chain: chainName(id) }),
        );
      }
      if (Object.keys(rpcs).length) settings.rpcs = rpcs;
    }
  }
  if (doc.rescanDelayMinutes != null) {
    const n = Number(doc.rescanDelayMinutes);
    if (Number.isFinite(n) && n >= 0) {
      settings.rescanDelayMinutes = n;
      summary.push(t('settingsFile.rescanDelay', { minutes: n }));
    } else {
      problems.push(t('settingsFile.rescanShape'));
    }
  }
  if ('publishChain' in doc) {
    const v = doc.publishChain;
    if (v === null) {
      settings.publishChain = null;
      summary.push(t('settingsFile.publishFollowsWallet'));
    } else if (isKnownChain(v)) {
      settings.publishChain = Number(v);
      summary.push(t('settingsFile.publishChain', { chain: chainName(v) }));
    } else {
      problems.push(t('settingsFile.publishShape', { value: v }));
    }
  }
  if (doc.lang != null) {
    if (isLang(doc.lang)) {
      settings.lang = doc.lang;
      summary.push(t('settingsFile.lang', { lang: LANG_NAMES[doc.lang] }));
    } else {
      problems.push(t('settingsFile.langShape'));
    }
  }
  if ('theme' in doc) {
    const v = doc.theme;
    if (v === null || v === 'light' || v === 'dark') {
      settings.theme = v;
      const name =
        v === 'dark'
          ? t('settingsFile.themeDark')
          : v === 'light'
            ? t('settingsFile.themeLight')
            : t('settingsFile.themeSystem');
      summary.push(t('settingsFile.theme', { theme: name }));
    } else {
      problems.push(t('settingsFile.themeShape'));
    }
  }
  if (doc.log != null) {
    if (typeof doc.log === 'boolean') {
      settings.log = doc.log;
      summary.push(t('settingsFile.log', { state: doc.log ? t('settingsFile.on') : t('settingsFile.off') }));
    } else {
      problems.push(t('settingsFile.logShape'));
    }
  }
  if (summary.length === 0 && problems.length === 0) problems.push(t('settingsFile.nothing'));
  return { settings, problems, summary };
}

/** Apply what parseSettingsFile() accepted, through the page's own setters. */
export function applySettings(settings) {
  if (settings.rpcs) {
    for (const [key, list] of Object.entries(settings.rpcs)) {
      const id = Number(key);
      // A list that is the chain's default is "not customized", not a copy
      // of the defaults that would stop following them.
      saveRpcUrls(id, sameList(list, defaultRpcs(id)) ? [] : list);
    }
  }
  if (settings.rescanDelayMinutes != null) saveRescanDelay(settings.rescanDelayMinutes);
  if ('publishChain' in settings) savePublishChainId(settings.publishChain);
  if (settings.lang != null) setLang(settings.lang);
  if ('theme' in settings) setThemePref(settings.theme);
  if (settings.log != null) rpcLog.setEnabled(settings.log);
}
