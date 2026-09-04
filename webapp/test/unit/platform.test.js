// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopVersion, invoke, isDesktop, openExternal, saveFile } from '../../src/lib/platform';
import { downloadBlob } from '../../src/lib/download';
import { hashProcessedImage } from '../../src/lib/publish';
import { t } from '../../src/lib/i18n';

/**
 * The shell's `window.__TAURI__`, recording what was asked of it. The real
 * one is injected by Tauri's `withGlobalTauri`; the app only ever reaches
 * these five functions, so these five are all a stand-in needs.
 */
function fakeShell({ savePath = '/Users/reader/letter.md', version = '0.1.0' } = {}) {
  const calls = { invoke: [], save: [], write: [], open: [] };
  const api = {
    core: {
      async invoke(cmd, args) {
        calls.invoke.push({ cmd, args });
        // The WebP magic number, which is all any caller here looks at.
        return [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
      },
    },
    dialog: {
      async save(options) {
        calls.save.push(options);
        return savePath;
      },
    },
    fs: {
      async writeFile(path, data) {
        calls.write.push({ path, data });
      },
    },
    opener: {
      async openUrl(url) {
        calls.open.push(url);
      },
    },
    app: {
      async getVersion() {
        return version;
      },
    },
  };
  return { calls, api };
}

/** A canvas that answers every encode with `type`, whatever it was asked for. */
function stubCanvas(type) {
  globalThis.createImageBitmap = async () => ({ width: 2400, height: 1200 });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { drawImage() {} };
    }
    async convertToBlob() {
      return new Blob([new Uint8Array([1, 2, 3])], { type });
    }
  };
}

const someBytes = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'text/plain' });

beforeEach(() => {
  delete window.__TAURI__;
  localStorage.clear();
});

afterEach(() => {
  delete window.__TAURI__;
  delete globalThis.createImageBitmap;
  delete globalThis.OffscreenCanvas;
  vi.restoreAllMocks();
});

describe('platform, in a browser', () => {
  it('knows it is not the desktop app', () => {
    expect(isDesktop()).toBe(false);
  });

  it('answers every shell call with nothing, rather than throwing', async () => {
    expect(await invoke('transcode_image', {})).toBe(null);
    expect(await openExternal('https://example.com')).toBe(false);
    expect(await saveFile('letter.md', someBytes())).toBe(false);
    expect(await desktopVersion()).toBe(null);
  });

  it('downloads through an anchor', async () => {
    // jsdom has no object URLs, and no downloads: the click is the evidence.
    URL.createObjectURL = vi.fn(() => 'blob:letter');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob('letter.md', someBytes());
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });
});

describe('platform, inside the desktop shell', () => {
  let shell;
  beforeEach(() => {
    shell = fakeShell();
    window.__TAURI__ = shell.api;
  });

  it('knows where it is', () => {
    expect(isDesktop()).toBe(true);
  });

  it('saves a file through the native panel', async () => {
    expect(await saveFile('letter.md', someBytes())).toBe(true);
    expect(shell.calls.save).toEqual([{ defaultPath: 'letter.md' }]);
    expect(shell.calls.write).toHaveLength(1);
    expect(shell.calls.write[0].path).toBe('/Users/reader/letter.md');
    expect([...shell.calls.write[0].data]).toEqual([1, 2, 3, 4]);
  });

  it('writes nothing when the panel is cancelled', async () => {
    window.__TAURI__ = fakeShell({ savePath: null }).api;
    expect(await saveFile('letter.md', someBytes())).toBe(false);
  });

  it('sends a download to the panel instead of an anchor', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob('2026-09-04-a-letter.md', someBytes());
    // downloadBlob does not await the panel; the call is already in flight.
    await vi.waitFor(() => expect(shell.calls.write).toHaveLength(1));
    expect(click).not.toHaveBeenCalled();
    expect(shell.calls.save).toEqual([{ defaultPath: '2026-09-04-a-letter.md' }]);
  });

  it('opens a link in the default browser', async () => {
    expect(await openExternal('https://etherscan.io/tx/0x0')).toBe(true);
    expect(shell.calls.open).toEqual(['https://etherscan.io/tx/0x0']);
  });

  it('reads the running version', async () => {
    expect(await desktopVersion()).toBe('0.1.0');
  });

  it('says nothing broke when the shell refuses', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.__TAURI__ = {
      ...shell.api,
      opener: {
        openUrl() {
          throw new Error('no');
        },
      },
    };
    expect(await openExternal('https://example.com')).toBe(false);
  });
});

describe('the image pipeline across the two platforms', () => {
  it('refuses a browser that answers a WebP request with something else', async () => {
    // Safari before 16.4 does exactly this: PNG bytes, no error, and the
    // caller left to notice the type. They must never reach the chain.
    stubCanvas('image/png');
    await expect(hashProcessedImage(new Blob([new Uint8Array([1])]))).rejects.toThrow(
      t('error.noWebp'),
    );
  });

  it('accepts a browser that really encodes WebP', async () => {
    stubCanvas('image/webp');
    const { bytes } = await hashProcessedImage(new Blob([new Uint8Array([1])]));
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('hands the bytes to the shell instead of a canvas on the desktop', async () => {
    const shell = fakeShell();
    window.__TAURI__ = shell.api;
    // No canvas is stubbed: reaching for one here would be the bug.
    const file = new Blob([new Uint8Array([9, 8, 7])]);
    const { bytes } = await hashProcessedImage(file, { maxEdge: 1600, quality: 0.6 });

    expect(shell.calls.invoke).toHaveLength(1);
    const { cmd, args } = shell.calls.invoke[0];
    expect(cmd).toBe('transcode_image');
    expect(args.maxEdge).toBe(1600);
    expect(args.quality).toBe(60);
    expect([...args.bytes]).toEqual([9, 8, 7]);
    expect([...bytes.slice(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46]);
  });
});
