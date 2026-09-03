// @vitest-environment jsdom
//
// The downloadable single file (the offline build) has no host to rewrite
// `/taiko/tx/…` back to the app — and opened from disk, pushState is refused
// on the opaque origin — so the same routes live in the fragment. jsdom
// can't be given a file:// origin (no localStorage there), so the build
// flag is what puts the router in hash mode here.
import { describe, expect, it, vi } from 'vitest';

async function routerAt(hash) {
  vi.resetModules();
  vi.doMock('../../src/lib/offline', () => ({ IS_OFFLINE_BUILD: true, OFFLINE_FILE: 'glyph.html', FROM_FILE: false }));
  window.history.replaceState({}, '', '/');
  window.location.hash = hash;
  return import('../../src/lib/router');
}

const TX = `0x${'cd'.repeat(32)}`;
const ADDR = '0x327fa3369B1D1D42120d84bc407e5865ECa7c458';

describe('router in the single-file build', () => {
  it('is in hash mode', async () => {
    const r = await routerAt('');
    expect(r.HASH_MODE).toBe(true);
  });

  it('reads the route from the fragment, not the path', async () => {
    const r = await routerAt(`#/taiko/tx/${TX}/0?fixtures=1`);
    expect(r.readParams()).toMatchObject({ chain: 167000, tx: TX, txEvent: '0', fixtures: '1' });
    expect(r.queryParam('fixtures')).toBe('1');
    expect(window.location.pathname).toBe('/');
  });

  it('builds fragment hrefs with the same vocabulary', async () => {
    const r = await routerAt('#/taiko');
    expect(r.hrefFor({ chain: 1, tx: TX, txEvent: 0 })).toBe(`#/ethereum/tx/${TX}/0`);
    expect(r.hrefFor({ author: ADDR })).toBe(`#/taiko/author/${ADDR}`);
    expect(r.hrefFor({ chain: null })).toBe('#/');
  });

  it('navigates by writing the fragment', async () => {
    const r = await routerAt('');
    r.navigateTo({ chain: 167000 });
    expect(window.location.hash).toBe('#/taiko');
    r.navigateTo({ chain: 1, tx: TX, txEvent: 0 });
    expect(window.location.hash).toBe(`#/ethereum/tx/${TX}/0`);
    expect(r.readParams()).toMatchObject({ chain: 1, tx: TX });
    r.navigateTo({}, { replace: true });
    expect(window.location.hash).toBe('#/taiko');
    expect(window.location.pathname).toBe('/');
  });
});
