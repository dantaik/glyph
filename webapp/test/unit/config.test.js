// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// config.js migrates legacy keys at import time, so cases that need a
// particular stored state load it afresh.
async function freshConfig() {
  vi.resetModules();
  return import('../../src/lib/config');
}

describe('config — the chains read', () => {
  it('reads every deployed chain at once', async () => {
    const c = await freshConfig();
    expect(c.READ_CHAIN_IDS).toEqual([1, 167000]);
    expect(c.isReadChain(167000)).toBe(true);
    expect(c.isReadChain('1')).toBe(true);
    expect(c.isReadChain(11155111)).toBe(false);
  });
});

describe('config — the chain written to', () => {
  beforeEach(() => localStorage.clear());

  it('has no publish chain until one is picked', async () => {
    const c = await freshConfig();
    expect(c.getPublishChainId()).toBeNull();
    expect(c.hasOverrides()).toBe(false);
  });

  it('remembers the pick and tells listeners', async () => {
    const c = await freshConfig();
    const heard = vi.fn();
    window.addEventListener(c.PUBLISH_CHAIN_EVT, heard);
    c.savePublishChainId(167000);
    expect(c.getPublishChainId()).toBe(167000);
    expect(localStorage.getItem('glyph.publishChain.v1')).toBe('167000');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(c.hasOverrides()).toBe(true);
  });

  it('ignores an unknown chain and forgets on null', async () => {
    const c = await freshConfig();
    c.savePublishChainId(167000);
    c.savePublishChainId(424242);
    expect(c.getPublishChainId()).toBe(167000);
    c.savePublishChainId(null);
    expect(c.getPublishChainId()).toBeNull();
  });

  it('a stored unknown chain reads as none', async () => {
    localStorage.setItem('glyph.publishChain.v1', '424242');
    const c = await freshConfig();
    expect(c.getPublishChainId()).toBeNull();
  });

  it('resolves the publish chain: the pick, else the wallet when read, else Ethereum', async () => {
    const { resolvePublishChain } = await freshConfig();
    expect(resolvePublishChain(null, null)).toBe(1);
    expect(resolvePublishChain(null, 167000)).toBe(167000);
    expect(resolvePublishChain(null, 1)).toBe(1);
    expect(resolvePublishChain(null, 5)).toBe(1); // a wallet on a chain Glyph doesn't read
    expect(resolvePublishChain(167000, 1)).toBe(167000);
    expect(resolvePublishChain('167000', null)).toBe(167000);
    expect(resolvePublishChain(424242, 167000)).toBe(167000);
  });
});

describe('config — endpoints and rescan delay', () => {
  beforeEach(() => localStorage.clear());

  it('hands out the registry defaults until a list is saved', async () => {
    const c = await freshConfig();
    const defaults = c.getRpcUrls(1);
    expect(defaults.length).toBeGreaterThan(0);
    expect(c.hasCustomRpcs(1)).toBe(false);
    const heard = vi.fn();
    window.addEventListener(c.RPCS_EVT, heard);
    c.saveRpcUrls(1, [' https://node.example/rpc ', 'not a url']);
    expect(c.getRpcUrls(1)).toEqual(['https://node.example/rpc']);
    expect(c.hasCustomRpcs(1)).toBe(true);
    expect(c.getRpcUrls(167000)).not.toEqual(['https://node.example/rpc']);
    expect(heard).toHaveBeenCalledTimes(1);
    // An empty list restores the defaults.
    c.saveRpcUrls(1, []);
    expect(c.getRpcUrls(1)).toEqual(defaults);
    expect(c.hasCustomRpcs(1)).toBe(false);
  });

  it('bumps the version on every change, so clients rebuild', async () => {
    const c = await freshConfig();
    const v0 = c.getRpcVersion();
    c.saveRpcUrls(167000, ['https://a.example']);
    expect(c.getRpcVersion()).toBe(v0 + 1);
    c.resetEndpointConfig();
    expect(c.getRpcVersion()).toBe(v0 + 2);
  });

  it('migrates a single legacy URL into the env chain list', async () => {
    localStorage.setItem('glyph.rpc.v1', 'https://legacy.example');
    const c = await freshConfig();
    expect(c.getRpcUrls(1)[0]).toBe('https://legacy.example');
    expect(c.getRpcUrls(1).length).toBeGreaterThan(1);
    expect(localStorage.getItem('glyph.rpc.v1')).toBeNull();
  });

  it('rescan delay: one minute by default, in minutes, with the legacy key honoured', async () => {
    const c = await freshConfig();
    expect(c.getRescanDelayMs()).toBe(60_000);
    c.saveRescanDelay(5);
    expect(c.getRescanDelayMs()).toBe(300_000);
    c.saveRescanDelay(-3);
    expect(c.getRescanDelayMs()).toBe(60_000);
    localStorage.setItem('glyph.cacheTtl.v1', '3');
    expect(c.getRescanDelayMs()).toBe(180_000);
    c.saveRescanDelay(0);
    expect(c.getRescanDelayMs()).toBe(0);
    expect(localStorage.getItem('glyph.cacheTtl.v1')).toBeNull();
  });

  it('reset forgets every preference, the legacy active chain included', async () => {
    const c = await freshConfig();
    localStorage.setItem('glyph.chainId.v1', '167000');
    c.savePublishChainId(167000);
    c.saveRpcUrls(1, ['https://x.example']);
    c.saveRescanDelay(9);
    expect(c.hasOverrides()).toBe(true);
    const heard = vi.fn();
    window.addEventListener(c.PUBLISH_CHAIN_EVT, heard);
    c.resetEndpointConfig();
    expect(localStorage.getItem('glyph.chainId.v1')).toBeNull();
    expect(c.getPublishChainId()).toBeNull();
    expect(c.hasCustomRpcs(1)).toBe(false);
    expect(c.getRescanDelayMs()).toBe(60_000);
    expect(c.hasOverrides()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
