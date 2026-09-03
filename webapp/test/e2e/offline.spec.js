import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { chip, oracle, prepare } from './app.mjs';

const FILE = `file://${resolve(import.meta.dirname, '../../dist/glyph.html')}`;

test.describe('the single-file copy, opened from disk', () => {
  test('reads both chains in hash mode and decodes a post', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    await page.goto(FILE);
    await expect(chip(page, 'Taiko').first()).toBeVisible({ timeout: 60_000 });
    await expect(chip(page, '以太坊').first()).toBeVisible({ timeout: 60_000 });
    expect(await chip(page, 'Taiko').first().getAttribute('href')).toBe('#/taiko');
    await expect(page.locator('footer')).not.toContainText('离线版');

    const post = posts.find((p) => p.chainId === 167000);
    await page.locator(`main a[href="#${post.href}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`#${post.href}$`));
    await expect(page.locator('article h1')).toHaveText(post.title);
    await expect(page.locator('article')).toContainText(post.probe);

    await page.locator('header a[aria-label="回到首页"]').click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(chip(page, '以太坊').first()).toBeVisible();
  });

  test('a chainless fragment link is redirected to the chain that holds the post', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 1);
    await page.goto(`${FILE}#/tx/${post.txHash}/0`);
    await expect(page).toHaveURL(new RegExp(`#${post.href}$`), { timeout: 60_000 });
    await expect(page.locator('article h1')).toHaveText(post.title);
  });
});
