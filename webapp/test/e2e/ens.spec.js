import { expect, test } from '@playwright/test';
import { oracle, postHrefs, prepare } from './app.mjs';

test.describe('an author with a name', () => {
  test('/author/<name>.eth is their page, titled by the name', async ({ page, request }) => {
    await prepare(page);
    const { ens, counts, posts } = await oracle(request);
    const [name, address] = Object.entries(ens.names)[0];
    const mine = posts.filter((p) => p.author.toLowerCase() === address.toLowerCase());

    await page.goto(`/author/${name}`);
    await expect(page.locator('main')).toContainText(name);
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(
      counts[address].total,
    );
    expect(await postHrefs(page)).toEqual(mine.map((p) => p.href));
    // The name stays in the URL: it is the half of the link worth sharing.
    await expect(page).toHaveURL(new RegExp(`/author/${name}$`));
  });

  test('what they say about themselves comes from ENS text records', async ({ page, request }) => {
    await prepare(page);
    const { ens } = await oracle(request);
    const [name] = Object.entries(ens.names)[0];
    const records = ens.records[name];

    await page.goto(`/author/${name}`);
    const profile = page.locator('[data-author-profile]');
    await expect(profile).toBeVisible({ timeout: 30_000 });
    await expect(profile).toContainText(records.description);
    // The href is the record made into a real URL, so it may gain a slash.
    await expect(profile.locator(`a[href^="${records.url}"]`)).toBeVisible();
    await expect(profile.locator(`a[href="https://github.com/${records['com.github']}"]`)).toBeVisible();
  });

  test('their byline says the name rather than the address', async ({ page, request }) => {
    await prepare(page);
    const { ens, posts } = await oracle(request);
    const [name, address] = Object.entries(ens.names)[0];
    const post = posts.find((p) => p.author.toLowerCase() === address.toLowerCase());

    await page.goto(post.href);
    await expect(page.locator('article')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main').getByRole('link', { name })).toBeVisible({ timeout: 30_000 });
  });

  test('an author with no name is still shown by address', async ({ page, request }) => {
    await prepare(page);
    const { ens, counts } = await oracle(request);
    const named = new Set(Object.values(ens.names).map((a) => a.toLowerCase()));
    const [address] = Object.entries(counts).find(
      ([a, v]) => v.total > 0 && !named.has(a.toLowerCase()),
    );

    await page.goto(`/author/${address}`);
    await expect.poll(async () => (await postHrefs(page)).length, { timeout: 60_000 }).toBe(
      counts[address].total,
    );
    await expect(page.locator('[data-author-profile]')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('0x');
  });

  test('a name nobody registered says so, and offers the way back', async ({ page }) => {
    await prepare(page);
    await page.goto('/author/nobody-at-all.eth');
    await expect(page.getByText('No such name: nobody-at-all.eth')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Back to the feed' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
