// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The write tab reaches for the gas price and a chain client on mount; neither
// has anything to do with the draft, and both would go to the network.
vi.mock('../../src/lib/price', () => ({
  getMarketStates: async () => ({}),
  estimatePublishGas: () => 21_000,
  estimateImageGas: () => 21_000,
  gasToCost: () => ({ eth: null, usd: null }),
  fmtEth: () => '—',
  fmtUsd: () => '',
  fmtGwei: () => '—',
}));
// With no client to read headers from, the day's base fees simply fail and
// the sparkline is left out — which is the degradation relied on here.
vi.mock('../../src/lib/clients', () => ({ getClient: () => ({}) }));

const Publisher = (await import('../../src/components/Publisher')).default;
const { clearDraft, loadDraft, saveDraft } = await import('../../src/lib/drafts');
const { setLang, t } = await import('../../src/lib/i18n');

const titleBox = () => screen.getByPlaceholderText(t('publish.titlePlaceholder'));

// jsdom has no matchMedia; the editor's theme hook asks for one.
window.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

beforeEach(async () => {
  localStorage.clear();
  setLang('en');
  await clearDraft();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the write tab and the draft it keeps', () => {
  it('restores what was being written, and says where it came from', async () => {
    await saveDraft({
      title: 'A letter before the solstice',
      tags: ['letters home'],
      markdown: 'Xiaoman,\n\nThe north wind…',
      meta: {},
      files: {},
    });

    render(<Publisher />);

    await waitFor(() => expect(titleBox().value).toBe('A letter before the solstice'));
    expect(screen.getByText('letters home')).toBeTruthy();
    const notice = document.querySelector('[data-draft-restored]');
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain('Draft restored');
  });

  it('does not offer to restore a form nobody wrote in', async () => {
    await saveDraft({ title: '', tags: [], markdown: t('publish.placeholderBody'), meta: {}, files: {} });
    render(<Publisher />);
    await waitFor(() => expect(titleBox()).toBeTruthy());
    expect(document.querySelector('[data-draft-restored]')).toBeNull();
  });

  it('discards on request: the form empties and nothing is left in storage', async () => {
    await saveDraft({ title: 'Half a thought', tags: [], markdown: 'Some words.', meta: {}, files: {} });
    render(<Publisher />);
    await waitFor(() => expect(titleBox().value).toBe('Half a thought'));

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(titleBox().value).toBe('');
    expect(document.querySelector('[data-draft-restored]')).toBeNull();
    await waitFor(async () => expect(await loadDraft()).toBeNull());
  });

  it('writes what is typed, a moment after the typing stops', async () => {
    render(<Publisher />);
    await waitFor(() => expect(titleBox()).toBeTruthy());
    expect(await loadDraft()).toBeNull();

    fireEvent.change(titleBox(), { target: { value: 'Rain at midnight' } });

    await waitFor(async () => expect((await loadDraft())?.title).toBe('Rain at midnight'), { timeout: 3000 });
  });

  it('leaves an untouched form unstored', async () => {
    render(<Publisher />);
    await waitFor(() => expect(titleBox()).toBeTruthy());
    // Long enough for the save to have happened, had there been one to make.
    await new Promise((r) => setTimeout(r, 900));
    expect(await loadDraft()).toBeNull();
  });
});
