//! The desktop shell.
//!
//! Xueni is a single-page app with no server, so the macOS application is a
//! thin Tauri window around the same `webapp/dist` the website is built
//! from. Nothing about the journal lives here. The shell exists to fill the
//! two gaps a WKWebView leaves, and to be a window:
//!
//!   - **WebKit cannot encode WebP from a canvas.** It answers
//!     `canvas.toBlob('image/webp')` with PNG bytes under the type it was
//!     asked for, which would put a file on chain whose name lies about its
//!     contents. The `transcode_image` command below does the encoding with
//!     libwebp instead, and the web app calls it when it finds itself here.
//!   - **A WKWebView does not honour `<a download>`.** The dialog and fs
//!     plugins give the web app a native save panel instead.
//!
//! Two more pieces come from plugins rather than code: `opener` sends links
//! to other sites out to the default browser, and `window-state` remembers
//! where the window was and how big it was.
//!
//! The single-page routing rule — serve `index.html` for any path that is
//! not a bundled file, which `vercel.json` gives the website — needs nothing
//! here: Tauri's own asset resolver already falls back to `index.html` when
//! a request matches no bundled file, so ⌘R on `/taiko/tx/0x…/0` lands on
//! the post rather than an error page. `Cargo.lock` pins the version that
//! does it.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

/// The id of the one menu item that is ours rather than the system's.
const RELOAD_ID: &str = "reload";

/// Downscale `bytes` to `max_edge` and encode it as lossy WebP at `quality`
/// (0 to 100) — the desktop's stand-in for the canvas the web app uses.
///
/// The bytes cross the IPC boundary as a JSON array of numbers, which is
/// wasteful but simple, and happens once per image the writer attaches.
#[tauri::command]
fn transcode_image(bytes: Vec<u8>, max_edge: u32, quality: u8) -> Result<Vec<u8>, String> {
    xueni_transcode::transcode_image(&bytes, max_edge, quality)
}

/// The ordinary macOS menu bar, plus one item: ⌘R.
///
/// This is Tauri's own default menu written out, because the default has no
/// way to reload and a web app without a reload is a strange thing to sit
/// in front of. The items are in English only — the menu bar is drawn by
/// macOS before the interface language is known, and it is the one surface
/// of the app the reader's language choice does not reach.
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        ..Default::default()
    };
    let reload = MenuItem::with_id(app, RELOAD_ID, "Reload", true, Some("CmdOrCtrl+R"))?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                package.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &reload,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            if event.id() == RELOAD_ID {
                if let Some(window) = app.get_webview_window("main") {
                    // Reload rather than re-navigate: the URL is where the
                    // reader is, and the router reads it back on load.
                    let _ = window.eval("window.location.reload()");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![transcode_image])
        .run(tauri::generate_context!())
        .expect("the Xueni window could not be opened");
}
