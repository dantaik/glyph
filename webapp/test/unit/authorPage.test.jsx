// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import AuthorPage from '../../src/components/AuthorPage';
import { AUTHORS } from '../../src/lib/fixtureWorld';
import { fmtIndex } from '../../src/lib/format';
import { hrefFor } from '../../src/lib/router';
import { createView } from '../../src/lib/view';
import { settle, worldReader } from './mergedHelpers';

afterEach(cleanup);
// Scan stores persist to localStorage; every case starts from nothing.
beforeEach(() => localStorage.clear());

const [A0] = AUTHORS;

function mount(view, props = {}) {
  const navigate = vi.fn();
  const utils = render(<AuthorPage view={view} author={A0} navigate={navigate} currentChain={null} {...props} />);
  return { navigate, ...utils };
}

describe('AuthorPage', () => {
  it('writes the featured post like the rows: author, chain, 第 N 篇, time', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const { container, navigate } = mount(view);
    const list = view.authorList(A0);
    await act(() => settle(list));

    const { rows } = list.getSnapshot();
    expect(rows.length).toBeGreaterThan(1);

    // Every post names its author, the featured card first — and each
    // says which 第 N 篇 it is on its chain.
    const authorLinks = [...container.querySelectorAll(`a[href="${hrefFor({ author: rows[0].author })}"]`)];
    expect(authorLinks).toHaveLength(rows.length);
    expect(container.textContent.match(/第 \d+ 篇/g)).toHaveLength(rows.length);

    const featured = container.querySelector('article');
    expect(featured.contains(authorLinks[0])).toBe(true);
    expect(featured.textContent).toContain(fmtIndex(rows[0].index));
    expect(featured.querySelector('a[title^="只看"]')).not.toBeNull();

    // The author link is the way into the author's page, as on the rows.
    fireEvent.click(authorLinks[0]);
    expect(navigate).toHaveBeenCalledWith({ author: rows[0].author });
  });
});
