import { expect, test } from '@playwright/test';
import { prepare } from './app.mjs';

/** The write tab, from wherever the page is. */
async function openWriteTab(page) {
  await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
  await expect(page.locator('#post-title')).toBeVisible();
}

const notice = (page) => page.locator('[data-draft-restored]');

test.describe('the draft the browser keeps', () => {
  test('survives a reload — words, tags and all — and can be discarded', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await openWriteTab(page);

    await page.locator('#post-title').fill('Rain at midnight');
    await page.locator('#post-tags').fill('letters home');
    await page.locator('#post-tags').press('Enter');
    // The body is a CodeMirror document, not a textarea.
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Woken at midnight by rain.');
    await expect(page.locator('.cm-content')).toContainText('Woken at midnight by rain.');

    // The save is debounced by half a second after the last keystroke, so
    // give it its moment before pulling the page out from under it.
    await page.waitForTimeout(900);
    await page.reload();
    await openWriteTab(page);

    await expect(page.locator('#post-title')).toHaveValue('Rain at midnight');
    await expect(page.locator('.cm-content')).toContainText('Woken at midnight by rain.');
    await expect(page.getByText('letters home')).toBeVisible();
    await expect(notice(page)).toContainText('Draft restored');

    // Discarding empties the form and leaves nothing to come back to.
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('#post-title')).toHaveValue('');
    await expect(notice(page)).toHaveCount(0);

    await page.reload();
    await openWriteTab(page);
    await expect(page.locator('#post-title')).toHaveValue('');
    await expect(notice(page)).toHaveCount(0);
  });

  test('an untouched write tab leaves nothing to restore', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await openWriteTab(page);
    // Long enough that a save would have happened, had there been one to make.
    await page.waitForTimeout(1000);

    await page.reload();
    await openWriteTab(page);
    await expect(notice(page)).toHaveCount(0);
  });

  test('publishing clears it: there is no letter left to restore', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await openWriteTab(page);

    await page.locator('#post-title').fill('A letter before the solstice');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await openWriteTab(page);
    await expect(page.locator('#post-title')).toHaveValue('');
    await expect(notice(page)).toHaveCount(0);
  });
});
