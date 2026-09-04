import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { calls, oracle, postHrefs, prepare, reset } from './app.mjs';

/** Open a post and wait for its body to be on the page (and so, cached). */
async function readPost(page, href) {
  await page.goto(href);
  await expect(page.locator('article .prose-glyph')).toBeVisible({ timeout: 30_000 });
}

/** Download whatever the click produces, parsed. */
async function grab(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: download.suggestedFilename(), doc: JSON.parse(readFileSync(await download.path(), 'utf8')) };
}

test.describe('archive bundles', () => {
  test('exports what this browser has read, and says how much', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const chosen = posts.slice(0, 3);
    for (const post of chosen) await readPost(page, post.href);

    await page.goto('/settings');
    const section = page.locator('[data-archive-section]');
    await expect(section).toBeVisible();
    const { name, doc } = await grab(page, () =>
      section.getByRole('button', { name: 'Export everything read here' }).click(),
    );

    expect(name).toMatch(/^glyph-archive-\d{4}-\d{2}-\d{2}\.xueni\.json$/);
    expect(doc.glyph).toEqual({ archive: 1 });
    expect(doc.scope).toEqual({ kind: 'browser' });
    // Every post whose body was read carries its exact stored text.
    for (const post of chosen) {
      const entry = doc.posts.find((p) => p.txHash === post.txHash);
      expect(entry, post.title).toBeTruthy();
      expect(entry.text).toContain(post.probe);
      expect(entry.chainId).toBe(post.chainId);
    }
  });

  test('an author bundle is complete, and reads in another browser with no node at all', async ({
    page,
    request,
    browser,
  }) => {
    // Its own scenario: the call log below must count only the fresh browser.
    await prepare(page, { scenario: 'archive' });
    const { counts, posts } = await oracle(request, 'archive');
    const [author] = Object.entries(counts).find(([, v]) => v.byChain[1] > 0 && v.byChain[167000] > 0);
    const mine = posts.filter((p) => p.author.toLowerCase() === author.toLowerCase());

    await page.goto(`/author/${author}`);
    const { doc } = await grab(page, () => page.locator('[data-export-author]').click());

    expect(doc.scope).toEqual({ kind: 'author', address: author.toLowerCase() });
    expect(doc.posts.map((p) => p.txHash).sort()).toEqual(mine.map((p) => p.txHash).sort());
    expect(doc.authors.every((a) => a.complete)).toBe(true);

    // A second browser, which has read nothing.
    // Nothing else may talk to the node while the log below is being read.
    await page.goto('about:blank');
    const context = await browser.newContext();
    const fresh = await context.newPage();
    try {
      await prepare(fresh, { scenario: 'archive' });
      await fresh.goto('/settings');
      await fresh.locator('[data-archive-section] input[type=file]').setInputFiles({
        name: 'bundle.xueni.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(doc)),
      });
      const review = fresh.locator('[data-archive-review]');
      await expect(review).toBeVisible();
      await expect(review).toContainText('Ethereum:');
      await expect(review).toContainText('authors, complete');
      await review.getByRole('button', { name: 'Apply' }).click();
      await expect(fresh.getByRole('status')).toContainText('Added', { timeout: 30_000 });

      // From here on, anything read is read from the node.
      await reset(request, 'archive');
      await fresh.goto(`/author/${author}`);
      await expect.poll(async () => (await postHrefs(fresh)).length, { timeout: 60_000 }).toBe(mine.length);
      const post = mine[0];
      await readPost(fresh, post.href);
      await expect(fresh.locator('article')).toContainText(post.probe);

      // The bundle carried everything those pages needed.
      const asked = await calls(request, 'archive');
      expect(asked.filter((c) => c.method === 'eth_getTransactionByHash')).toEqual([]);
      expect(asked.filter((c) => c.method === 'eth_getTransactionReceipt')).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('refuses a settings file, and the settings page refuses a bundle', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');

    // A settings file offered to the archive importer.
    await page.locator('[data-archive-section] input[type=file]').setInputFiles({
      name: 'glyph-settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ glyph: { settings: 1 }, theme: 'dark' })),
    });
    await expect(page.locator('[data-archive-review]')).toContainText('not an archive file');

    // …and a bundle offered to the settings importer.
    await page.locator('input[aria-label="Choose a settings file"]').setInputFiles({
      name: 'bundle.xueni.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ glyph: { archive: 1 }, posts: [] })),
    });
    await expect(page.locator('[data-settings-review]')).toContainText('glyph.settings marker is missing');
  });

  test('a bundle from another deployment of the contract is refused', async ({ page }) => {
    await prepare(page);
    await page.goto('/settings');
    await page.locator('[data-archive-section] input[type=file]').setInputFiles({
      name: 'other.xueni.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          glyph: { archive: 1 },
          contract: '0x1111111111111111111111111111111111111111',
          posts: [],
        }),
      ),
    });
    await expect(page.locator('[data-archive-review]')).toContainText('different deployment');
  });
});
