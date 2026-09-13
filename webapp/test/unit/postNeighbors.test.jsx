// @vitest-environment jsdom
// postNeighbors.test.jsx — the cards under a post on a chain with two
// contracts: "previous" and "next" come from the author's merged list, the
// one the author page shows, not from the index on one contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import PostRoute from '../../src/components/PostRoute';
import { AUTHORS, buildWorld } from '../../src/lib/fixtureWorld';
import { fmtTitle } from '../../src/lib/format';
import { NOW, worldReader } from './mergedHelpers';

afterEach(cleanup);
// Each test gets a reader of its own; what a store persisted for an
// earlier one must not seed the next.
beforeEach(() => localStorage.clear());

/** Newest first: by block, then by position in the block — the list's own order. */
const newestFirst = (a, b) => {
  if (a.block !== b.block) return Number(b.block - a.block);
  return Number(b.logIndex ?? 0) - Number(a.logIndex ?? 0);
};

const card = (rel) => document.querySelector(`nav[aria-label] button[rel="${rel}"]`);

async function openPost(reader, post) {
  const navigate = vi.fn();
  render(<PostRoute reader={reader} txHash={post.txHash} eventIndex={post.eventIndex ?? 0} navigate={navigate} />);
  await waitFor(() => expect(document.querySelector('nav[aria-label]')).toBeTruthy());
  return navigate;
}

describe('the neighbours of a post, with two contracts on the chain', () => {
  const world = buildWorld(1, { now: NOW, v2: true });
  const author = AUTHORS[1].toLowerCase();
  const mine = world.posts.filter((p) => p.author.toLowerCase() === author).sort(newestFirst);

  it('the fixtures put this author on both contracts', () => {
    expect(mine.some((p) => Number(p.version ?? 1) === 2)).toBe(true);
    expect(mine.some((p) => Number(p.version ?? 1) === 1)).toBe(true);
  });

  it('a post on the second contract is followed by the author’s older post, whichever contract holds it', async () => {
    const target = mine.find((p) => Number(p.version ?? 1) === 2);
    const k = mine.indexOf(target);
    const older = mine[k + 1];
    const newer = mine[k - 1] ?? null;
    expect(older).toBeTruthy();
    // The point of the test: index 0 on v2 has nothing before it on v2, but
    // the author wrote on v1 before that, and that is the previous post.
    expect(Number(older.version ?? 1)).toBe(1);

    const navigate = await openPost(worldReader(1, { ioOpts: { v2: true } }), target);
    await waitFor(() => expect(card('prev')).toBeTruthy());
    expect(card('prev').textContent).toContain(fmtTitle(older.title));
    fireEvent.click(card('prev'));
    expect(navigate).toHaveBeenCalledWith({ chain: 1, tx: older.txHash, txEvent: older.eventIndex ?? 0 });
    if (newer) {
      await waitFor(() => expect(card('next')).toBeTruthy());
      expect(card('next').textContent).toContain(fmtTitle(newer.title));
    } else {
      expect(card('next')).toBeNull();
    }
  });

  it('a post on the first contract can have a post on the second as its next', async () => {
    const v2 = mine.find((p) => Number(p.version ?? 1) === 2);
    const k = mine.indexOf(v2);
    const target = mine[k + 1];
    expect(Number(target.version ?? 1)).toBe(1);
    const navigate = await openPost(worldReader(1, { ioOpts: { v2: true } }), target);
    await waitFor(() => expect(card('next')).toBeTruthy());
    expect(card('next').textContent).toContain(fmtTitle(v2.title));
    fireEvent.click(card('next'));
    expect(navigate).toHaveBeenCalledWith({ chain: 1, tx: v2.txHash, txEvent: v2.eventIndex ?? 0 });
    const older = mine[k + 2] ?? null;
    if (older) {
      await waitFor(() => expect(card('prev')).toBeTruthy());
      expect(card('prev').textContent).toContain(fmtTitle(older.title));
    } else {
      await waitFor(() => expect(card('prev')).toBeNull());
    }
  });

  it('the author’s first post anywhere has nothing before it', async () => {
    const first = mine[mine.length - 1];
    await openPost(worldReader(1, { ioOpts: { v2: true } }), first);
    await waitFor(() => expect(card('next')).toBeTruthy());
    expect(card('next').textContent).toContain(fmtTitle(mine[mine.length - 2].title));
    await waitFor(() => expect(document.querySelectorAll('nav[aria-label] > div[aria-hidden="true"]')).toHaveLength(0));
    expect(card('prev')).toBeNull();
  });
});

describe('the neighbours of a post, with one contract on the chain', () => {
  const world = buildWorld(1, { now: NOW });
  const author = AUTHORS[1].toLowerCase();
  const mine = world.posts.filter((p) => p.author.toLowerCase() === author).sort(newestFirst);

  it('walks the index: prev is the post before, next the one after', async () => {
    const target = mine[1];
    const navigate = await openPost(worldReader(1), target);
    await waitFor(() => expect(card('prev')).toBeTruthy());
    await waitFor(() => expect(card('next')).toBeTruthy());
    expect(card('prev').textContent).toContain(fmtTitle(mine[2].title));
    expect(card('next').textContent).toContain(fmtTitle(mine[0].title));
    fireEvent.click(card('prev'));
    expect(navigate).toHaveBeenCalledWith({ chain: 1, tx: mine[2].txHash, txEvent: mine[2].eventIndex ?? 0 });
  });
});
