// settingsFile.js — the reader's preferences as one file, out and back in.
//
// Everything the settings page can change — the endpoint lists per chain,
// the rescan delay, the publish chain, the theme, the article font size,
// the console log switch — collected into one small JSON document, and
// read back with every value checked before any of it is applied.
// Applying goes through the same setters the page uses, so a restored
// file takes effect at once, with no reload, and nothing here knows how
// a setting is stored.
//
// The file names its format (`glyph.settings`): a document in some later,
// different format is refused rather than half-applied.

import { chainName, defaultRpcs, isKnownChain } from './chains';
import {
  READ_CHAIN_IDS,
  getPublishChainId,
  getRescanDelayMs,
  getRpcUrls,
  savePublishChainId,
  saveRescanDelay,
  saveRpcUrls,
} from './config';
import { getFontSizePref, getThemePref, setFontSizePref, setThemePref } from './theme';
import * as rpcLog from './rpcLog';

export const SETTINGS_FORMAT = 1;

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
const sameList = (a, b) => a.length === b.length && a.every((u, i) => u === b[i]);
const FONT_SIZES = { s: '小', m: '中', l: '大' };

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
    theme: getThemePref(),
    fontSize: getFontSizePref(),
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
    return { settings, problems: ['不是有效的 JSON 文件。'], summary };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { settings, problems: ['文件内容不是一个设置对象。'], summary };
  }
  const format = doc.glyph?.settings;
  if (format !== SETTINGS_FORMAT) {
    problems.push(
      format == null
        ? '这不是雪泥的设置文件（缺少 glyph.settings 标记）。'
        : `设置文件格式版本 ${format} 不受支持（本版本支持 ${SETTINGS_FORMAT}）。`,
    );
    return { settings, problems, summary };
  }

  if (doc.rpcs != null) {
    if (typeof doc.rpcs !== 'object' || Array.isArray(doc.rpcs)) {
      problems.push('rpcs 应是按链 ID 分组的节点列表。');
    } else {
      const rpcs = {};
      for (const [key, list] of Object.entries(doc.rpcs)) {
        const id = Number(key);
        if (!isKnownChain(id)) {
          problems.push(`跳过未知的链 ID ${key}。`);
          continue;
        }
        if (!Array.isArray(list)) {
          problems.push(`${chainName(id)} 的节点列表应是数组。`);
          continue;
        }
        const good = list.filter(isHttpUrl).map((u) => u.trim());
        if (good.length < list.length) problems.push(`${chainName(id)}：忽略 ${list.length - good.length} 个不是 http(s) 地址的节点。`);
        rpcs[id] = good;
        const custom = good.length > 0 && !sameList(good, defaultRpcs(id));
        summary.push(custom ? `${chainName(id)}：${good.length} 个自定义节点` : `${chainName(id)}：默认节点`);
      }
      if (Object.keys(rpcs).length) settings.rpcs = rpcs;
    }
  }
  if (doc.rescanDelayMinutes != null) {
    const n = Number(doc.rescanDelayMinutes);
    if (Number.isFinite(n) && n >= 0) {
      settings.rescanDelayMinutes = n;
      summary.push(`扫描延迟：${n} 分钟`);
    } else {
      problems.push('rescanDelayMinutes 应是不小于 0 的数字。');
    }
  }
  if ('publishChain' in doc) {
    const v = doc.publishChain;
    if (v === null) {
      settings.publishChain = null;
      summary.push('发布到：跟随钱包所在的网络');
    } else if (isKnownChain(v)) {
      settings.publishChain = Number(v);
      summary.push(`发布到：${chainName(v)}`);
    } else {
      problems.push(`publishChain ${v} 不是已知的链。`);
    }
  }
  if ('theme' in doc) {
    const v = doc.theme;
    if (v === null || v === 'light' || v === 'dark') {
      settings.theme = v;
      summary.push(`主题：${v === 'dark' ? '深色' : v === 'light' ? '浅色' : '跟随系统'}`);
    } else {
      problems.push('theme 应是 light、dark 或 null（跟随系统）。');
    }
  }
  if (doc.fontSize != null) {
    if (doc.fontSize in FONT_SIZES) {
      settings.fontSize = doc.fontSize;
      summary.push(`正文字号：${FONT_SIZES[doc.fontSize]}`);
    } else {
      problems.push('fontSize 应是 s、m 或 l。');
    }
  }
  if (doc.log != null) {
    if (typeof doc.log === 'boolean') {
      settings.log = doc.log;
      summary.push(`控制台日志：${doc.log ? '开' : '关'}`);
    } else {
      problems.push('log 应是 true 或 false。');
    }
  }
  if (summary.length === 0 && problems.length === 0) problems.push('文件里没有可应用的设置。');
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
  if ('theme' in settings) setThemePref(settings.theme);
  if (settings.fontSize != null) setFontSizePref(settings.fontSize);
  if (settings.log != null) rpcLog.setEnabled(settings.log);
}
