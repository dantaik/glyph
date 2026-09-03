import { expect, test } from '@playwright/test';
import { postHrefs, prepare, oracle } from './app.mjs';

test.describe('an author', () => {
  test('shows their posts from both chains, counted per chain', async ({ page, request }) => {
    await prepare(page);
    const { counts } = await oracle(request);
    const [author, c] = Object.entries(counts).find(([, v]) => v.byChain[1] > 0 && v.byChain[167000] > 0);
    await page.goto(`/author/${author}`);
    await expect(page.locator('main')).toContainText(
      `${c.total} posts · Ethereum ${c.byChain[1]} · Taiko ${c.byChain[167000]}`,
    );
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(c.total);
    await expect(page.locator('main')).toContainText('#1');
    await expect(page.locator('[data-frontier]')).toHaveCount(0);
    // Every post is a row like the next — the newest gets no card of its own —
    // and each row names the author and its ordinal on its chain.
    await expect(page.locator('main article')).toHaveCount(0);
    const first = page.locator('main li:has(a[href*="/tx/"])').first();
    await expect(first.locator('a[href^="/author/"]')).toHaveAttribute('href', new RegExp(`^/author/${author}$`, 'i'));
    await expect(first).toContainText(/#\d+/);
    await expect(page.locator('main a[href^="/author/"]')).toHaveCount(c.total);
    // …and every row previews its body under the title.
    await expect(page.locator('main li:has(a[href*="/tx/"]) p')).toHaveCount(c.total);
    await expect(page.locator('main li:has(a[href*="/tx/"]) p').first()).toHaveText(/\S/);

    await page.goto(`/taiko/author/${author}`);
    await expect(page.locator('main')).toContainText('Taiko only');
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(c.byChain[167000]);
    await expect(page.locator('main a[href^="/ethereum/tx/"]')).toHaveCount(0);
    await page.getByRole('link', { name: 'View all' }).click();
    await expect(page).toHaveURL(new RegExp(`/author/${author}$`));
  });

  test('an address that never wrote says so', async ({ page }) => {
    await prepare(page);
    await page.goto('/author/0x9999999999999999999999999999999999999999');
    await expect(page.getByText('This address has never published')).toBeVisible();
  });
});
