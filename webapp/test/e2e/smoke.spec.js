import { expect, test } from '@playwright/test';
import { oracle, prepare } from './app.mjs';

/**
 * Every page, in both languages, both themes and on a phone.
 *
 * Not a test of what any page says — the other specs do that — but of the
 * thing a person would otherwise have to check by hand before a release:
 * that nothing anywhere throws, and that no page ends up empty.
 */
const ROUTES = ['/', '/ethereum', '/taiko', '/scan', '/settings', '/search', '/following', '/tag/letters%20home'];

/** Collect anything the page complains about while it is open. */
function watch(page) {
  const noise = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') noise.push(msg.text());
  });
  page.on('pageerror', (err) => noise.push(String(err)));
  return noise;
}

test.describe('every page, everywhere', () => {
  for (const [label, storage, writeLabel] of [
    ['English, light', { 'glyph.lang.v1': 'en' }, 'Write'],
    ['Chinese, dark', { 'glyph.lang.v1': 'zh', 'glyph.theme.v1': 'dark' }, '写'],
  ]) {
    test(`opens without an error: ${label}`, async ({ page, request }) => {
      const { posts, counts } = await oracle(request);
      const [author] = Object.entries(counts).find(([, v]) => v.total > 0);
      await prepare(page, { storage });
      const noise = watch(page);

      for (const route of [...ROUTES, `/author/${author}`, posts[0].href]) {
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('main')).not.toBeEmpty();
      }
      // The write tab too. It is state rather than a route, so it is
      // reached the way a reader reaches it.
      await page.goto('/');
      await page.locator('header nav').getByRole('button', { name: writeLabel }).click();
      await expect(page.locator('#post-title')).toBeVisible({ timeout: 30_000 });

      expect(noise).toEqual([]);
    });
  }

  test('opens without an error on a narrow screen', async ({ page, request }) => {
    await page.setViewportSize({ width: 380, height: 720 });
    const { posts } = await oracle(request);
    await prepare(page);
    const noise = watch(page);

    for (const route of [...ROUTES, posts[0].href]) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
      // Nothing may spill sideways: a page wider than the screen is a bug
      // you only ever find by holding a phone.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, route).toBeLessThanOrEqual(0);
    }
    expect(noise).toEqual([]);
  });
});
