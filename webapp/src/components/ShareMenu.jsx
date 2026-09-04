import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../lib/clipboard';
import { useT } from '../lib/i18n';
import { hrefFor } from '../lib/router';
import { Share } from './Icons';

/** How tall an embedded letter is by default: enough for a short one, whole. */
const EMBED_HEIGHT = 640;

/**
 * The ways one post leaves this page: as a link, as an embed, or as a
 * reference inside another post.
 *
 * The last of those is the one the design cares about. A quotation written
 * as `[title](0x…)` goes on chain with the quoting post and stays resolvable
 * for as long as both transactions exist, which is the only kind of citation
 * this journal can honestly offer.
 */
export default function ShareMenu({ chainId, txHash, eventIndex = 0, title = '', onReply = null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const box = useRef(null);

  // A menu that stays open behind the reader's back is a menu in the way.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const path = hrefFor({ chain: chainId, tx: txHash, txEvent: eventIndex });
  const url = absolute(path);
  const embed = embedCode({ url, title });
  const reference = `[${title || t('common.untitled')}](${String(txHash).toLowerCase()}${
    eventIndex ? `/${eventIndex}` : ''
  })`;

  const copy = async (what, text) => {
    const ok = await copyToClipboard(text);
    setCopied(ok ? what : null);
    if (ok) setOpen(false);
  };

  const share = async () => {
    try {
      await navigator.share({ title: title || undefined, url });
      setOpen(false);
    } catch {
      /* dismissed, or the sheet refused — nothing to say */
    }
  };

  return (
    <span className="relative inline-flex" ref={box} data-share-menu="" data-noprint="">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('share.menu')}
        title={t('share.menu')}
        className="inline-flex items-center gap-1 hover:text-accent transition-colors"
      >
        <Share size={14} />
        <span>{copied ? t('share.copied') : t('share.label')}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded-xl border border-edge bg-paper-raised p-1 text-left shadow-lg"
        >
          <Item onClick={() => copy('link', url)}>{t('share.copyLink')}</Item>
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <Item onClick={share}>{t('share.share')}</Item>
          )}
          <Item onClick={() => copy('embed', embed)}>{t('share.copyEmbed')}</Item>
          <Item onClick={() => copy('ref', reference)}>{t('share.copyRef')}</Item>
          {onReply && (
            <Item
              onClick={() => {
                setOpen(false);
                onReply();
              }}
            >
              {t('relations.reply')}
            </Item>
          )}
        </div>
      )}
    </span>
  );
}

function Item({ onClick, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-paper-sunken hover:text-accent transition-colors"
    >
      {children}
    </button>
  );
}

/** A path as a URL somebody can paste somewhere else. */
function absolute(path) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * The iframe snippet for `?headless=1` — the post with no app around it.
 * `loading="lazy"` because an embedded letter is usually below the fold of
 * whatever page carries it.
 */
export function embedCode({ url, title = '', height = EMBED_HEIGHT }) {
  const separator = url.includes('?') ? '&' : '?';
  const safeTitle = String(title).replace(/"/g, '&quot;');
  return `<iframe src="${url}${separator}headless=1" title="${safeTitle}" width="100%" height="${height}" style="border:1px solid #e5e5e5;border-radius:12px" loading="lazy"></iframe>`;
}
