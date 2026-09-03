// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsPage from '../../src/components/SettingsPage';
import { getLang, setLang } from '../../src/lib/i18n';
import { getRescanDelayMs, getRpcUrls, hasCustomRpcs } from '../../src/lib/config';

const file = (body, name = 'glyph-settings-2026-09-03.json') =>
  new File([JSON.stringify(body)], name, { type: 'application/json' });

const pickFile = (f) => fireEvent.change(screen.getByLabelText('Choose a settings file'), { target: { files: [f] } });

beforeEach(() => {
  localStorage.clear();
  setLang('en');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage — backup and restore', () => {
  it('imports a settings file after showing what it will change', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 1 }, rpcs: { 167000: ['https://taiko.example/rpc'] }, rescanDelayMinutes: 3 }));
    expect(await screen.findByText('Taiko: 1 custom endpoints')).toBeTruthy();
    expect(screen.getByText('Rescan delay: 3 minutes')).toBeTruthy();
    expect(getRpcUrls(167000)).not.toContain('https://taiko.example/rpc'); // nothing applied yet
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(getRpcUrls(167000)).toEqual(['https://taiko.example/rpc']);
    expect(getRescanDelayMs()).toBe(180_000);
    expect(screen.getByRole('status').textContent).toMatch(/Applied the settings in glyph-settings-2026-09-03.json/);
    // The page shows the restored list at once.
    await waitFor(() => expect(screen.getByTitle('https://taiko.example/rpc')).toBeTruthy());
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('shows the problems with a file it cannot use, and offers no apply', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 2 }, theme: 'dark' }, 'old.json'));
    expect(await screen.findByText(/version 2 is not supported/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    const card = document.querySelector('[data-settings-review]');
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/version 2 is not supported/)).toBeNull();
  });

  it('a partly usable file applies its good part and lists the rest', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 1 }, rpcs: { 1: ['https://eth.example', 'nope'] }, fontSize: 'huge' }));
    expect(await screen.findByText('Ethereum: 1 custom endpoints')).toBeTruthy();
    expect(screen.getByText('Ethereum: ignoring 1 entries that are not http(s) URLs.')).toBeTruthy();
    expect(screen.getByText('fontSize should be s, m or l.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(hasCustomRpcs(1)).toBe(true);
    expect(getRpcUrls(1)).toEqual(['https://eth.example']);
  });

  it('exports the current settings as a dated JSON file', async () => {
    let saved = null;
    let downloadName = null;
    URL.createObjectURL = vi.fn((blob) => {
      saved = blob;
      return 'blob:glyph';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloadName = this.download;
    });
    render(<SettingsPage navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Export settings/ }));
    expect(downloadName).toMatch(/^glyph-settings-\d{4}-\d{2}-\d{2}\.json$/);
    expect(saved.type).toBe('application/json');
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(saved);
    });
    expect(JSON.parse(text)).toMatchObject({
      glyph: { settings: 1 },
      rescanDelayMinutes: 1,
      lang: 'en',
      fontSize: 'm',
    });
    expect(screen.getByRole('status').textContent).toMatch(/Exported glyph-settings-/);
  });
});

describe('SettingsPage — language', () => {
  it('switches the interface language in place, and says so in the new one', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(getLang()).toBe('zh');
    expect(localStorage.getItem('glyph.lang.v1')).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    await waitFor(() => expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy());
  });

  it('a settings file carrying a language applies it, and confirms in that language', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 1 }, lang: 'zh' }, 'lang.json'));
    expect(await screen.findByText('Language: 中文')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(getLang()).toBe('zh');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/已应用 lang.json 里的设置/));
  });
});
