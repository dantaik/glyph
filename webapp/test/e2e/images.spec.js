import { expect, test } from '@playwright/test';
import { prepare } from './app.mjs';

/** A real 8×8 PNG — small, but a genuine image the browser can decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbElEQVR42g3JQQEAMAgDMZSgpEqqhOepQAlKqmjLN1VFFypcTLHFFSmqmm7UuJlmm2vSP0QLCYsRK05EP0wbGZsxa87EP4YeNHiYYYcbMj+WXrR4mWWXW7I/jj50+JhjjztyP0IHBYcJGy4kPLAsVIH5pgt5AAAAAElFTkSuQmCC';

const pngFile = { name: 'hills.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') };

async function openWriteTab(page) {
  await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
  await expect(page.locator('#post-title')).toBeVisible();
}

/** Paste an image into the editor, the way a screenshot arrives. */
async function pasteImage(page, base64) {
  await page.locator('.cm-content').click();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'pasted.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document
      .querySelector('.cm-content')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, base64);
}

const sends = (page) =>
  page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_sendTransaction').length);

test.describe('images in a post', () => {
  test('an image pasted into the body is attached and referenced there', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await openWriteTab(page);

    await pasteImage(page, PNG_BASE64);

    // The reference lands at the cursor, and the file joins the grid.
    await expect(page.locator('.cm-content')).toContainText('![](upload:img1)');
    await expect(page.getByRole('button', { name: 'Copy the reference for img1' })).toBeVisible();

    // …and the preview draws it.
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.locator('.prose-glyph img')).toHaveCount(1);
  });

  test('an image already on chain is referenced again, not paid for again', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await openWriteTab(page);

    // First post: the image is new, so it costs its own transaction.
    await page.locator('#post-title').fill('With a photograph');
    await page.locator('input[type=file]').setInputFiles(pngFile);
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('![](upload:img1)');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 60_000 });
    expect(await sends(page)).toBe(2); // the image, then the post

    // Second post, same image.
    await page.getByRole('button', { name: 'Write another' }).click();
    await page.locator('#post-title').fill('The same photograph');
    await page.locator('input[type=file]').setInputFiles(pngFile);
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('![](upload:img1)');

    // The estimate knows before anything is signed.
    await expect(page.getByText('already on chain · no cost')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 60_000 });
    // One more transaction, not two: the image was not sent a second time.
    expect(await sends(page)).toBe(3);
  });
});
