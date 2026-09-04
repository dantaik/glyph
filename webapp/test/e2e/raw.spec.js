import { expect, test } from '@playwright/test';
import { oracle, prepare } from './app.mjs';

test.describe('the letter as the chain holds it', () => {
  test('shows the exact document, with what it cost to store', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    // A post with tags, so the front-matter shows in the raw text.
    const post = posts.find((p) => p.chainId === 1);
    await page.goto(post.href);
    await expect(page.locator('article h1')).toHaveText(post.title);

    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    const raw = page.locator('[data-raw-view]');
    await expect(raw).toBeVisible();
    // The bytes as stored: front-matter included, and measured both ways.
    await expect(raw.locator('pre')).toContainText('tags:');
    await expect(raw).toContainText('on chain');
    await expect(raw).toContainText('of text');

    await page.getByRole('button', { name: 'Hide raw' }).click();
    await expect(raw).toHaveCount(0);
  });

  test('downloads that same document as a .md file', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 1);
    await page.goto(post.href);
    await expect(page.locator('article h1')).toHaveText(post.title);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download .md' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-.+\.md$/);

    // What was saved is what the chain holds, not what the page rendered.
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain(post.probe);
    expect(text).not.toContain('<p>');
  });

  test('a downloaded letter can be brought back as a draft', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 1);

    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    await page.locator('input[type=file][accept*="markdown"]').setInputFiles({
      name: 'a-letter.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(`---\ntags: letters home\nlang: en\n---\n\n# ${post.title}\n\nSome words.`, 'utf8'),
    });

    await expect(page.locator('#post-title')).toHaveValue(post.title.slice(0, 32));
    await expect(page.getByText('letters home')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('Some words.');
  });

  test('an imported file says which of its front-matter will not travel', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    await page.locator('input[type=file][accept*="markdown"]').setInputFiles({
      name: 'from-elsewhere.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('---\ntitle: Borrowed\nlayout: post\ndraft: true\n---\n\nBody.', 'utf8'),
    });

    await expect(page.locator('#post-title')).toHaveValue('Borrowed');
    await expect(page.getByText(/without these front-matter keys/)).toContainText('draft, layout');
  });
});
