import { expect, test } from '@playwright/test';
import { chip, prepare, reset } from './app.mjs';

test.describe('when a node misbehaves', () => {
  test('one chain down: the other chain\'s letters show, and the failure is named with a retry', async ({ page }) => {
    await prepare(page, { scenario: 'taiko-down' });
    await page.goto('/');
    await expect(chip(page, '以太坊').first()).toBeVisible({ timeout: 60_000 });
    await expect(chip(page, 'Taiko')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('Taiko 读取失败');
    await expect(page.getByRole('button', { name: '重试' }).first()).toBeVisible();
    await expect(page.locator('footer [data-chain-line]')).toHaveCount(2);
  });

  test('a rate-limiting node is retried until it answers', async ({ page, request }) => {
    await reset(request, 'flaky');
    await prepare(page, { scenario: 'flaky' });
    await page.goto('/');
    await expect(chip(page, '以太坊').first()).toBeVisible({ timeout: 60_000 });
    await expect(chip(page, 'Taiko').first()).toBeVisible({ timeout: 60_000 });
  });

  test('empty chains say so once they have been read to the ground', async ({ page }) => {
    await prepare(page, { scenario: 'empty' });
    await page.goto('/');
    // Ethereum's world fits one sweep; Taiko's does not, so the page offers
    // to keep scanning rather than calling the chains empty.
    await expect(page.getByText('这一段区块里还没有文章')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '继续扫描更早的区块' }).click();
    await expect(page.getByText('此刻还没有文章')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: '写第一篇' })).toBeVisible();
  });
});
