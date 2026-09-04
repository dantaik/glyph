// drafts.js — what is being written, kept so it survives the tab.
//
// A draft used to live only in React state, which meant a reload, a mobile
// wallet sending the browser away and back, or a closed tab lost everything
// — including image references that had already been paid for on chain,
// which is real money gone. It is now written to IndexedDB (the `drafts`
// store, see cache.js) a moment after every change, and read back when the
// write tab opens.
//
// One draft per browser: this is a place to write a letter, not a queue.
// The record holds Files as Files — IndexedDB stores them by structured
// clone — so attached images survive a reload too, and the `upload:imgN`
// references in the body still resolve.

import { deleteRecord, readRecord, writeRecord } from './cache';
import { LANGS, translate } from './i18n';

const STORE = 'drafts';

/** The one draft. */
export const DRAFT_KEY = 'current';

/**
 * Store the draft. Values are cloned by IndexedDB, so `files` may hold real
 * File objects and `tags` a plain array.
 * @param {{ title: string, tags: string[], markdown: string, meta?: object, files?: Record<string, File> }} draft
 */
export function saveDraft(draft) {
  return writeRecord(STORE, DRAFT_KEY, {
    title: draft.title ?? '',
    tags: [...(draft.tags ?? [])],
    markdown: draft.markdown ?? '',
    meta: { ...(draft.meta ?? {}) },
    files: { ...(draft.files ?? {}) },
    updatedAt: Date.now(),
  });
}

/** The stored draft, or null. */
export function loadDraft() {
  return readRecord(STORE, DRAFT_KEY);
}

/** Forget the stored draft. */
export function clearDraft() {
  return deleteRecord(STORE, DRAFT_KEY);
}

/**
 * The starting body, in every language the interface speaks.
 *
 * The placeholder is a translated phrase, so a draft "still untouched" in
 * Chinese does not look untouched to an English reader. Comparing against
 * all of them keeps an untouched draft untouched whichever language it was
 * opened in — and stops the editor from offering to restore a letter nobody
 * has written yet.
 */
function placeholderBodies() {
  return LANGS.map((lang) => translate(lang, 'publish.placeholderBody'));
}

/**
 * Whether this draft is worth keeping. A blank form, or one still holding
 * only the placeholder body, is not: it is never saved, and a stored one is
 * never restored.
 */
export function isEmptyDraft(draft) {
  if (!draft) return true;
  const body = (draft.markdown ?? '').trim();
  const untouched = body === '' || placeholderBodies().some((p) => p.trim() === body);
  return (
    untouched &&
    (draft.title ?? '').trim() === '' &&
    (draft.tags ?? []).length === 0 &&
    Object.keys(draft.files ?? {}).length === 0 &&
    Object.values(draft.meta ?? {}).every((v) => String(v ?? '').trim() === '')
  );
}

// --- Starting a draft from somewhere else --------------------------------
//
// "Reply to this post" opens the write tab with a field already filled in.
// The patch is handed over in memory rather than through storage: it belongs
// to this navigation, not to the browser, and it must not survive a reload
// that the reader did not ask for.

let pending = null;

/** Ask the write tab to start from these fields (see Publisher). */
export function setPendingDraftPatch(patch) {
  pending = patch && Object.keys(patch).length > 0 ? { ...patch } : null;
}

/** Take the pending patch, if any. Reading it consumes it. */
export function takePendingDraftPatch() {
  const patch = pending;
  pending = null;
  return patch;
}
