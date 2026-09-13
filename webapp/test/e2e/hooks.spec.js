import { expect, test } from '@playwright/test';
import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem';
import { oracle, prepare } from './app.mjs';

const XUENI = '0x0000008d02020df6bcdd56a888cfc9ed9b9053ec';
const PUBLISH_WITH_HOOK = toFunctionSelector('publish(bytes32,bytes,address,bytes)');
const PUBLISH_FOR = toFunctionSelector('publishFor(address,bytes32,bytes,address,bytes,uint256,bytes)');
const HOOK = '0x00000000000000000000000000000000000000ab';
const ACCOUNT = '0x327fa3369B1D1D42120d84bc407e5865ECa7c458';

const abiV2 = parseAbi([
  'function publish(bytes32 title, bytes payload, address hook, bytes hookData) external payable',
  'function publishFor(address author, bytes32 title, bytes payload, address hook, bytes hookData, uint256 deadline, bytes signature) external payable',
]);

test.describe('the second contract: hooks and relayed posts', () => {
  test('a post through a hook says so on its row and on its page, and the raw view names the call', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const hooked = posts.find((p) => p.hook && p.chainId === 1);
    await page.goto('/');
    // The row carries a mark, the page names the hook and the contract.
    const row = page.locator('main li').filter({ has: page.locator(`a[href="${hooked.href}"]`) });
    await expect(row.locator(`[data-hook-mark="${hooked.hook}"]`)).toBeVisible();
    await page.locator(`main a[href="${hooked.href}"]`).first().click();
    await expect(page.locator('article h1')).toHaveText(hooked.title);
    await expect(page.locator('article')).toContainText(hooked.probe);
    await expect(page.locator('[data-contract-version="2"]')).toHaveText('Xueni');
    const provenance = page.locator('[data-provenance]');
    await expect(provenance).toContainText('Through the hook');
    await expect(provenance.locator(`[data-hook="${hooked.hook}"]`)).toHaveText('Fan-out (several hooks)');
    // The raw view says which call carried it, and shows the hook's data.
    await page.getByRole('button', { name: 'Raw' }).click();
    await expect(page.locator('[data-raw-call="publishWithHook"]')).toContainText('publish(bytes32,bytes,address,bytes)');
    await expect(page.locator('[data-raw-call-bytes]')).toContainText('0xc0ffee');
  });

  test('a relayed post names who sent it, and stays the author’s', async ({ page, request }) => {
    await prepare(page);
    const { posts } = await oracle(request);
    const relayed = posts.find((p) => p.relayer);
    await page.goto(relayed.href);
    await expect(page.locator('article h1')).toHaveText(relayed.title);
    const provenance = page.locator('[data-provenance]');
    await expect(provenance).toContainText('Sent on the author’s behalf by');
    await expect(provenance.locator(`[data-relayer="${relayed.relayer}"]`)).toBeVisible();
    // The byline is the author who signed it, not the relayer.
    await expect(page.locator('article header')).toContainText(relayed.author.slice(-4), { ignoreCase: true });
    await expect(page.locator('article header')).not.toContainText(`By ${relayed.relayer.slice(0, 6)}`, { ignoreCase: true });
    await page.getByRole('button', { name: 'Raw' }).click();
    await expect(page.locator('[data-raw-call="publishFor"]')).toContainText('Signed by');
    // And the author page lists it among their posts, on the second contract.
    await page.goto(`/author/${relayed.author}`);
    await expect(page.locator(`main a[href="${relayed.href}"]`)).toBeVisible();
  });

  test('a hook chosen in the write tab goes out as the four-argument call to the v2 contract', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    await expect(page.locator('[data-publish-target="2"]')).toBeVisible();
    await page.locator('#post-title').fill('Through a hook, from the browser');
    await page.locator('[data-hook-fields] summary').click();
    await page.getByRole('button', { name: 'One hook' }).click();
    await page.getByLabel('Hook address').fill(HOOK);
    await page.getByLabel('Hook data (hex)').fill('0x1234');
    await page.getByLabel('ETH to send along').fill('0.001');
    await expect(page.locator('[data-hook-value]')).toContainText('0.001 ETH');
    await page.getByRole('button', { name: 'Publish on-chain' }).click();
    await expect(page.getByText('Published to Ethereum')).toBeVisible({ timeout: 30_000 });
    const sent = await page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_sendTransaction'));
    expect(sent).toHaveLength(1);
    const tx = sent[0].params[0];
    expect(tx.to.toLowerCase()).toBe(XUENI);
    expect(tx.data.startsWith(PUBLISH_WITH_HOOK)).toBe(true);
    expect(BigInt(tx.value)).toBe(1_000_000_000_000_000n);
    const { args } = decodeFunctionData({ abi: abiV2, data: tx.data });
    expect(args[2].toLowerCase()).toBe(HOOK);
    expect(args[3]).toBe('0x1234');
  });

  test('a post can be signed for a relayer, and the ticket relayed from the same tab', async ({ page }) => {
    await prepare(page, { wallet: { chainId: '0x1', connected: true } });
    await page.goto('/');
    await page.locator('header nav').getByRole('button', { name: 'Write' }).click();
    await expect(page.locator('[data-publish-target="2"]')).toBeVisible();
    await page.locator('#post-title').fill('Signed, not sent');
    await page.getByRole('button', { name: 'Sign for a relayer instead' }).click();
    const ticketView = page.locator('[data-relay-ticket]');
    await expect(ticketView).toBeVisible({ timeout: 30_000 });
    await expect(ticketView).toContainText('as your post #1 on Xueni on Ethereum');
    const signed = await page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_signTypedData_v4'));
    expect(signed).toHaveLength(1);
    const typed = JSON.parse(signed[0].params[1]);
    expect(typed.domain).toMatchObject({ name: 'Xueni', version: '1', chainId: 1, verifyingContract: XUENI });
    expect(typed.primaryType).toBe('Publish');
    expect(typed.message.author.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(typed.message.index).toBe('0');
    // Nothing was sent.
    expect(await page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_sendTransaction'))).toHaveLength(0);

    // The ticket, relayed: pasted into the panel and sent as publishFor.
    const ticket = await ticketView.locator('textarea').inputValue();
    expect(JSON.parse(ticket).author).toBe(ACCOUNT.toLowerCase());
    await page.locator('[data-relay-panel] summary').click();
    await page.getByPlaceholder('Paste the signed post here').fill(ticket);
    await expect(page.locator('[data-relay-summary]')).toContainText('“Signed, not sent”');
    await page.getByRole('button', { name: 'Send it on-chain' }).click();
    await expect(page.locator('[data-relay-sent]')).toContainText('Relayed to Ethereum', { timeout: 30_000 });
    const sent = await page.evaluate(() => window.__wallet.calls.filter((c) => c.method === 'eth_sendTransaction'));
    expect(sent).toHaveLength(1);
    expect(sent[0].params[0].to.toLowerCase()).toBe(XUENI);
    expect(sent[0].params[0].data.startsWith(PUBLISH_FOR)).toBe(true);
    const { args } = decodeFunctionData({ abi: abiV2, data: sent[0].params[0].data });
    expect(args[0].toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(args[6]).toBe(`0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`);
  });
});
