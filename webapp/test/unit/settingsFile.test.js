// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultRpcs } from '../../src/lib/chains';
import {
  getPublishChainId,
  getRescanDelayMs,
  getRpcUrls,
  hasCustomRpcs,
  savePublishChainId,
  saveRescanDelay,
  saveRpcUrls,
} from '../../src/lib/config';
import { getLang, setLang } from '../../src/lib/i18n';
import * as rpcLog from '../../src/lib/rpcLog';
import { applySettings, collectSettings, parseSettingsFile, serializeSettings, settingsFileName } from '../../src/lib/settingsFile';
import { getFontSizePref, getThemePref, setFontSizePref, setThemePref } from '../../src/lib/theme';

const doc = (body) => JSON.stringify({ glyph: { settings: 1 }, ...body });

describe('settingsFile', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('en');
    setThemePref(null);
    setFontSizePref('m');
  });

  it('collects every preference as it stands', () => {
    expect(collectSettings()).toMatchObject({
      glyph: { settings: 1 },
      rpcs: { 1: defaultRpcs(1), 167000: defaultRpcs(167000) },
      rescanDelayMinutes: 1,
      publishChain: null,
      lang: 'en',
      theme: null,
      fontSize: 'm',
      log: true,
    });
    expect(settingsFileName(new Date('2026-09-03T10:00:00Z'))).toBe('glyph-settings-2026-09-03.json');
  });

  it('round-trips: what was exported is what applies', () => {
    saveRpcUrls(167000, ['https://taiko.example/rpc', 'https://taiko2.example']);
    saveRescanDelay(5);
    savePublishChainId(167000);
    setLang('zh');
    setThemePref('dark');
    setFontSizePref('l');
    rpcLog.setEnabled(false);
    const text = serializeSettings();

    localStorage.clear();
    setLang('en');
    setThemePref(null);
    setFontSizePref('m');
    const { settings, problems, summary } = parseSettingsFile(text);
    expect(problems).toEqual([]);
    // Read back in English — the language the reader is in now, not the one
    // the file was written in.
    expect(summary).toEqual([
      'Ethereum: default endpoints',
      'Taiko: 2 custom endpoints',
      'Rescan delay: 5 minutes',
      'Publish to: Taiko',
      'Language: 中文',
      'Theme: dark',
      'Body text size: L',
      'Console log: off',
    ]);
    applySettings(settings);
    expect(getLang()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(getRpcUrls(167000)).toEqual(['https://taiko.example/rpc', 'https://taiko2.example']);
    expect(hasCustomRpcs(1)).toBe(false);
    expect(getRescanDelayMs()).toBe(300_000);
    expect(getPublishChainId()).toBe(167000);
    expect(getThemePref()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(getFontSizePref()).toBe('l');
    expect(document.documentElement.dataset.fontsize).toBe('l');
    expect(rpcLog.isEnabled()).toBe(false);
  });

  it('refuses a file that is not ours, or of another format', () => {
    expect(parseSettingsFile('nonsense').problems).toEqual(['Not a valid JSON file.']);
    expect(parseSettingsFile('[1,2]').problems).toEqual(['The file does not contain a settings object.']);
    expect(parseSettingsFile('{"theme":"dark"}').problems[0]).toMatch(/glyph.settings marker is missing/);
    const later = parseSettingsFile(JSON.stringify({ glyph: { settings: 2 }, theme: 'dark' }));
    expect(later.problems[0]).toMatch(/version 2 is not supported/);
    expect(later.settings).toEqual({});
    expect(later.summary).toEqual([]);
  });

  it('keeps the valid part and names everything wrong with the rest', () => {
    const { settings, problems, summary } = parseSettingsFile(
      doc({
        rpcs: { 1: ['https://a.example', 'ftp://b.example', 42], 999: ['https://x.example'], 167000: 'nope' },
        rescanDelayMinutes: -1,
        publishChain: 5,
        lang: 'fr',
        theme: 'blue',
        fontSize: 'xl',
        log: 'yes',
        somethingElse: true,
      }),
    );
    expect(settings).toEqual({ rpcs: { 1: ['https://a.example'] } });
    expect(summary).toEqual(['Ethereum: 1 custom endpoints']);
    expect(problems).toEqual([
      'Ethereum: ignoring 2 entries that are not http(s) URLs.',
      'Skipping unknown chain ID 999.',
      'Taiko’s endpoint list should be an array.',
      'rescanDelayMinutes should be a number no smaller than 0.',
      'publishChain 5 is not a known chain.',
      'lang should be en or zh.',
      'theme should be light, dark or null (follow the system).',
      'fontSize should be s, m or l.',
      'log should be true or false.',
    ]);
  });

  it('a list equal to the defaults is applied as "not customized"', () => {
    saveRpcUrls(1, ['https://custom.example']);
    const { settings, summary } = parseSettingsFile(doc({ rpcs: { 1: defaultRpcs(1) } }));
    expect(summary).toEqual(['Ethereum: default endpoints']);
    applySettings(settings);
    expect(hasCustomRpcs(1)).toBe(false);
    expect(getRpcUrls(1)).toEqual(defaultRpcs(1));
  });

  it('theme null means following the system again; publishChain null means following the wallet', () => {
    setThemePref('dark');
    savePublishChainId(1);
    const { settings, summary } = parseSettingsFile(doc({ theme: null, publishChain: null }));
    expect(summary).toEqual(['Publish to: whichever network the wallet is on', 'Theme: follow the system']);
    applySettings(settings);
    expect(getThemePref()).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(false); // jsdom has no dark preference
    expect(getPublishChainId()).toBeNull();
  });

  it('a file with nothing to apply says so', () => {
    expect(parseSettingsFile(doc({ exportedAt: 'whenever' })).problems).toEqual([
      'The file holds no settings that can be applied.',
    ]);
  });
});
