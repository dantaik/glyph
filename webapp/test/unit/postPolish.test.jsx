// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Lightbox from '../../src/components/Lightbox';
import ShareMenu, { embedCode } from '../../src/components/ShareMenu';
import PostPage from '../../src/components/PostPage';
import { AUTHORS, buildWorlds } from '../../src/lib/fixtureWorld';
import { NOW, worldReader } from './mergedHelpers';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const TX = `0x${'ab'.repeat(32)}`;

// jsdom implements <dialog> but not its modal behaviour in older versions;
// stub the two methods so the component's own logic is what is under test.
function stubDialog() {
  const proto = window.HTMLDialogElement?.prototype;
  if (!proto) return () => {};
  const original = { show: proto.showModal, close: proto.close };
  proto.showModal = function showModal() {
    this.open = true;
  };
  proto.close = function close() {
    this.open = false;
  };
  return () => {
    proto.showModal = original.show;
    proto.close = original.close;
  };
}

describe('Lightbox', () => {
  it('shows nothing until an image is chosen', () => {
    const { container } = render(<Lightbox src={null} onClose={() => {}} />);
    expect(container.querySelector('[data-lightbox]')).toBeNull();
  });

  it('shows the image with its alt text as the caption, and closes', () => {
    const restore = stubDialog();
    try {
      const onClose = vi.fn();
      const { container, getByText, getByLabelText } = render(
        <Lightbox src="blob:one" alt="A river at dusk" onClose={onClose} />,
      );
      const dialog = container.querySelector('[data-lightbox]');
      expect(dialog.querySelector('img').getAttribute('src')).toBe('blob:one');
      expect(getByText('A river at dusk')).toBeTruthy();
      // Nothing here belongs on paper.
      expect(dialog.hasAttribute('data-noprint')).toBe(true);

      fireEvent.click(getByLabelText('Close'));
      expect(onClose).toHaveBeenCalled();

      // A click that misses the picture is a click outside it.
      fireEvent.click(dialog);
      expect(onClose).toHaveBeenCalledTimes(2);
      // …but a click ON the picture is not.
      fireEvent.click(dialog.querySelector('img'));
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it('Escape closes it once, through the component rather than the browser', () => {
    const restore = stubDialog();
    try {
      const onClose = vi.fn();
      const { container } = render(<Lightbox src="blob:one" onClose={onClose} />);
      fireEvent(container.querySelector('dialog'), new Event('cancel', { cancelable: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

describe('ShareMenu', () => {
  const copied = [];
  beforeEach(() => {
    copied.length = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    });
  });

  const open = (props = {}) => {
    const utils = render(
      <ShareMenu chainId={167000} txHash={TX} eventIndex={0} title="A letter" {...props} />,
    );
    fireEvent.click(utils.getByLabelText('Share this post'));
    return utils;
  };

  it('copies the canonical link to this post', async () => {
    const { getByText } = open();
    fireEvent.click(getByText('Copy link'));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toBe(`${window.location.origin}/taiko/tx/${TX}/0`);
  });

  it('copies an embed snippet pointing at the headless view', async () => {
    const { getByText } = open();
    fireEvent.click(getByText('Copy embed code'));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain(`/taiko/tx/${TX}/0?headless=1`);
    expect(copied[0]).toContain('<iframe');
    expect(copied[0]).toContain('loading="lazy"');
    expect(copied[0]).toContain('title="A letter"');
  });

  it('copies the on-chain reference, which is what another post can quote', async () => {
    const { getByText } = open({ eventIndex: 2 });
    fireEvent.click(getByText('Copy reference'));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toBe(`[A letter](${TX}/2)`);
  });

  it('says it copied, and closes', async () => {
    const { getByText, queryByText, getByLabelText } = open();
    fireEvent.click(getByText('Copy link'));
    await waitFor(() => expect(getByLabelText('Share this post').textContent).toContain('Copied'));
    expect(queryByText('Copy link')).toBeNull();
  });

  it('offers the native share sheet only where there is one', () => {
    const { queryByText, unmount } = open();
    expect(queryByText('Share…')).toBeNull();
    unmount();
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
    try {
      expect(open().queryByText('Share…')).toBeTruthy();
    } finally {
      delete navigator.share;
    }
  });

  it('offers Reply only when there is somewhere to write', () => {
    expect(open().queryByText('Reply')).toBeNull();
    cleanup();
    const onReply = vi.fn();
    const { getByText } = open({ onReply });
    fireEvent.click(getByText('Reply'));
    expect(onReply).toHaveBeenCalled();
  });

  it('an escaped title cannot break out of the embed attribute', () => {
    const code = embedCode({ url: 'https://x.test/a', title: 'He said "no"' });
    expect(code).toContain('title="He said &quot;no&quot;"');
  });
});

describe('reading a post with the keyboard', () => {
  const world = buildWorlds([1], { now: NOW }).get(1);
  const post = world.byAuthor.get(AUTHORS[0].toLowerCase())[1];
  const neighbors = {
    prev: { ...world.byAuthor.get(AUTHORS[0].toLowerCase())[0] },
    next: { ...world.byAuthor.get(AUTHORS[0].toLowerCase())[2] },
  };

  const mount = (props = {}) => {
    const onNavigate = vi.fn();
    const utils = render(
      <PostPage
        reader={worldReader(1)}
        meta={{ ...post, eventIndex: 0 }}
        navigate={vi.fn()}
        onBack={vi.fn()}
        neighbors={neighbors}
        onNavigate={onNavigate}
        onOpenAuthor={vi.fn()}
        {...props}
      />,
    );
    return { onNavigate, ...utils };
  };

  it('left and right go to the neighbours the cards already resolved', async () => {
    const { onNavigate } = mount();
    await act(() => Promise.resolve());
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigate).toHaveBeenCalledWith(neighbors.prev);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenCalledWith(neighbors.next);
  });

  it('a modifier means the browser wanted it: back, forward, history', async () => {
    const { onNavigate } = mount();
    await act(() => Promise.resolve());
    fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true });
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('an arrow key while typing moves the caret and nothing else', async () => {
    const { onNavigate } = mount();
    await act(() => Promise.resolve());
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    document.body.removeChild(input);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('headless mode is an embed in somebody else\'s page: it takes no keys', async () => {
    const { onNavigate } = mount({ headless: true });
    await act(() => Promise.resolve());
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('a neighbour that does not exist is not navigated to', async () => {
    const { onNavigate } = mount({ neighbors: { prev: null, next: null } });
    await act(() => Promise.resolve());
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
