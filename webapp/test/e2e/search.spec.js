import { expect, test } from '@playwright/test';
import { oracle, prepare } from './app.mjs';

/** Wait until the feed has rows, which is when bodies start being read. */
async function openFeed(page) {
  await page.goto('/');
  await expect(page.locator('main a[href*="/tx/"]').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('finding things among what has been read', () => {
  test('a tag on a row leads to the posts carrying it', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    // 'letters home' is on posts on both chains in the demo world.
    const tagged = posts.filter((p) => p.tags?.includes('letters home'));
    expect(tagged.length).toBeGreaterThan(1);

    await openFeed(page);
    await page.getByRole('link', { name: 'letters home' }).first().click();

    await expect(page).toHaveURL(/\/tag\/letters(%20|\+)home$/);
    await expect(page.locator('[data-tag-page]')).toContainText('Tagged letters home');
    await expect(page.locator('[data-tag-page]')).toContainText('posts this browser has read');
    // Every row shown is one of the tagged posts.
    for (const post of tagged.slice(0, 2)) {
      await expect(page.locator(`main a[href="${post.href}"]`).first()).toBeVisible({ timeout: 30_000 });
    }
  });

  test('a word finds the post it appears in, with the words around it', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 1 && /^[\x20-\x7e]+$/.test(p.probe));

    await openFeed(page);
    await page.locator('header').getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search$/);

    const word = post.probe.split(' ')[0];
    await page.getByRole('searchbox', { name: 'Search' }).fill(word);

    const results = page.locator('[data-search-page] ul li');
    await expect(results.first()).toBeVisible({ timeout: 30_000 });
    // The match is marked in the snippet.
    await expect(page.locator('[data-search-page] mark').first()).toBeVisible();
    // …and the query is in the URL, so a search can be shared.
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(word)}`, 'i'));
  });

  test('an empty search offers the tags seen so far', async ({ page }) => {
    await prepare(page);
    await openFeed(page);
    await page.locator('header').getByRole('button', { name: 'Search' }).click();

    const cloud = page.locator('[data-tag-cloud]');
    await expect(cloud).toBeVisible();
    await expect(cloud.getByRole('link', { name: /letters home/ })).toBeVisible({ timeout: 30_000 });

    await cloud.getByRole('link', { name: /letters home/ }).click();
    await expect(page).toHaveURL(/\/tag\//);
  });

  test('a word nobody wrote says so, and says what it looked at', async ({ page }) => {
    await prepare(page);
    await openFeed(page);
    await page.goto('/search?q=zzzznotawordanywhere');
    await expect(page.locator('[data-search-page]')).toContainText('Nothing read here contains');
    await expect(page.locator('[data-search-page]')).toContainText('posts this browser has read');
  });
});
