// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// router.js reads the URL at import time, so every case loads it afresh.
async function routerAt(url) {
  vi.resetModules();
  window.history.replaceState({}, '', url);
  return import('../../src/lib/router');
}

const TX = `0x${'ab'.repeat(32)}`;
const ADDR = '0x327fa3369B1D1D42120d84bc407e5865ECa7c458';

describe('router (current behaviour)', () => {
  beforeEach(() => localStorage.clear());

  it('parses the chain segment and the route after it', async () => {
    const r = await routerAt(`/taiko/tx/${TX}/2?tab=write`);
    const { readParams } = r;
    expect(readParams()).toMatchObject({ chain: 167000, tx: TX, txEvent: '2', tab: 'write' });
  });

  it('parses a bare chain as that chain\'s home', async () => {
    const __test = await routerAt('/ethereum');
    expect(__test.readParams()).toMatchObject({ chain: 1 });
    expect(__test.readParams().tx).toBeUndefined();
  });

  it('parses a chainless legacy link with chain null', async () => {
    const __test = await routerAt(`/tx/${TX}`);
    expect(__test.readParams()).toMatchObject({ chain: null, tx: TX });
    const home = await routerAt('/');
    expect(home.readParams().chain).toBeNull();
  });

  it('parses /scan and /settings with or without a chain', async () => {
    expect((await routerAt('/taiko/settings')).readParams()).toMatchObject({ chain: 167000, settings: '1' });
    expect((await routerAt('/scan')).readParams()).toMatchObject({ chain: null, scan: '1' });
  });

  it('builds hrefs with the chain prefix', async () => {
    const { hrefFor } = await routerAt('/taiko');
    expect(hrefFor({ chain: 1, tx: TX, txEvent: 0 })).toBe(`/ethereum/tx/${TX}/0`);
    expect(hrefFor({ chain: 167000, author: ADDR })).toBe(`/taiko/author/${ADDR}`);
    expect(hrefFor({ chain: 1, settings: '1', tab: 'x' })).toBe('/ethereum/settings?tab=x');
  });

  it('exposes a query param wherever the query lives', async () => {
    const { queryParam } = await routerAt('/ethereum?log=0');
    expect(queryParam('log')).toBe('0');
  });
});
