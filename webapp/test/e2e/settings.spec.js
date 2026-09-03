import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { prepare, rpcLists } from './app.mjs';

test.describe('settings', () => {
  test('exports the settings as a file and imports them back, live', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await expect(page.getByText('Backup and restore')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export settings/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^glyph-settings-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(doc.glyph).toEqual({ settings: 1 });
    expect(doc.rpcs['167000']).toEqual(rpcLists('default')[167000]);
    expect(doc).toMatchObject({ rescanDelayMinutes: 1, lang: 'en', theme: null, fontSize: 'm', log: false });

    // Add a second Taiko node, a delay and a theme through a file.
    const edited = {
      ...doc,
      rpcs: { ...doc.rpcs, 167000: [...doc.rpcs['167000'], 'https://taiko.example/rpc'] },
      rescanDelayMinutes: 7,
      theme: 'dark',
    };
    await page.locator('input[aria-label="Choose a settings file"]').setInputFiles({
      name: 'glyph-settings-edited.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(edited)),
    });
    const review = page.locator('[data-settings-review]');
    await expect(review).toContainText('Taiko: 2 custom endpoints');
    await expect(review).toContainText('Rescan delay: 7 minutes');
    await expect(review).toContainText('Theme: dark');
    await review.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('status')).toContainText('Applied the settings in');
    await expect(page.locator('span[title="https://taiko.example/rpc"]')).toBeVisible();
    await expect(page.locator('input[type="number"]')).toHaveValue('7');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('refuses a file of another format', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await page.locator('input[aria-label="Choose a settings file"]').setInputFiles({
      name: 'later.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ glyph: { settings: 9 }, theme: 'dark' })),
    });
    const review = page.locator('[data-settings-review]');
    await expect(review).toContainText('version 9 is not supported');
    await expect(review.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  });

  test('the language switch changes the interface and outlives a reload', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.locator('header').getByRole('button', { name: 'Switch to 中文' }).click();
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('header nav').getByRole('button', { name: '读' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    // The button now names itself in Chinese, since that is the interface.
    await page.locator('header').getByRole('button', { name: '切换到English' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  });
});
