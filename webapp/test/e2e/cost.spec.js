import { expect, test } from '@playwright/test';
import { prepare } from './app.mjs';

test.describe('what a post will cost', () => {
  test('shows the day’s base fees and prices the same draft on the other network', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();

    const panel = page.locator('[data-wallet-panel]');
    await expect(panel.getByRole('button', { name: 'Ethereum', pressed: true })).toBeVisible();

    // The last day of block space, sampled from the chain's own headers.
    const history = page.locator('[data-gas-history]');
    await expect(history).toBeVisible({ timeout: 30_000 });
    await expect(history.getByRole('img', { name: /base fee over the last day/ })).toBeVisible();
    await expect(history).toContainText('24h low');

    // …and the same draft, priced where it is not going.
    const other = page.locator('[data-chain-costs]');
    await expect(other).toContainText('On Taiko this would cost');

    // Following that line moves the publish target, which the wallet panel
    // is the authority on.
    await other.getByRole('button', { name: 'Publish there' }).click();
    await expect(panel.getByRole('button', { name: 'Taiko', pressed: true })).toBeVisible();
    await expect(other).toContainText('On Ethereum this would cost');
  });

  test('a node that will not serve headers costs the line, not the panel', async ({ page }) => {
    // Taiko is down in this scenario, so its write tab has no history to draw.
    await prepare(page, {
      scenario: 'taiko-down',
      wallet: { chainId: '0x28c58', connected: true },
    });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();

    await expect(page.getByText('Estimated cost')).toBeVisible();
    await expect(page.locator('[data-gas-history]')).toHaveCount(0);
  });
});
