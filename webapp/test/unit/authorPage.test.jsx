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
  it('lists every post as a row — the newest too — with author, chain, 第 N 篇, time', async () => {
    const view = createView([worldReader(1), worldReader(167000)]);
    const { container, navigate } = mount(view);
    const list = view.authorList(A0);
    await act(() => settle(list));

    const { rows } = list.getSnapshot();
    expect(rows.length).toBeGreaterThan(1);

    // One row per post, the newest first and written like the rest: no
    // card of its own.
    const rowsOnPage = [...container.querySelectorAll('li')].filter((li) => li.querySelector('a[href*="/tx/"]'));
    expect(rowsOnPage).toHaveLength(rows.length);
    expect(container.querySelector('article')).toBeNull();

    // Every row names the author and says which 第 N 篇 it is on its chain.
    const authorHref = hrefFor({ author: rows[0].author });
    rowsOnPage.forEach((li, i) => {
      expect(li.querySelector(`a[href="${authorHref}"]`)).not.toBeNull();
      expect(li.textContent).toContain(fmtIndex(rows[i].index));
      expect(li.querySelector('a[title^="只看"]')).not.toBeNull();
    });

    // The author link is the way into the author's page.
    fireEvent.click(rowsOnPage[0].querySelector(`a[href="${authorHref}"]`));
    expect(navigate).toHaveBeenCalledWith({ author: rows[0].author });
  });
});
