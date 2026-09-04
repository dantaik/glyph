import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../lib/clipboard';
import { nextImageKeys } from '../lib/imageKeys';
import { t } from '../lib/i18n';
import { Check, AlertCircle, Close, Plus } from './Icons';
import { Micro } from './Text';


/**
 * Dropzone + thumbnail grid for draft images. The parent owns the `files`
 * map ({ key: File }); this component only renders and mutates via onChange.
 */
export default function ImageUploader({
  files,
  uploadRefs,
  usedKeys = [],
  onChange,
  disabled,
  previewUrls,
}) {
  // Attachments the body doesn't display are never uploaded, so say so on
  // the thumbnail instead of dropping them from the cost panel silently.
  const used = new Set(usedKeys);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const fileInputRef = useRef(null);
  const copyTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // Clicking a thumbnail (or its name) copies the Markdown reference
  // `![key](upload:key)` so it can be pasted straight into the editor.
  const copyRef = (key) => {
    copyToClipboard(`![${key}](upload:${key})`).then((ok) => {
      if (!ok) return;
      setCopiedKey(key);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
    });
  };

  const addFiles = (list) => {
    if (disabled) return;
    const incoming = [...list];
    const next = { ...files };
    // Keys are plain sequence numbers: img1, img2, … (not filenames).
    nextImageKeys(next, incoming.length).forEach((key, i) => {
      next[key] = incoming[i];
    });
    onChange(next);
  };

  const handleFileChange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const removeFile = (key) => {
    const next = { ...files };
    delete next[key];
    onChange(next);
  };

  return (
    <div>
      {uploadRefs.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {uploadRefs.map((key) => (
            <span
              key={key}
              className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-0.5 ${
                files[key]
                  ? 'bg-success-wash text-success'
                  : 'bg-accent-wash text-accent-strong'
              }`}
            >
              {files[key] ? <Check size={12} /> : <AlertCircle size={12} />}
              {key}
            </span>
          ))}
        </div>
      )}

      <Micro className="mt-2">
        {Object.keys(files).length > 0 ? t('image.hint') : t('image.pasteHint')}
      </Micro>

      <div className="mt-1.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
        {Object.entries(files).map(([key, file]) => (
          <div
            key={key}
            role="button"
            tabIndex={0}
            aria-label={t('image.copyRef', { key })}
            title={t('image.copyRefTitle')}
            onClick={() => copyRef(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyRef(key);
              }
            }}
            className="relative group cursor-pointer rounded-lg"
          >
            <img
              src={previewUrls[key]}
              alt={key}
              className="w-full h-24 object-cover rounded-lg border border-edge"
            />
            {copiedKey === key && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-ink/50">
                <span className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink">
                  {t('image.copied')}
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeFile(key);
              }}
              aria-label={t('image.remove', { key })}
              className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full
                           bg-paper-raised/90 text-ink-faint hover:text-danger shadow-sm
                           opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
            >
              <Close size={12} />
            </button>
            <Micro as="span" className="mt-0.5 block truncate">
              {key} · {(file.size / 1024).toFixed(0)}KB
              {!used.has(key) && <span className="text-ink-ghost">{t('image.unreferenced')}</span>}
            </Micro>
          </div>
        ))}

        {/* The add tile — same frame as an image, a big plus, and it always
            sits after the last loaded image. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={t('image.upload')}
          title={t('image.upload')}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length) {
              addFiles(e.dataTransfer.files);
            }
          }}
          className="group cursor-pointer rounded-lg"
        >
          <div
            className={`flex h-24 w-full items-center justify-center rounded-lg border transition-colors ${
              isDragging
                ? 'border-accent bg-accent-wash/50'
                : 'border-edge bg-paper-raised group-hover:border-accent'
            }`}
          >
            <Plus size={36} className="text-ink-ghost group-hover:text-accent transition-colors" />
          </div>
          <Micro as="span" className="mt-0.5 block text-center">
            {t('image.dropHint')}
          </Micro>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
