import { expect, test } from '@playwright/test';
import { toFunctionSelector } from 'viem';
import { prepare } from './app.mjs';

const PUBLISH = toFunctionSelector('publish(bytes32,bytes)');
const GLYPH = '0x000000ae2f2249c497cfc5f262dd1491634c361c';

test.describe('the write tab', () => {
  test('publishes to the chosen chain through the wallet, after it is switched there', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x28c58', connected: true } });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    const panel = page.locator('[data-wallet-panel]');
    await expect(panel).toContainText('Connected');
    // Nothing picked: the target follows the wallet, which is on Taiko.
    await expect(panel.getByRole('button', { name: 'Taiko', pressed: true })).toBeVisible();

    await panel.getByRole('button', { name: 'Ethereum' }).click();
    await expect(panel.getByRole('alert')).toContainText('The wallet is on Taiko');
    await expect(page.getByRole('button', { name: 'Publish on-chain' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Switch the wallet’s network' }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel).toContainText('The wallet is on Ethereum');

    await page.locator('#post-title').fill('A letter written in the browser');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 30_000 });
    const sent = await page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_sendTransaction'));
    expect(sent).toHaveLength(1);
    expect(sent[0].params[0].to.toLowerCase()).toBe(GLYPH);
    expect(sent[0].params[0].data.startsWith(PUBLISH)).toBe(true);

    // The pick outlives the page.
    await page.reload();
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    await expect(panel.getByRole('button', { name: 'Ethereum', pressed: true })).toBeVisible();
  });

  test('connects on request and offers the author page', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1' } });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    const panel = page.locator('[data-wallet-panel]');
    await panel.getByRole('button', { name: 'Connect wallet' }).click();
    await expect(panel).toContainText('Connected');
    await panel.getByRole('button', { name: 'View my posts' }).click();
    await expect(page).toHaveURL(/\/author\/0x327fa3369B1D1D42120d84bc407e5865ECa7c458$/);
  });

  test('without a wallet, says what is missing and still lets the chain be picked', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    const panel = page.locator('[data-wallet-panel]');
    await expect(panel).toContainText('No wallet detected');
    await expect(panel.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Taiko' }).click();
    await expect(panel.getByRole('button', { name: 'Taiko', pressed: true })).toBeVisible();
  });
});
