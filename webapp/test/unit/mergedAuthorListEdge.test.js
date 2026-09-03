import { describe, expect, it } from 'vitest';
import { AUTHORS as WORLD_AUTHORS } from '../../src/lib/fixtureWorld';
import { createView } from '../../src/lib/view';
import { settle, worldReader } from './mergedHelpers';

const [A0] = WORLD_AUTHORS;
const NOBODY = '0x9999999999999999999999999999999999999999';

const failLatest = (flag) => (io) => {
  const real = io.latestBlock.bind(io);
  io.latestBlock = async (author) => {
    if (flag.on) throw new Error(`${io.chainId} down`);
    return real(author);
  };
};

describe('MergedAuthorList — edges', () => {
  it('an author with nothing anywhere: empty, complete, no frontier', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const list = view.authorList(NOBODY);
    await list.refresh();
    const snap = await settle(list);
    expect(snap.rows).toEqual([]);
    expect(snap.hasMore).toBe(false);
    expect(snap.frontier).toBeNull();
    expect(snap.chains.map((c) => c.bound)).toEqual([-Infinity, -Infinity]);
    expect(await view.counts(NOBODY)).toEqual({ total: 0n, byChain: { 1: 0n, 167000: 0n } });
  });

  it('when every chain fails, retrying one brings its rows back while the other stays failed', async () => {
    const eth = { on: true };
    const taiko = { on: true };
    const view = createView([worldReader(1, { tweak: failLatest(eth) }), worldReader(167000, { tweak: failLatest(taiko) })]);
    const list = view.authorList(A0);
    await list.refresh();
    let snap = await settle(list);
    expect(snap.allErrored).toBe(true);
    expect(snap.rows).toEqual([]);
    expect(snap.frontier.leaders.map((l) => l.state)).toEqual(['error', 'error']);
    eth.on = false;
    await list.retry(1);
    snap = await settle(list);
    expect(snap.allErrored).toBe(false);
    expect(snap.anyError).toBe(true);
    expect(snap.rows.every((r) => r.chainId === 1)).toBe(true);
    expect(snap.rows).toHaveLength(5);
    expect(snap.frontier).toMatchObject({ after: -1, leaders: [{ chainId: 167000, state: 'error' }] });
  });

  it('加载更早 on a chain that failed before it had rows asks it again rather than walking', async () => {
    const taiko = { on: true };
    const view = createView([worldReader(1), worldReader(167000, { tweak: failLatest(taiko) })]);
    const list = view.authorList(A0);
    await list.refresh();
    let snap = await settle(list);
    expect(snap.chains[1].error).toMatch(/down/);
    taiko.on = false;
    await list.loadMore();
    snap = await settle(list);
    expect(snap.chains[1].error).toBeNull();
    expect(snap.rows.filter((r) => r.chainId === 167000)).toHaveLength(3);
    expect(snap.frontier).toBeNull();
  });

  it('is the same list object for the same author, however the address is cased', () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    expect(view.authorList(A0)).toBe(view.authorList(A0.toLowerCase()));
  });
});
