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
    // 读 goes back to the merged feed the post was opened from.
    await page.locator('header nav').getByRole('button', { name: '读' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('上一篇 walks to the author\'s previous post on the same chain', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 167000 && p.index > 0);
    const prev = posts.find((p) => p.chainId === 167000 && p.author === post.author && p.index === post.index - 1);
    await page.goto(post.href);
    await expect(page.locator('article h1')).toHaveText(post.title);
    await page.locator('nav[aria-label="前后篇"] button').filter({ hasText: '上一篇' }).click();
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

  test('a transaction nobody published says so', async ({ page }) => {
    await prepare(page);
    await page.goto(`/tx/0x${'ee'.repeat(32)}/0`);
    await expect(page.getByText('没有找到这篇文章')).toBeVisible();
    await expect(page.locator('main')).toContainText('在以太坊和Taiko上都没有找到');
    await page.getByRole('button', { name: '返回首页' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
