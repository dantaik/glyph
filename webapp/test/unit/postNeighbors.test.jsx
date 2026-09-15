// @vitest-environment jsdom
// postNeighbors.test.jsx — the cards under a post: "previous" and "next"
// are the author's own index, one step either way, and a post that reached
// the chain through a hook or a relayer is a neighbour like any other.

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

describe('the neighbours of a post', () => {
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

  it('a post that reached the chain by its own route is a neighbour like any other', async () => {
    // The relayed post is this author's newest: it has a previous and no next.
    const target = mine[0];
    expect(target.relayer).toBeTruthy();
    const older = mine[1];
    const navigate = await openPost(worldReader(1), target);
    await waitFor(() => expect(card('prev')).toBeTruthy());
    expect(card('prev').textContent).toContain(fmtTitle(older.title));
    fireEvent.click(card('prev'));
    expect(navigate).toHaveBeenCalledWith({ chain: 1, tx: older.txHash, txEvent: older.eventIndex ?? 0 });
    expect(card('next')).toBeNull();
  });

  it('the author\u2019s first post has nothing before it', async () => {
    const first = mine[mine.length - 1];
    await openPost(worldReader(1), first);
    await waitFor(() => expect(card('next')).toBeTruthy());
    expect(card('next').textContent).toContain(fmtTitle(mine[mine.length - 2].title));
    await waitFor(() => expect(document.querySelectorAll('nav[aria-label] > div[aria-hidden="true"]')).toHaveLength(0));
    expect(card('prev')).toBeNull();
  });
});
