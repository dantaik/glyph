// clipboard.js — copy text to the clipboard, wherever the page is running.
//
// The async Clipboard API needs a secure context and a user gesture; a page
// served over plain http, or an older browser, has neither. The hidden
// textarea + execCommand fallback still works there, so a copy button is
// never simply dead.

/**
 * Copy `text` to the clipboard.
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
