import { expect, test } from '@playwright/test';
import { oracle, prepare } from './app.mjs';

/** The post whose front-matter carries `key`, on `chainId`. */
const withMeta = (posts, key, chainId) => posts.find((p) => p.chainId === chainId && p.meta?.[key]);

test.describe('what a post says about other posts', () => {
  test('a reply names the letter it answers, and the letter lists the reply', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const reply = withMeta(posts, 're', 1);
    const parent = posts.find((p) => p.txHash === reply.meta.re);

    await page.goto(reply.href);
    const above = page.locator('[data-relations-above]');
    await expect(above).toContainText('In reply to');
    // The link carries the parent's title once it has been looked up.
    await expect(above.getByRole('link', { name: parent.title })).toBeVisible();

    await above.getByRole('link', { name: parent.title }).click();
    await expect(page).toHaveURL(new RegExp(`${parent.href}$`));
    await expect(page.locator('article h1')).toHaveText(parent.title);

    // The other direction comes from what this browser has read — and it has
    // now read the reply, so the parent knows about it.
    const below = page.locator('[data-relations-below]');
    await expect(below).toContainText('Replies');
    await expect(below.getByRole('link', { name: reply.title })).toBeVisible();
    await expect(below).toContainText('Among the posts this browser has read');
  });

  test('a superseded post says a newer version exists', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const newer = withMeta(posts, 'supersedes', 167000);
    const older = posts.find((p) => p.txHash === newer.meta.supersedes);

    // Read the newer one first: that is what teaches this browser the relation.
    await page.goto(newer.href);
    await expect(page.locator('article .prose-glyph')).toBeVisible();
    await expect(page.locator('[data-relations-above]')).toContainText('Supersedes');

    await page.goto(older.href);
    const notice = page.locator('[data-superseded]');
    await expect(notice).toContainText('A newer version of this post exists');
    await expect(notice.getByRole('link', { name: newer.title })).toBeVisible();
  });

  test('a series says which part this is, and links the others read so far', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const parts = posts.filter((p) => p.chainId === 1 && p.meta?.series).sort((a, b) => Number(a.meta.part) - Number(b.meta.part));
    expect(parts.length).toBeGreaterThanOrEqual(3);

    // Read the whole series, so the index has all of it. Waiting for the
    // body to render is what makes it read: `goto` returns on load, long
    // before the body has been fetched, decoded and cached.
    for (const part of parts) {
      await page.goto(part.href);
      await expect(page.locator('article .prose-glyph')).toBeVisible();
    }

    await page.goto(parts[1].href);
    await expect(page.locator('article .prose-glyph')).toBeVisible();
    await expect(page.locator('[data-relations-above]')).toContainText(`Part 2 of ${parts[1].meta.series}`);
    await expect(page.locator('[data-relations-above]')).toContainText('Continues from');

    const below = page.locator('[data-relations-below]');
    await expect(below).toContainText(`More of ${parts[1].meta.series}`);
    await expect(below.getByRole('link', { name: parts[0].title })).toBeVisible();
    await expect(below.getByRole('link', { name: parts[2].title })).toBeVisible();
  });

  test('a post written in another language says so to the browser', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const chinese = withMeta(posts, 'lang', 1);
    await page.goto(chinese.href);
    await expect(page.locator('article')).toHaveAttribute('lang', 'zh');
  });

  test('“Reply” opens the write tab with the reference already filled in', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const post = posts.find((p) => p.chainId === 1);

    await page.goto(post.href);
    await page.getByRole('button', { name: 'Reply', exact: true }).click();

    await expect(page.locator('#post-title')).toBeVisible();
    const relations = page.locator('[data-relations-fields]');
    await expect(relations).toBeVisible();
    await expect(relations.getByLabel('Reply to')).toHaveValue(post.txHash);
  });

  test('a post with no relations shows none of this', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const plain = posts.find((p) => p.chainId === 1 && Object.keys(p.meta ?? {}).length === 0);
    await page.goto(plain.href);
    await expect(page.locator('article h1')).toHaveText(plain.title);
    await expect(page.locator('[data-relations-above]')).toHaveCount(0);
    await expect(page.locator('[data-superseded]')).toHaveCount(0);
  });
});
