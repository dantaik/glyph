import { describe, expect, it, vi } from 'vitest';
import { createView } from '../../src/lib/view';
import { AUTHORS, fakeChain, until } from './helpers';
import { ioReader, settle, worldReader } from './mergedHelpers';

const broken = (name) => (io) => {
  io.blockNumber = async () => {
    throw new Error(`${name} down`);
  };
};

describe('MergedFeed — edges', () => {
  it('a chain read to its floor is never deepened again', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    await settle(view.feed);
    expect(view.feed.getSnapshot().chains[0].exhausted).toBe(true);
    const eth = vi.spyOn(view.reader(1).feed, 'extend');
    const taiko = vi.spyOn(view.reader(167000).feed, 'extend');
    await view.feed.loadMore();
    await settle(view.feed);
    expect(eth).not.toHaveBeenCalled();
    expect(taiko).toHaveBeenCalled();
  });

  it('when every chain fails the page is told so, and retry() asks them all again', async () => {
    const fail = { 1: true, 167000: true };
    const tweak = (id) => (io) => {
      const real = io.blockNumber.bind(io);
      io.blockNumber = async () => {
        if (fail[id]) throw new Error(`${id} down`);
        return real();
      };
    };
    const view = createView([worldReader(1, { tweak: tweak(1) }), worldReader(167000, { tweak: tweak(167000) })]);
    await view.feed.refresh();
    let snap = await settle(view.feed);
    expect(snap.rows).toEqual([]);
    expect(snap.allErrored).toBe(true);
    expect(snap.frontier.leaders.map((l) => l.state)).toEqual(['error', 'error']);
    fail[1] = false;
    fail[167000] = false;
    await view.feed.retry();
    snap = await settle(view.feed);
    expect(snap.anyError).toBe(false);
    expect(snap.rows.length).toBeGreaterThan(0);
  });

  it('loadMore while a job runs joins it', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    await view.feed.refresh();
    await settle(view.feed);
    const p1 = view.feed.loadMore();
    const p2 = view.feed.loadMore();
    expect(p2).toBe(p1);
    await p1;
  });

  it('fillGap on a chain outside the view is refused', async () => {
    const view = createView([worldReader(1)]);
    expect(() => view.feed.fillGap(167000, { from: 1n, to: 2n })).toThrow(/not in this view/);
  });

  it('the note of a fruitless load-more is cleared by one that finds something', async () => {
    const chain = fakeChain({
      chainId: 1,
      head: 3000,
      posts: [
        { author: AUTHORS[0], index: 0, block: 200 },
        { author: AUTHORS[0], index: 1, block: 2600 },
      ],
    });
    chain.io.scanBlocks = 400n;
    chain.io.floor = 0n;
    const view = createView([ioReader(1, chain.io)], { pageSize: 5 });
    await view.feed.refresh();
    await settle(view.feed);
    await view.feed.loadMore(); // 1400..2599: nothing
    let snap = await settle(view.feed);
    expect(snap.note).toEqual({ chainId: 1, fetched: 1200n });
    await view.feed.loadMore(); // 200..1399: the old letter
    snap = await settle(view.feed);
    expect(snap.note).toBeNull();
    expect(snap.rows.map((r) => Number(r.block))).toEqual([2600, 200]);
    expect(snap.done).toBe(false); // 0..199 still unread
  });

  it('rows are stamped by header reads even when the chain clock is unavailable', async () => {
    const noLatest = (io) => {
      const real = io.block.bind(io);
      io.block = (which) => (which === 'latest' ? Promise.reject(new Error('no latest')) : real(which));
    };
    const view = createView([worldReader(1, { ioOpts: { legacyRows: true }, tweak: noLatest })]);
    await view.feed.refresh();
    // Without a clock a legacy row has no time at all, so it stays off the
    // page until its block's header has been read.
    const snap = await until(() => {
      const s = view.feed.getSnapshot();
      return s.rows.length === 12 && s.rows.every((r) => r.tsExact) ? s : null;
    });
    expect(snap.chains[0].total).toBe(12);
  });

  it('a chain whose node fails mid-sweep keeps what it read and says what failed', async () => {
    let n = 0;
    const view = createView([
      worldReader(167000, {
        tweak: (io) => {
          const real = io.postsInRange.bind(io);
          io.postsInRange = async (from, to) => {
            if (++n === 2) throw new Error('taiko hiccup');
            return real(from, to);
          };
        },
      }),
    ]);
    await view.feed.refresh();
    let snap = await settle(view.feed);
    expect(snap.chains[0].error).toMatch(/taiko hiccup/);
    expect(snap.chains[0].coverage.length).toBe(1);
    expect(snap.chains[0].head).toBeNull(); // the head is recorded only by a completed sweep
    const partial = snap.chains[0].coverage[0];
    await view.feed.retry();
    snap = await settle(view.feed);
    expect(snap.chains[0].error).toBeNull();
    expect(snap.chains[0].head).not.toBeNull();
    // The window read before the failure was free this time, so the retried
    // sweep read a full budget beyond it: one range, deeper than before.
    expect(snap.chains[0].coverage).toHaveLength(1);
    expect(snap.chains[0].coverage[0][0]).toBeLessThan(partial[0]);
    expect(snap.rows.length).toBeGreaterThanOrEqual(4);
  });
});
