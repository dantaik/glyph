import { useEffect, useRef } from 'react';
import { useT } from '../lib/i18n';
import { Close } from './Icons';

/**
 * An image from an article, at the size it was stored.
 *
 * Images here are paid for by the byte, so an author who spent the gas on a
 * large one meant it to be looked at. In the column the image is fitted to
 * the measure; this shows what is actually on chain.
 *
 * A native `<dialog>` rather than a div: the browser already knows how to
 * trap focus, close on Escape, and put it above everything. The src is the
 * same blob URL the article is using, so nothing is fetched again.
 */
export default function Lightbox({ src, alt = '', onClose }) {
  const t = useT();
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !src) return undefined;
    if (!dialog.open) dialog.showModal?.();
    const onCancel = (e) => {
      e.preventDefault(); // Escape closes through our own handler, once
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close?.();
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <dialog
      ref={ref}
      data-lightbox=""
      data-noprint=""
      aria-label={alt || t('lightbox.image')}
      onClick={(e) => {
        // The backdrop is the dialog itself: a click that misses the figure
        // is a click outside the picture.
        if (e.target === ref.current) onClose();
      }}
      className="max-h-[100dvh] max-w-[100vw] bg-transparent p-0 backdrop:bg-black/80"
    >
      <figure className="m-0 flex h-[100dvh] w-[100vw] flex-col items-center justify-center gap-3 p-4">
        <img
          src={src}
          alt={alt}
          className="max-h-[85dvh] max-w-full object-contain"
        />
        {alt && (
          <figcaption className="max-w-2xl text-center text-sm text-white/70">{alt}</figcaption>
        )}
      </figure>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('lightbox.close')}
        className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white/80 hover:text-white transition-colors"
      >
        <Close size={20} />
      </button>
    </dialog>
  );
}
