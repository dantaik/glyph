import { expect, test } from '@playwright/test';
import { postHrefs, prepare, oracle } from './app.mjs';

test.describe('an author', () => {
  test('shows their posts from both chains, counted per chain', async ({ page, request }) => {
    await prepare(page);
    const { counts } = await oracle(request);
    const [author, c] = Object.entries(counts).find(([, v]) => v.byChain[1] > 0 && v.byChain[167000] > 0);
    await page.goto(`/author/${author}`);
    await expect(page.locator('main')).toContainText(`共 ${c.total} 篇 · 以太坊 ${c.byChain[1]} · Taiko ${c.byChain[167000]}`);
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(c.total);
    await expect(page.locator('main')).toContainText('第 1 篇');
    await expect(page.locator('[data-frontier]')).toHaveCount(0);

    await page.goto(`/taiko/author/${author}`);
    await expect(page.locator('main')).toContainText('只看Taiko');
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(c.byChain[167000]);
    await expect(page.locator('main a[href^="/ethereum/tx/"]')).toHaveCount(0);
    await page.getByRole('link', { name: '查看全部' }).click();
    await expect(page).toHaveURL(new RegExp(`/author/${author}$`));
  });

  test('an address that never wrote says so', async ({ page }) => {
    await prepare(page);
    await page.goto('/author/0x9999999999999999999999999999999999999999');
    await expect(page.getByText('该地址没发表过文章')).toBeVisible();
  });
});
