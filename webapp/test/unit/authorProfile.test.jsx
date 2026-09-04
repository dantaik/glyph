// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import AddressLabel, { Identicon } from '../../src/components/Address';
import AuthorProfile from '../../src/components/AuthorProfile';

afterEach(cleanup);

const ADDRESS = '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5';

/** jsdom's Image never loads anything; drive onload/onerror by hand. */
function stubImage({ succeed }) {
  const originals = [];
  class FakeImage {
    set src(value) {
      this._src = value;
      queueMicrotask(() => (succeed ? this.onload?.() : this.onerror?.()));
    }
    get src() {
      return this._src;
    }
  }
  originals.push(window.Image);
  window.Image = FakeImage;
  globalThis.Image = FakeImage;
  return () => {
    window.Image = originals[0];
    globalThis.Image = originals[0];
  };
}

describe('AuthorProfile', () => {
  it('shows nothing at all when the author has written nothing about themselves', () => {
    const { container } = render(<AuthorProfile profile={null} />);
    expect(container.querySelector('[data-author-profile]')).toBeNull();
    const named = render(<AuthorProfile profile={{ name: 'xiaoman.eth', avatar: 'x' }} />);
    expect(named.container.querySelector('[data-author-profile]')).toBeNull();
  });

  it('shows the description and links the records that are links', () => {
    const { container, getByText } = render(
      <AuthorProfile
        profile={{
          name: 'xiaoman.eth',
          description: 'Letters home.',
          url: 'xiaoman.example/notes',
          twitter: '@xiaoman',
          github: 'xiaoman',
        }}
      />,
    );
    expect(getByText('Letters home.')).toBeTruthy();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://xiaoman.example/notes',
      'https://x.com/xiaoman',
      'https://github.com/xiaoman',
    ]);
    // Somewhere else on the web: a new tab, no referrer, no opener.
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noreferrer noopener');
    }
    // The URL reads the way a person would say it.
    expect(getByText('xiaoman.example/notes')).toBeTruthy();
  });

  it('a url record that is not a link is not shown as one', () => {
    const { container } = render(
      <AuthorProfile profile={{ description: 'Hello.', url: 'javascript:alert(1)' }} />,
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('the avatar beside an address', () => {
  it('is the identicon until the avatar has actually loaded', async () => {
    const restore = stubImage({ succeed: true });
    try {
      const { container } = render(
        <Identicon address={ADDRESS} avatar="https://example.test/face.png" />,
      );
      const img = container.querySelector('img');
      // The identicon is a data: URI, so no layout jump while the avatar loads.
      expect(img.getAttribute('src')).toMatch(/^data:/);
      await waitFor(() => expect(img.getAttribute('src')).toBe('https://example.test/face.png'));
    } finally {
      restore();
    }
  });

  it('a broken avatar leaves the identicon standing', async () => {
    const restore = stubImage({ succeed: false });
    try {
      const { container } = render(
        <Identicon address={ADDRESS} avatar="https://example.test/gone.png" />,
      );
      await act(() => Promise.resolve());
      expect(container.querySelector('img').getAttribute('src')).toMatch(/^data:/);
    } finally {
      restore();
    }
  });

  it('with no avatar it is the identicon and the short address, as before', () => {
    const { container } = render(<AddressLabel address={ADDRESS} />);
    expect(container.querySelector('img').getAttribute('src')).toMatch(/^data:/);
    expect(container.textContent).toContain('0x');
  });
});
