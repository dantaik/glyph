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
import * as rpcLog from '../../src/lib/rpcLog';
import { applySettings, collectSettings, parseSettingsFile, serializeSettings, settingsFileName } from '../../src/lib/settingsFile';
import { getFontSizePref, getThemePref, setFontSizePref, setThemePref } from '../../src/lib/theme';

const doc = (body) => JSON.stringify({ glyph: { settings: 1 }, ...body });

describe('settingsFile', () => {
  beforeEach(() => {
    localStorage.clear();
    setThemePref(null);
    setFontSizePref('m');
  });

  it('collects every preference as it stands', () => {
    expect(collectSettings()).toMatchObject({
      glyph: { settings: 1 },
      rpcs: { 1: defaultRpcs(1), 167000: defaultRpcs(167000) },
      rescanDelayMinutes: 1,
      publishChain: null,
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
    setThemePref('dark');
    setFontSizePref('l');
    rpcLog.setEnabled(false);
    const text = serializeSettings();

    localStorage.clear();
    setThemePref(null);
    setFontSizePref('m');
    const { settings, problems, summary } = parseSettingsFile(text);
    expect(problems).toEqual([]);
    expect(summary).toEqual([
      '以太坊：默认节点',
      'Taiko：2 个自定义节点',
      '扫描延迟：5 分钟',
      '发布到：Taiko',
      '主题：深色',
      '正文字号：大',
      '控制台日志：关',
    ]);
    applySettings(settings);
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
    expect(parseSettingsFile('nonsense').problems).toEqual(['不是有效的 JSON 文件。']);
    expect(parseSettingsFile('[1,2]').problems).toEqual(['文件内容不是一个设置对象。']);
    expect(parseSettingsFile('{"theme":"dark"}').problems[0]).toMatch(/缺少 glyph.settings/);
    const later = parseSettingsFile(JSON.stringify({ glyph: { settings: 2 }, theme: 'dark' }));
    expect(later.problems[0]).toMatch(/版本 2 不受支持/);
    expect(later.settings).toEqual({});
    expect(later.summary).toEqual([]);
  });

  it('keeps the valid part and names everything wrong with the rest', () => {
    const { settings, problems, summary } = parseSettingsFile(
      doc({
        rpcs: { 1: ['https://a.example', 'ftp://b.example', 42], 999: ['https://x.example'], 167000: 'nope' },
        rescanDelayMinutes: -1,
        publishChain: 5,
        theme: 'blue',
        fontSize: 'xl',
        log: 'yes',
        somethingElse: true,
      }),
    );
    expect(settings).toEqual({ rpcs: { 1: ['https://a.example'] } });
    expect(summary).toEqual(['以太坊：1 个自定义节点']);
    expect(problems).toEqual([
      '以太坊：忽略 2 个不是 http(s) 地址的节点。',
      '跳过未知的链 ID 999。',
      'Taiko 的节点列表应是数组。',
      'rescanDelayMinutes 应是不小于 0 的数字。',
      'publishChain 5 不是已知的链。',
      'theme 应是 light、dark 或 null（跟随系统）。',
      'fontSize 应是 s、m 或 l。',
      'log 应是 true 或 false。',
    ]);
  });

  it('a list equal to the defaults is applied as "not customized"', () => {
    saveRpcUrls(1, ['https://custom.example']);
    const { settings, summary } = parseSettingsFile(doc({ rpcs: { 1: defaultRpcs(1) } }));
    expect(summary).toEqual(['以太坊：默认节点']);
    applySettings(settings);
    expect(hasCustomRpcs(1)).toBe(false);
    expect(getRpcUrls(1)).toEqual(defaultRpcs(1));
  });

  it('theme null means following the system again; publishChain null means following the wallet', () => {
    setThemePref('dark');
    savePublishChainId(1);
    const { settings, summary } = parseSettingsFile(doc({ theme: null, publishChain: null }));
    expect(summary).toEqual(['发布到：跟随钱包所在的网络', '主题：跟随系统']);
    applySettings(settings);
    expect(getThemePref()).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(false); // jsdom has no dark preference
    expect(getPublishChainId()).toBeNull();
  });

  it('a file with nothing to apply says so', () => {
    expect(parseSettingsFile(doc({ exportedAt: 'whenever' })).problems).toEqual(['文件里没有可应用的设置。']);
  });
});
