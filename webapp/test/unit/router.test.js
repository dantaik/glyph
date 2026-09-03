// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// router.js reads the URL at import time, so every case loads it afresh.
async function routerAt(url) {
  vi.resetModules();
  window.history.replaceState({}, '', url);
  return import('../../src/lib/router');
}

const TX = `0x${'ab'.repeat(32)}`;
const ADDR = '0x327fa3369B1D1D42120d84bc407e5865ECa7c458';
const here = () => window.location.pathname + window.location.search;

describe('readParams — the URL as a state map', () => {
  it('parses the chain segment and the route after it', async () => {
    const { readParams } = await routerAt(`/taiko/tx/${TX}/2?tab=write`);
    expect(readParams()).toMatchObject({ chain: 167000, tx: TX, txEvent: '2', tab: 'write' });
  });

  it("parses a bare chain as that chain's view", async () => {
    const { readParams } = await routerAt('/ethereum');
    expect(readParams()).toMatchObject({ chain: 1 });
    expect(readParams().tx).toBeUndefined();
  });

  it('parses a chainless URL with chain null: every chain, or a legacy post link', async () => {
    const legacy = await routerAt(`/tx/${TX}`);
    expect(legacy.readParams()).toMatchObject({ chain: null, tx: TX });
    const home = await routerAt('/');
    expect(home.readParams().chain).toBeNull();
    const author = await routerAt(`/author/${ADDR}`);
    expect(author.readParams()).toMatchObject({ chain: null, author: ADDR });
  });

  it('parses /scan and /settings with or without a chain', async () => {
    expect((await routerAt('/taiko/settings')).readParams()).toMatchObject({ chain: 167000, settings: '1' });
    expect((await routerAt('/scan')).readParams()).toMatchObject({ chain: null, scan: '1' });
  });

  it('flags a legacy ?author= query link', async () => {
    const { readParams } = await routerAt(`/?author=${ADDR}`);
    expect(readParams()).toMatchObject({ author: ADDR, authorFromQuery: true });
  });

  it('exposes a query param wherever the query lives', async () => {
    const { queryParam } = await routerAt('/ethereum?log=0');
    expect(queryParam('log')).toBe('0');
  });
});

describe('hrefFor — the chain segment is a filter', () => {
  it('names a chain, or none, when told', async () => {
    const { hrefFor } = await routerAt('/');
    expect(hrefFor({ chain: 1 })).toBe('/ethereum');
    expect(hrefFor({ chain: 167000 })).toBe('/taiko');
    expect(hrefFor({ chain: null })).toBe('/');
    expect(hrefFor({ chain: 167000, author: ADDR })).toBe(`/taiko/author/${ADDR}`);
    expect(hrefFor({ chain: null, author: ADDR })).toBe(`/author/${ADDR}`);
    expect(hrefFor({ chain: 1, settings: '1', tab: 'x' })).toBe('/ethereum/settings?tab=x');
  });

  it('inherits the filter the URL carries when the route says nothing', async () => {
    const { hrefFor } = await routerAt('/taiko');
    expect(hrefFor({})).toBe('/taiko');
    expect(hrefFor({ author: ADDR })).toBe(`/taiko/author/${ADDR}`);
    expect(hrefFor({ scan: '1' })).toBe('/taiko/scan');
    expect(hrefFor({ settings: '1' })).toBe('/taiko/settings');
    expect(hrefFor({ chain: null, author: ADDR })).toBe(`/author/${ADDR}`);
  });

  it('inherits nothing on the merged view', async () => {
    const { hrefFor } = await routerAt('/');
    expect(hrefFor({})).toBe('/');
    expect(hrefFor({ author: ADDR })).toBe(`/author/${ADDR}`);
    expect(hrefFor({ scan: '1' })).toBe('/scan');
  });

  it('keeps the demo flag on in-app links', async () => {
    const { hrefFor } = await routerAt('/?fixtures=1');
    expect(hrefFor({ chain: 167000 })).toBe('/taiko?fixtures=1');
    expect(hrefFor({ chain: 1, tx: TX, txEvent: 0 })).toBe(`/ethereum/tx/${TX}/0?fixtures=1`);
  });
});

