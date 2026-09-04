import { expect, test } from '@playwright/test';
import { oracle, prepare } from './app.mjs';

/** Open a post and wait for its body to be on the page. */
async function openPost(page, href) {
  await page.goto(href);
  await expect(page.locator('article .prose-glyph')).toBeVisible({ timeout: 30_000 });
}

test.describe('reading a post', () => {
  test('the arrow keys walk the author\'s posts', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    // A post with an older one by the same author on the same chain.
    const author = posts.find((p) => posts.filter((q) => q.author === p.author && q.chainId === p.chainId).length > 2);
    const mine = posts.filter((p) => p.author === author.author && p.chainId === author.chainId);
    const [newest, older] = mine;

    await openPost(page, newest.href);
    // The cards resolve first; the keys use what they found.
    await expect(page.locator('nav[aria-label] button').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(new RegExp(`${older.txHash}`));

    // An arrow key in a field belongs to the field.
    await page.goto('/search');
    const box = page.getByRole('searchbox', { name: 'Search' });
    await box.fill('abc');
    await box.press('ArrowLeft');
    await expect(page).toHaveURL(/\/search$/);
  });

  test('an image opens full size, and Escape closes it', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    // Whichever fixture letter carries drawings.
    const withImages = posts.find((p) => p.images > 0);
    expect(withImages).toBeTruthy();
    await openPost(page, withImages.href);

    const image = page.locator('article .prose-glyph img').first();
    await expect(image).toBeVisible({ timeout: 30_000 });
    const alt = await image.getAttribute('alt');
    await image.click();

    const lightbox = page.locator('[data-lightbox]');
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('figcaption')).toHaveText(alt);
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
  });

  test('the share menu copies a link, an embed and a quotable reference', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts[0];
    await openPost(page, post.href);

    const read = () => page.evaluate(() => navigator.clipboard.readText());

    await page.getByRole('button', { name: 'Share this post' }).click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    expect(await read()).toBe(new URL(post.href, page.url()).href);

    await page.getByRole('button', { name: /Share this post/ }).click();
    await page.getByRole('menuitem', { name: 'Copy embed code' }).click();
    const embed = await read();
    expect(embed).toContain('<iframe');
    expect(embed).toContain(`${post.href}?headless=1`);
    expect(embed).toContain('loading="lazy"');

    await page.getByRole('button', { name: /Share this post/ }).click();
    await page.getByRole('menuitem', { name: 'Copy reference' }).click();
    expect(await read()).toBe(`[${post.title}](${post.txHash})`);
  });

  test('the embed snippet really does render the post alone', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts[0];
    await page.goto(`${post.href}?headless=1`);
    await expect(page.locator('article .prose-glyph')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('header')).toHaveCount(1); // the article's own, not the masthead
    await expect(page.locator('nav[aria-label]')).toHaveCount(0);
  });

  test('printing leaves the letter and its anchor, and takes the app away', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts[0];
    await openPost(page, post.href);

    await page.emulateMedia({ media: 'print' });
    // The masthead, the back button and the prev/next cards are for clicking.
    await expect(page.locator('[data-noprint]').first()).toBeHidden();
    for (const el of await page.locator('[data-noprint]').all()) await expect(el).toBeHidden();
    // What is left is the letter, and where to find it on chain.
    await expect(page.locator('article .prose-glyph')).toBeVisible();
    await expect(page.locator('[data-printonly]')).toContainText(post.txHash);
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('[data-printonly]')).toBeHidden();
  });
});
