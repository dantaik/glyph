import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { prepare, rpcLists } from './app.mjs';

test.describe('settings', () => {
  test('exports the settings as a file and imports them back, live', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await expect(page.getByText('备份与恢复')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /导出设置/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^glyph-settings-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(doc.glyph).toEqual({ settings: 1 });
    expect(doc.rpcs['167000']).toEqual(rpcLists('default')[167000]);
    expect(doc).toMatchObject({ rescanDelayMinutes: 1, theme: null, fontSize: 'm', log: false });

    // Add a second Taiko node, a delay and a theme through a file.
    const edited = {
      ...doc,
      rpcs: { ...doc.rpcs, 167000: [...doc.rpcs['167000'], 'https://taiko.example/rpc'] },
      rescanDelayMinutes: 7,
      theme: 'dark',
    };
    await page.locator('input[aria-label="选择设置文件"]').setInputFiles({
      name: 'glyph-settings-edited.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(edited)),
    });
    const review = page.locator('[data-settings-review]');
    await expect(review).toContainText('Taiko：2 个自定义节点');
    await expect(review).toContainText('扫描延迟：7 分钟');
    await expect(review).toContainText('主题：深色');
    await review.getByRole('button', { name: '应用' }).click();
    await expect(page.getByRole('status')).toContainText('已应用');
    await expect(page.locator('span[title="https://taiko.example/rpc"]')).toBeVisible();
    await expect(page.locator('input[type="number"]')).toHaveValue('7');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('refuses a file of another format', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await page.locator('input[aria-label="选择设置文件"]').setInputFiles({
      name: 'later.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ glyph: { settings: 9 }, theme: 'dark' })),
    });
    const review = page.locator('[data-settings-review]');
    await expect(review).toContainText('版本 9 不受支持');
    await expect(review.getByRole('button', { name: '应用' })).toHaveCount(0);
  });
});
