// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import FollowingPage from '../../src/components/FollowingPage';
import { AUTHORS, buildWorlds } from '../../src/lib/fixtureWorld';
import { follow, getSeenTs, setFollowing } from '../../src/lib/following';
import { createView } from '../../src/lib/view';
import { NOW, worldReader } from './mergedHelpers';
import { until } from './helpers';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const [A0, , , A3] = AUTHORS;

/** The demo posts of `author`, newest first. */
function postsOf(author) {
  const worlds = buildWorlds([1, 167000], { now: NOW });
  const all = [];
  for (const world of worlds.values()) {
    for (const p of world.posts) {
      if (p.author.toLowerCase() === author.toLowerCase()) all.push({ ...p, chainId: world.chainId });
    }
  }
  return all.sort((a, b) => b.ts - a.ts);
}

function mount(props = {}) {
  const view = createView([worldReader(1), worldReader(167000)]);
  const navigate = vi.fn();
  const onStartWriting = vi.fn();
  const utils = render(
    <FollowingPage view={view} navigate={navigate} currentChain={null} onStartWriting={onStartWriting} {...props} />,
  );
  return { view, navigate, onStartWriting, ...utils };
}

const rowsOn = (container) =>
  [...container.querySelectorAll('li')].filter((li) => li.querySelector('a[href*="/tx/"]'));

/** Wait until every followed author's posts are on the page. */
const settled = (container, count) =>
  act(() => until(() => (rowsOn(container).length === count ? true : false), { timeout: 5000 }));

describe('FollowingPage', () => {
  it('with nobody followed, invites the reader to find someone', () => {
    const { container, navigate, getByText } = mount();
    expect(getByText('You are not following anyone yet')).toBeTruthy();
    expect(rowsOn(container)).toHaveLength(0);
    fireEvent.click(getByText('Go and find someone'));
    expect(navigate).toHaveBeenCalledWith({});
  });

  it('shows the followed authors\' posts and counts them in the subtitle', async () => {
    setFollowing([A0, A3]);
    const { container } = mount();
    const expected = [...postsOf(A0), ...postsOf(A3)].sort((a, b) => b.ts - a.ts);
    await settled(container, expected.length);
    expect(rowsOn(container).length).toBe(expected.length);
    expect(container.textContent).toContain('2 authors');
  });

  it('names authors who have answered and published nothing', async () => {
    const quiet = '0x0000000000000000000000000000000000000abc';
    setFollowing([A0, quiet]);
    const { container } = mount();
    await settled(container, postsOf(A0).length);
    await waitFor(() => expect(container.textContent).toContain('1 has not published yet'));
    expect(container.textContent).toContain('2 authors');
  });

  it('divides what is new from what was read last visit', async () => {
    const posts = postsOf(A0);
    expect(posts.length).toBeGreaterThan(2);
    localStorage.setItem('glyph.followingSeen.v1', String(posts[2].ts));
    follow(A0);

    const { container } = mount();
    await settled(container, posts.length);
    await waitFor(() => expect(container.querySelector('[data-new-since]')).not.toBeNull());
    // Two posts are newer than the last visit: the divider sits under them.
    const items = [...container.querySelectorAll('li')].filter(
      (li) => li.hasAttribute('data-new-since') || li.querySelector('a[href*="/tx/"]'),
    );
    expect(items.findIndex((li) => li.hasAttribute('data-new-since'))).toBe(2);
  });

  it('leaving the page records how far the reader got', async () => {
    const posts = postsOf(A0);
    follow(A0);
    const { container, unmount } = mount();
    await settled(container, posts.length);
    expect(getSeenTs()).toBe(0);
    unmount();
    expect(getSeenTs()).toBe(posts[0].ts);
  });

  it('with everything read there is no divider at all', async () => {
    const posts = postsOf(A0);
    localStorage.setItem('glyph.followingSeen.v1', String(posts[0].ts));
    follow(A0);
    const { container } = mount();
    await settled(container, posts.length);
    expect(container.querySelector('[data-new-since]')).toBeNull();
  });
});