describe('post routes name their chain', () => {
  it('builds /<chain>/tx/<hash>/<n>', async () => {
    const { hrefFor } = await routerAt('/taiko');
    expect(hrefFor({ chain: 1, tx: TX, txEvent: 0 })).toBe(`/ethereum/tx/${TX}/0`);
    expect(hrefFor({ chain: 167000, tx: TX, txEvent: 2 })).toBe(`/taiko/tx/${TX}/2`);
  });

  it('refuses a post route without a chain — the filter is not an address', async () => {
    const { hrefFor } = await routerAt('/taiko');
    expect(() => hrefFor({ tx: TX, txEvent: 0 })).toThrow(/must name its chain/);
  });
});

describe('navigateTo — the reader\'s choice is remembered', () => {
  it('writes the URL and re-reads it', async () => {
    const r = await routerAt('/');
    r.navigateTo({ chain: 167000 });
    expect(here()).toBe('/taiko');
    expect(r.readParams()).toMatchObject({ chain: 167000 });
  });

  it('keeps the filter while a post from another chain is open', async () => {
    const r = await routerAt('/taiko');
    r.navigateTo({ chain: 1, tx: TX, txEvent: 0 });
    expect(here()).toBe(`/ethereum/tx/${TX}/0`);
    // The way back keeps reading Taiko: the post's chain is where it is,
    // not what was chosen.
    expect(r.hrefFor({})).toBe('/taiko');
    expect(r.hrefFor({ author: ADDR })).toBe(`/taiko/author/${ADDR}`);
    r.navigateTo({});
    expect(here()).toBe('/taiko');
  });

  it('forgets the filter when told to', async () => {
    const r = await routerAt('/taiko');
    r.navigateTo({ chain: null });
    expect(here()).toBe('/');
    expect(r.hrefFor({ author: ADDR })).toBe(`/author/${ADDR}`);
  });

  it('a post opened by its link is not a choice', async () => {
    const r = await routerAt(`/taiko/tx/${TX}/0`);
    expect(r.readParams()).toMatchObject({ chain: 167000, tx: TX, txEvent: '0' });
    expect(r.hrefFor({})).toBe('/');
    expect(r.hrefFor({ author: ADDR })).toBe(`/author/${ADDR}`);
  });

  it('a choice made before a post survives the browser going back to it', async () => {
    const r = await routerAt('/');
    r.navigateTo({ chain: 167000 });
    r.navigateTo({ chain: 1, tx: TX, txEvent: 0 });
    expect(r.hrefFor({})).toBe('/taiko');
  });

  it('replaces instead of pushing when asked', async () => {
    const r = await routerAt('/');
    const before = window.history.length;
    r.navigateTo({ chain: 1 }, { replace: true });
    expect(window.history.length).toBe(before);
    expect(here()).toBe('/ethereum');
    r.navigateTo({ chain: 167000 });
    expect(window.history.length).toBe(before + 1);
  });

  it('re-renders every hook instance', async () => {
    const r = await routerAt('/');
    const a = renderHook(() => r.useUrlState());
    const b = renderHook(() => r.useUrlState());
    act(() => {
      a.result.current[1]({ scan: '1' });
    });
    expect(a.result.current[0]).toMatchObject({ scan: '1' });
    expect(b.result.current[0]).toMatchObject({ scan: '1' });
    expect(here()).toBe('/scan');
  });

  it('follows the browser back button', async () => {
    const r = await routerAt('/');
    const hook = renderHook(() => r.useUrlState());
    act(() => {
      hook.result.current[1]({ chain: 167000 });
    });
    expect(hook.result.current[0].chain).toBe(167000);
    // Popping back to `/` — jsdom's history.back() is async; the hook
    // listens for popstate, so fire the state change by hand.
    act(() => {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(hook.result.current[0].chain).toBeNull();
    expect(r.hrefFor({ author: ADDR })).toBe(`/author/${ADDR}`);
  });
});
