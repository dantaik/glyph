// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import MarkdownEditor from '../../src/components/MarkdownEditor';

// jsdom has no matchMedia; the editor's theme hook asks for one.
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

beforeEach(() => {
  URL.createObjectURL ??= () => 'blob:stub';
  URL.revokeObjectURL ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const previewImages = () => [...document.querySelectorAll('.prose-glyph img')].map((img) => img.getAttribute('src'));

describe('the preview pane', () => {
  it('shows an image attached to this draft', async () => {
    render(
      <MarkdownEditor
        value={'Look:\n\n![](upload:img1)'}
        onChange={() => {}}
        mode="preview"
        previewUrls={{ img1: 'blob:the-attached-one' }}
      />,
    );
    await waitFor(() => expect(previewImages()).toEqual(['blob:the-attached-one']));
  });

  it('shows an image that is already on chain, through the reader', async () => {
    const resolveEth = vi.fn(async (md) => ({
      markdown: md.replace(/eth:0x[0-9a-f]+/i, 'blob:from-the-chain'),
      urls: ['blob:from-the-chain'],
    }));
    const hash = `0x${'ab'.repeat(32)}`;
    render(
      <MarkdownEditor value={`![](eth:${hash})`} onChange={() => {}} mode="preview" resolveEth={resolveEth} />,
    );
    await waitFor(() => expect(previewImages()).toEqual(['blob:from-the-chain']));
    expect(resolveEth).toHaveBeenCalled();
  });

  it('leaves an on-chain image the node will not serve as its alt text', async () => {
    const resolveEth = vi.fn(async () => {
      throw new Error('the node is not answering');
    });
    render(
      <MarkdownEditor
        value={`![a photograph](eth:0x${'cd'.repeat(32)})`}
        onChange={() => {}}
        mode="preview"
        resolveEth={resolveEth}
      />,
    );
    // The reference stays unresolved rather than taking the preview down.
    // The sanitizer refuses `eth:` as an image source, so what is left is an
    // image with no source showing its alt text — the same thing a post page
    // shows for an image its node cannot serve.
    await waitFor(() => expect(document.querySelector('.prose-glyph img')).toBeTruthy());
    expect(previewImages()).toEqual(['']);
    expect(document.querySelector('.prose-glyph img').getAttribute('alt')).toBe('a photograph');
  });

  it('does not compute a preview while the editor is being typed in', () => {
    const resolveEth = vi.fn(async (md) => ({ markdown: md, urls: [] }));
    render(<MarkdownEditor value="![](upload:img1)" onChange={() => {}} mode="edit" resolveEth={resolveEth} />);
    expect(resolveEth).not.toHaveBeenCalled();
    expect(document.querySelector('.prose-glyph')).toBeNull();
  });
});
