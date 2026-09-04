import { expect, test } from '@playwright/test';
import { prepare } from './app.mjs';

const TWO_WALLETS = {
  chainId: '0x1',
  connected: true,
  wallets: [
    { rdns: 'io.mock.first', name: 'First Wallet' },
    { rdns: 'io.mock.second', name: 'Second Wallet' },
  ],
};

async function openWriteTab(page) {
  await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
  await expect(page.locator('[data-wallet-panel]')).toBeVisible();
}

const chooser = (page) => page.locator('[data-wallet-chooser]');

test.describe('choosing which wallet signs', () => {
  test('two installed wallets can be told apart, and the choice outlives the page', async ({ page }) => {
    await prepare(page, { wallet: TWO_WALLETS });
    await page.goto('/');
    await openWriteTab(page);

    await expect(chooser(page).getByRole('button', { name: 'First Wallet' })).toBeVisible();
    await expect(chooser(page).getByRole('button', { name: 'Second Wallet' })).toBeVisible();

    await chooser(page).getByRole('button', { name: 'Second Wallet' }).click();
    await expect(chooser(page).getByRole('button', { name: 'Second Wallet', pressed: true })).toBeVisible();
    await expect(page.locator('[data-wallet-panel]')).toContainText('Connected with Second Wallet');

    // Publishing goes to the wallet that was chosen, and to no other.
    await page.locator('#post-title').fill('Signed by the second');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 30_000 });
    const sent = await page.evaluate(() =>
      window.__wallets.map((w) => w.calls.filter((c) => c.method === 'eth_sendTransaction').length),
    );
    expect(sent).toEqual([0, 1]);

    await page.reload();
    await openWriteTab(page);
    await expect(chooser(page).getByRole('button', { name: 'Second Wallet', pressed: true })).toBeVisible();
  });

  test('one wallet is not a choice: no chooser, and it still signs', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await openWriteTab(page);

    await expect(chooser(page)).toHaveCount(0);
    await expect(page.locator('[data-wallet-panel]')).toContainText('Connected');

    await page.locator('#post-title').fill('One wallet installed');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 30_000 });
  });

  test('disconnecting gives the connect button back', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await openWriteTab(page);
    const panel = page.locator('[data-wallet-panel]');
    await expect(panel).toContainText('Connected');

    await panel.getByRole('button', { name: 'Disconnect' }).click();
    await expect(panel.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  });

  test('WalletConnect is absent from a build without a project id', async ({ page }) => {
    await prepare(page, { wallet: TWO_WALLETS });
    await page.goto('/');
    await openWriteTab(page);
    await expect(chooser(page).getByRole('button', { name: 'WalletConnect' })).toHaveCount(0);
  });
});
