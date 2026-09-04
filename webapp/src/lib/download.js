// download.js — hand the reader a file.
//
// One place, because there are now several: the settings export, a post as
// the `.md` the chain holds, and an archive bundle. All of them are bytes the
// browser already has, so none of them needs a server: a Blob, an object URL
// and a click on an anchor nobody sees.
//
// The desktop app is the exception: a WKWebView has no download manager, so
// the anchor click does nothing there and the shell opens a native save
// panel instead (platform.js).

import { isDesktop, saveFile } from './platform';

/** Save `blob` as `name`. */
export function downloadBlob(name, blob) {
  if (isDesktop()) {
    // Nothing to await: the panel is the reader's to answer, and every
    // caller here is a click handler that has already finished.
    saveFile(name, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a delay: revoking it immediately can beat the download in
  // some browsers, and an object URL costs nothing for a second.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save `text` as `name`, with `mime` describing what it is. */
export function downloadText(name, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(name, new Blob([text], { type: mime }));
}

/**
 * A file name for a post: the day it was mined and a readable form of its
 * title, e.g. `2026-09-04-a-letter-before-the-solstice.md`.
 *
 * The slug keeps letters and digits in any script — a Chinese title stays
 * Chinese rather than becoming a row of dashes — and falls back to the short
 * transaction hash when a post has no title at all.
 */
export function postFileName({ title, ts, txHash, extension = 'md' }) {
  const date = ts != null ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : null;
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const name = slug || String(txHash ?? '').slice(0, 10) || 'post';
  return `${date ? `${date}-` : ''}${name}.${extension}`;
}
