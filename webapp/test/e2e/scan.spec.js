import { expect, test } from '@playwright/test';
import { chip, prepare } from './app.mjs';

test('/scan lists what was read on each chain', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(chip(page, 'Taiko').first()).toBeVisible();
  await expect(chip(page, '以太坊').first()).toBeVisible();
  await page.locator('footer a[title="查看扫描范围"]').first().click();
  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.locator('main')).toContainText('以太坊 · 1');
  await expect(page.locator('main')).toContainText('Taiko · 167000');
  await expect(page.locator('main')).toContainText(/已同步至区块 [\d,]+/);
  await expect(page.locator('main')).not.toContainText('当前网络');
});
