import { expect, test } from '@playwright/test';
import { chip, oracle, postHrefs, prepare } from './app.mjs';

test.describe('the home feed', () => {
  test('merges both chains by time, and 继续扫描 completes the merge', async ({ page, request }) => {
    await prepare(page);
    const expected = (await oracle(request)).posts.map((p) => p.href);
    await page.goto('/');
    await expect(chip(page, 'Taiko').first()).toBeVisible();
    await expect(chip(page, 'Ethereum').first()).toBeVisible();
    await expect(page.getByText('来自所有作者 · 2个区块链网络')).toBeVisible();
    // Every post is a row like the next — the newest gets no card of its own — and names its author.
    await expect(page.locator('main article')).toHaveCount(0);
    await expect(page.locator('main li:has(a[href*="/tx/"])').first().locator('a[href^="/author/"]')).toHaveCount(1);
    // …and previews its body under the title.
    await expect(page.locator('main li:has(a[href*="/tx/"]) p').first()).toHaveText(/\S/);

    // Taiko's first sweep stops short of its oldest letters: the page says so,
    // and everything shown is in the order the worlds dictate.
    const marker = page.locator('[data-frontier]');
    await expect(marker).toContainText('Taiko');
    const shown = await postHrefs(page);
    const positions = shown.map((h) => expected.indexOf(h));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    await marker.getByRole('button', { name: '继续扫描' }).click();
    await expect(marker).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => postHrefs(page), { timeout: 30_000 }).toEqual(expected);
    await expect(page.getByText('没有更多文章')).toBeVisible();
  });

  test('the footer names every chain, with what was scanned, and no contract address', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await expect(chip(page, 'Ethereum').first()).toBeVisible();
    const lines = page.locator('footer [data-chain-line]');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('Ethereum');
    await expect(lines.nth(1)).toContainText('Taiko');
    await expect(lines.nth(0)).toContainText(/扫描范围 [\d,]+ 至 [\d,]+/);
    await expect(page.locator('footer')).not.toContainText('合约');
  });

  test('a chain label filters to that chain, which pages on its own; 查看全部 comes back', async ({ page, request }) => {
    await prepare(page);
    const taiko = (await oracle(request)).posts.filter((p) => p.chainId === 167000).map((p) => p.href);
    await page.goto('/');
    await chip(page, 'Taiko').first().click();
    await expect(page).toHaveURL(/\/taiko$/);
    await expect(page.getByText('只看Taiko')).toBeVisible();
    await expect(page.locator('main a[href^="/ethereum/tx/"]')).toHaveCount(0);
    await expect(chip(page, 'Taiko')).toHaveCount(0); // a label here, not a link
    await expect(page.locator('[data-frontier]')).toHaveCount(0);
    await page.getByRole('button', { name: '加载更早的文章' }).click();
    await expect.poll(() => postHrefs(page), { timeout: 60_000 }).toEqual(taiko);
    await expect(page.getByText('没有更多文章')).toBeVisible();
    await page.getByRole('link', { name: '查看全部' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(chip(page, 'Ethereum').first()).toBeVisible();
  });

  test('/ethereum opened directly reads Ethereum alone', async ({ page, request }) => {
    await prepare(page);
    const eth = (await oracle(request)).posts.filter((p) => p.chainId === 1).map((p) => p.href);
    await page.goto('/ethereum');
    await expect(page.getByText('只看Ethereum')).toBeVisible();
    await expect.poll(() => postHrefs(page), { timeout: 60_000 }).toEqual(eth);
    await expect(page.locator('main a[href^="/taiko/tx/"]')).toHaveCount(0);
  });
});
