// offline.js — the downloadable single-file copy of the app.
//
// `vite build --mode offline` inlines everything (JS, CSS, the brotli WASM)
// into one HTML file and the hosted build serves it as /glyph.html. Saved to
// disk it keeps working after the domain stops resolving: the reader talks
// straight to the RPC endpoints, which is the only network it ever needed.
//
// Two different questions, so two flags: which BUILD this is, and whether the
// page is being read off disk right now.

/** True inside the single-file build. Its own download links are pointless. */
export const IS_OFFLINE_BUILD = __GLYPH_OFFLINE_BUILD__;

/** The name the hosted build serves the offline copy under. */
export const OFFLINE_FILE = __GLYPH_OFFLINE_FILE__;

/**
 * True when the page was opened from disk (file://) rather than served.
 * Not the same as IS_OFFLINE_BUILD: the offline file can also be served over
 * http, and only the file:// case has to route through the fragment, live
 * without IndexedDB, and explain the wallet's file-URL permission.
 */
export const FROM_FILE = typeof window !== 'undefined' && window.location.protocol === 'file:';
