// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsPage from '../../src/components/SettingsPage';
import { getRescanDelayMs, getRpcUrls, hasCustomRpcs } from '../../src/lib/config';

const file = (body, name = 'glyph-settings-2026-09-03.json') =>
  new File([JSON.stringify(body)], name, { type: 'application/json' });

const pickFile = (f) => fireEvent.change(screen.getByLabelText('选择设置文件'), { target: { files: [f] } });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPage — backup and restore', () => {
  it('imports a settings file after showing what it will change', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 1 }, rpcs: { 167000: ['https://taiko.example/rpc'] }, rescanDelayMinutes: 3 }));
    expect(await screen.findByText('Taiko：1 个自定义节点')).toBeTruthy();
    expect(screen.getByText('扫描延迟：3 分钟')).toBeTruthy();
    expect(getRpcUrls(167000)).not.toContain('https://taiko.example/rpc'); // nothing applied yet
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(getRpcUrls(167000)).toEqual(['https://taiko.example/rpc']);
    expect(getRescanDelayMs()).toBe(180_000);
    expect(screen.getByRole('status').textContent).toMatch(/已应用 glyph-settings-2026-09-03.json/);
    // The page shows the restored list at once.
    await waitFor(() => expect(screen.getByTitle('https://taiko.example/rpc')).toBeTruthy());
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('shows the problems with a file it cannot use, and offers no 应用', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 2 }, theme: 'dark' }, 'old.json'));
    expect(await screen.findByText(/版本 2 不受支持/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '应用' })).toBeNull();
    const card = document.querySelector('[data-settings-review]');
    fireEvent.click(within(card).getByRole('button', { name: '取消' }));
    expect(screen.queryByText(/版本 2 不受支持/)).toBeNull();
  });

  it('a partly usable file applies its good part and lists the rest', async () => {
    render(<SettingsPage navigate={vi.fn()} />);
    pickFile(file({ glyph: { settings: 1 }, rpcs: { 1: ['https://eth.example', 'nope'] }, fontSize: 'huge' }));
    expect(await screen.findByText('Ethereum：1 个自定义节点')).toBeTruthy();
    expect(screen.getByText('Ethereum：忽略 1 个不是 http(s) 地址的节点。')).toBeTruthy();
    expect(screen.getByText('fontSize 应是 s、m 或 l。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
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
    fireEvent.click(screen.getByRole('button', { name: /导出设置/ }));
    expect(downloadName).toMatch(/^glyph-settings-\d{4}-\d{2}-\d{2}\.json$/);
    expect(saved.type).toBe('application/json');
    const text = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(saved);
    });
    expect(JSON.parse(text)).toMatchObject({ glyph: { settings: 1 }, rescanDelayMinutes: 1, fontSize: 'm' });
    expect(screen.getByRole('status').textContent).toMatch(/已导出 glyph-settings-/);
  });
});
