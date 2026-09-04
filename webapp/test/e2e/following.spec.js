import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { calls, oracle, postHrefs, prepare, reset } from './app.mjs';

/** Follow an author from their own page, which is the only way in. */
async function followFrom(page, author) {
  await page.goto(`/author/${author}`);
  const button = page.locator('[data-follow-button]');
  await expect(button).toBeVisible({ timeout: 30_000 });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Every eth_getLogs the mock node was asked for, as [from, to] block pairs. */
async function logRanges(request, scenario) {
  const all = await calls(request, scenario);
  return all
    .filter((c) => c.method === 'eth_getLogs')
    .map((c) => [Number(c.params?.[0]?.fromBlock ?? 0), Number(c.params?.[0]?.toBlock ?? 0)]);
}

test.describe('following authors', () => {
  test('the feed is exactly their posts, read without a single range scan', async ({ page, request }) => {
    // Its own scenario, so the call log below counts only this test's reads.
    await prepare(page, { scenario: 'following' });
    const { counts, posts } = await oracle(request, 'following');
    const [a, b] = Object.entries(counts)
      .filter(([, v]) => v.total > 0)
      .slice(0, 2)
      .map(([address]) => address);

    await followFrom(page, a);
    await followFrom(page, b);

    // From here on, only the following page talks to the node.
    await reset(request, 'following');
    await page.goto('/following');
    await expect(page.locator('[data-following-page]')).toContainText('2 authors');

    const mine = posts.filter((p) => [a, b].some((x) => x.toLowerCase() === p.author.toLowerCase()));
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(mine.length);
    // Exactly their posts, in the oracle's merged order.
    expect(await postHrefs(page)).toEqual(mine.map((p) => p.href));
    // Nobody else's.
    for (const other of posts.filter((p) => !mine.includes(p)).slice(0, 3)) {
      await expect(page.locator(`main a[href="${other.href}"]`)).toHaveCount(0);
    }

    // The point of the design: head pointer, then single blocks. No sweep.
    const ranges = await logRanges(request, 'following');
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.filter(([from, to]) => from !== to)).toEqual([]);
  });

  test('the divider marks what was already read, and moves as the reader keeps up', async ({ page, request }) => {
    const { counts, posts } = await oracle(request);
    const [author] = Object.entries(counts).find(([, v]) => v.total > 2);
    const mine = posts.filter((p) => p.author.toLowerCase() === author.toLowerCase());
    const divider = page.locator('[data-new-since]');
    const settled = async () =>
      expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(mine.length);

    await prepare(page, {
      storage: { 'glyph.following.v1': JSON.stringify({ addresses: [author.toLowerCase()] }) },
    });
    await page.goto('/following');
    await settled();
    // A first visit: it is all new, so there is nothing to divide.
    await expect(divider).toHaveCount(0);

    // Come back as somebody who last read just before the third-newest post.
    // Rewind from another page: leaving `/following` is what records a visit.
    await page.goto('/');
    await page.evaluate((ts) => localStorage.setItem('glyph.followingSeen.v1', String(ts)), mine[2].ts);
    await page.goto('/following');
    await settled();
    await expect(divider).toHaveCount(1);
    await expect(divider).toContainText('Read up to here');
    // Two posts are new: the divider sits under them, above the rest.
    const above = await page
      .locator('main li:has(a[href*="/tx/"]), [data-new-since]')
      .evaluateAll((els) => els.findIndex((el) => el.hasAttribute('data-new-since')));
    expect(above).toBe(2);

    // Leaving records how far they got, so the next visit has nothing new.
    await page.goto('/');
    await page.goto('/following');
    await settled();
    await expect(divider).toHaveCount(0);
  });

  test('unfollowing empties the feed; the settings page keeps the list and the export carries it', async ({ page, request }) => {
    await prepare(page);
    const { counts } = await oracle(request);
    const [a, b] = Object.entries(counts)
      .filter(([, v]) => v.total > 0)
      .slice(0, 2)
      .map(([address]) => address);

    await followFrom(page, a);
    await followFrom(page, b);

    // Both are listed on the settings page, and the export names them.
    await page.goto('/settings');
    const section = page.locator('[data-following-section]');
    await expect(section).toBeVisible();
    await expect(section.locator('li')).toHaveCount(2);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export settings/ }).click(),
    ]);
    const doc = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(doc.following).toEqual([a.toLowerCase(), b.toLowerCase()]);

    // Pruning from the settings page takes the rows out of the feed.
    await section.locator('button[aria-label^="Stop following"]').first().click();
    await expect(section.locator('li')).toHaveCount(1);

    await page.goto('/following');
    await expect(page.locator('[data-following-page]')).toContainText('1 author');
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(counts[b].total);

    // Unfollowing the last one leaves the invitation, not an empty list.
    await page.goto(`/author/${b}`);
    await page.locator('[data-follow-button]').click();
    await page.goto('/following');
    await expect(page.getByText('You are not following anyone yet')).toBeVisible();
    await expect(page.locator('main a[href*="/tx/"]')).toHaveCount(0);
  });

  test('the home feed links to it once somebody is followed', async ({ page, request }) => {
    await prepare(page);
    const { counts } = await oracle(request);
    const [author] = Object.entries(counts).find(([, v]) => v.total > 0);

    await page.goto('/');
    await expect(page.getByRole('link', { name: /^Following \d/ })).toHaveCount(0);
    await followFrom(page, author);
    await page.goto('/');
    await page.getByRole('link', { name: 'Following 1' }).click();
    await expect(page).toHaveURL(/\/following$/);
  });
});
