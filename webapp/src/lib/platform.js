// platform.js — the seam between the web app and the desktop shell.
//
// There is one Xueni, built once, running in two places: a browser tab and
// a Tauri window on macOS (`desktop/`). The window is a WebKit view around
// the same `dist/`, so almost everything already works there. Three things
// do not, and this module is where the app asks for them instead:
//
//   - a WKWebView has no download manager, so `<a download>` does nothing
//     and a file has to go through a native save panel;
//   - WebKit cannot encode WebP from a canvas, so the image a post carries
//     is encoded by the shell (`transcode_image`);
//   - a link to another site would otherwise open inside the app, which is
//     a browser with no address bar and no way back.
//
// Everything here is feature-detected on `window.__TAURI__`, which the shell
// injects and a browser never has. On the web every function is a no-op or
// null, so the website carries this file and never notices it. Nothing in
// the app imports the Tauri npm packages: the shell sets `withGlobalTauri`,
// which puts the same API on the window, and the web build stays the size
// it was.

/** The shell's API object, or undefined in a browser. */
const shell = () => (typeof window === 'undefined' ? undefined : window.__TAURI__);

/** Whether the app is running inside the desktop shell. */
export function isDesktop() {
  return Boolean(shell());
}

/**
 * Call one of the shell's own commands. Null on the web, where there is
 * nothing to call.
 */
export async function invoke(cmd, args) {
  const api = shell();
  if (!api) return null;
  return api.core.invoke(cmd, args);
}

/**
 * Open `url` in the reader's default browser.
 * @returns {Promise<boolean>} whether the shell took it
 */
export async function openExternal(url) {
  const api = shell();
  if (!api) return false;
  try {
    await api.opener.openUrl(url);
    return true;
  } catch (err) {
    // A link that will not open is not worth an error dialog; the reader
    // can still copy it out of the page.
    console.warn('could not open', url, err);
    return false;
  }
}

/**
 * Save `blob` as `name` through the native save panel.
 *
 * The panel decides where the file goes, and the shell's file permission
 * follows from that choice: nothing can be written that the reader did not
 * point at. A cancelled panel is not an error — it is an answer.
 * @returns {Promise<boolean>} whether a file was written
 */
export async function saveFile(name, blob) {
  const api = shell();
  if (!api) return false;
  try {
    const path = await api.dialog.save({ defaultPath: name });
    if (!path) return false;
    await api.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } catch (err) {
    console.warn('could not save', name, err);
    return false;
  }
}

/**
 * The version of the running app, e.g. `0.1.0`. Null on the web, where the
 * question has no answer: the page is whatever the host is serving.
 */
export async function desktopVersion() {
  const api = shell();
  if (!api) return null;
  try {
    return await api.app.getVersion();
  } catch {
    return null;
  }
}
