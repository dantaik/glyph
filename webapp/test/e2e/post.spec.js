import { expect, test } from '@playwright/test';
import { chip, oracle, prepare } from './app.mjs';

test.describe('a post', () => {
  test('opens from the feed with its body decoded, and names its chain', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000);
    await page.goto('/');
    await page.locator(`main a[href="${post.href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${post.href}$`));
    await expect(page.locator('article h1')).toHaveText(post.title);
    await expect(page.locator('article')).toContainText(post.probe);
    await expect(chip(page, 'Taiko')).toHaveCount(1);
    // "Read" goes back to the merged feed the post was opened from.
    await page.locator('header nav').getByRole('button', { name: 'Read' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('"previous" walks to the author\'s previous post on the same chain', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000 && p.index > 0);
    const prev = posts.find((p) => p.chainId === 167000 && p.author === post.author && p.index === post.index - 1);
    await page.goto(post.href);
    await expect(page.locator('article h1')).toHaveText(post.title);
    await page.locator('nav[aria-label="Previous and next posts"] button').filter({ hasText: 'Previous' }).click();
    await expect(page).toHaveURL(new RegExp(`${prev.href}$`));
    await expect(page.locator('article h1')).toHaveText(prev.title);
  });

  test('a link from before chains were in the URL is looked up on every chain', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000);
    await page.goto(`/tx/${post.txHash}/0`);
    await expect(page).toHaveURL(new RegExp(`${post.href}$`));
    await expect(page.locator('article h1')).toHaveText(post.title);
  });

  test('?headless=1 is the letter alone — no chrome, and it does not stick', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000 && p.index > 0);
    await page.goto(`${post.href}?headless=1`);
    await expect(page.locator('article h1')).toHaveText(post.title);
    await expect(page.locator('article')).toContainText(post.probe);

    // The letter and its provenance stay: the byline, the network, the block
    // and the transaction it was published in.
    await expect(chip(page, 'Taiko')).toHaveCount(1);
    await expect(page.locator('article footer')).toContainText('Transaction');

    // Every way OFF the page is gone: masthead, site footer, back, prev/next.
    // (`header nav` is the masthead's tabs — the article has a header of its
    // own, which is the title block and stays.)
    await expect(page.locator('header nav')).toHaveCount(0);
    await expect(page.locator('[data-chain-line]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await expect(page.locator('nav[aria-label="Previous and next posts"]')).toHaveCount(0);

    // It applies to this page only: following the byline lands in the
    // ordinary UI, with no flag left in the URL.
    await page.locator('article a[href*="/author/"]').first().click();
    await expect(page).toHaveURL(/\/author\/0x[0-9a-fA-F]{40}$/);
    await expect(page.locator('header nav')).toBeVisible();
  });

  test('?headless=1 survives the redirects that canonicalise a post URL', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000);
    // No event index: the URL converges to /…/0 and keeps the flag.
    await page.goto(`/${post.slug}/tx/${post.txHash}?headless=1`);
    await expect(page).toHaveURL(new RegExp(`${post.href}\\?headless=1$`));
    await expect(page.locator('header nav')).toHaveCount(0);
    // No chain either: the lookup names it, and still keeps the flag.
    await page.goto(`/tx/${post.txHash}/0?headless=1`);
    await expect(page).toHaveURL(new RegExp(`${post.href}\\?headless=1$`));
    await expect(page.locator('header nav')).toHaveCount(0);
    await expect(page.locator('article h1')).toHaveText(post.title);
  });

  test('a transaction nobody published says so', async ({ page }) => {
    await prepare(page);
    await page.goto(`/tx/0x${'ee'.repeat(32)}/0`);
    await expect(page.getByText('No such post')).toBeVisible();
    await expect(page.locator('main')).toContainText('on Ethereum and Taiko');
    await page.getByRole('button', { name: 'Back to the feed' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
