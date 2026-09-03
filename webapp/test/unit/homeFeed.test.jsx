// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import HomeFeed from '../../src/components/HomeFeed';
import { chainSlug } from '../../src/lib/chains';
import { createFixtureIO } from '../../src/lib/fixtures';
import { buildWorlds, expectedMergedOrder } from '../../src/lib/fixtureWorld';
import { createReader } from '../../src/lib/reader';
import { createScanStore } from '../../src/lib/scanStore';
import { createView } from '../../src/lib/view';
import { NOW, settle, worldReader } from './mergedHelpers';

afterEach(cleanup);
// Scan stores persist to localStorage; every case starts from nothing.
beforeEach(() => localStorage.clear());

const postHref = (r) => `/${chainSlug(r.chainId)}/tx/${r.txHash}/0`;

/** The post links on the page in document order, once each (the featured card links its title too). */
const postHrefs = (container) =>
  [...new Set([...container.querySelectorAll('a[href*="/tx/"]')].map((a) => a.getAttribute('href')))];

function mount(view, props = {}) {
  const navigate = vi.fn();
  const onStartWriting = vi.fn();
  const utils = render(
    <HomeFeed view={view} navigate={navigate} currentChain={null} onStartWriting={onStartWriting} {...props} />,
  );
  return { navigate, onStartWriting, ...utils };
}

const settled = (view) => act(() => settle(view.feed));

describe('HomeFeed over two chains', () => {
  it('shows both chains merged by time, every post naming its chain', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const { container, navigate } = mount(view);
    await settled(view);

    const snap = view.feed.getSnapshot();
    expect(snap.rows.length).toBeGreaterThan(2);
    expect(postHrefs(container)).toEqual(snap.rows.map(postHref));

    // The page order is the oracle's order (over the posts shown so far).
    const oracle = expectedMergedOrder(buildWorlds([1, 167000], { now: NOW })).map(postHref);
    const positions = postHrefs(container).map((h) => oracle.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Each row names its chain; the name is the way into that chain's view.
    const eth = container.querySelectorAll('a[title="只看以太坊"]');
    const taiko = container.querySelectorAll('a[title="只看Taiko"]');
    expect(eth.length).toBe(snap.rows.filter((r) => r.chainId === 1).length);
    expect(taiko.length).toBe(snap.rows.filter((r) => r.chainId === 167000).length);
    expect(taiko[0].getAttribute('href')).toBe('/taiko');
    fireEvent.click(taiko[0]);
    expect(navigate).toHaveBeenCalledWith({ chain: 167000 });

    expect(screen.getByText('来自所有作者 · 以太坊与Taiko')).toBeTruthy();
  });

  it('marks where the merge stops being complete, and 继续扫描 completes it', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const { container } = mount(view);
    await settled(view);

    // Taiko's first sweep reaches only part of the way down: the rows below
    // the marker may be missing Taiko posts, and the marker says so.
    const marker = container.querySelector('[data-frontier]');
    expect(marker).not.toBeNull();
    expect(marker.textContent).toContain('Taiko 只扫描到');
    const before = postHrefs(container).length;

    fireEvent.click(within(marker).getByRole('button', { name: '继续扫描' }));
    await settled(view);
    expect(container.querySelector('[data-frontier]')).toBeNull();
    expect(view.feed.getSnapshot().frontier).toBeNull();
    // Everything both worlds hold now shows, in the oracle's order.
    const oracle = expectedMergedOrder(buildWorlds([1, 167000], { now: NOW }), { limit: view.feed.pageSize }).map(postHref);
    expect(postHrefs(container)).toEqual(oracle);
    expect(postHrefs(container).length).toBeGreaterThan(before);
  });

  it('keeps one chain\'s rows when the other\'s node fails, and recovers on 重试', async () => {
    let restore = null;
    const taiko = worldReader(167000, {
      tweak: (io) => {
        const ok = io.blockNumber;
        io.blockNumber = async () => {
          throw new Error('node down');
        };
        restore = () => {
          io.blockNumber = ok;
        };
      },
    });
    const view = createView([worldReader(1), taiko]);
    const { container } = mount(view);
    await settled(view);

    expect(container.querySelectorAll('a[title="只看以太坊"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('a[title="只看Taiko"]').length).toBe(0);
    const marker = container.querySelector('[data-frontier]');
    expect(marker.textContent).toContain('Taiko 读取失败');

    restore();
    fireEvent.click(within(marker).getByRole('button', { name: '重试' }));
    await settled(view);
    expect(container.querySelectorAll('a[title="只看Taiko"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-frontier]')?.textContent ?? '').not.toContain('读取失败');
  });

  it('says so when both chains are empty, after scanning them to the ground', async () => {
    const emptyReader = (id) =>
      createReader(id, {
        makeIO: (chainId) => createFixtureIO(chainId, 'empty', { now: NOW, delay: 0 }),
        store: createScanStore(id),
      });
    const view = createView([emptyReader(1), emptyReader(167000)]);
    const { onStartWriting } = mount(view);
    await settled(view);

    // Ethereum is small enough to scan whole; Taiko is not, so the page
    // offers to keep scanning rather than calling the chains empty.
    expect(screen.getByText('这一段区块里还没有文章')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续扫描更早的区块' }));
    await settled(view);
    expect(view.feed.getSnapshot().done).toBe(true);
    expect(screen.getByText('此刻还没有文章')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '写第一篇' }));
    expect(onStartWriting).toHaveBeenCalled();
  });
});

describe('HomeFeed over one chain', () => {
  it('says which chain it shows, offers the way back, and has no frontier', async () => {
    const view = createView([worldReader(167000)]);
    const { container, navigate } = mount(view, { currentChain: 167000 });
    await settled(view);

    expect(screen.getByText(/只看Taiko/)).toBeTruthy();
    const all = screen.getByRole('link', { name: '查看全部' });
    expect(all.getAttribute('href')).toBe('/');
    fireEvent.click(all);
    expect(navigate).toHaveBeenCalledWith({ chain: null });

    // The chain label is just a label here.
    expect(container.querySelectorAll('a[title="只看Taiko"]').length).toBe(0);
    expect(container.querySelectorAll('[aria-current="true"]').length).toBe(view.feed.getSnapshot().rows.length);
    expect(container.querySelector('[data-frontier]')).toBeNull();
  });
});
