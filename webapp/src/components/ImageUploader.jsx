import { useEffect, useRef, useState } from 'react';
import { Check, AlertCircle, Close } from './Icons';

/**
 * Copy text to the clipboard. Secure contexts use the async Clipboard API;
 * falls back to a hidden textarea + execCommand for everything else.
 * @returns {Promise<boolean>} whether the copy succeeded
 */
async function copyToClipboard(text) {
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


/**
 * Dropzone + thumbnail grid for draft images. The parent owns the `files`
 * map ({ key: File }); this component only renders and mutates via onChange.
 */
export default function ImageUploader({ files, uploadRefs, onChange, disabled, previewUrls }) {
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
    const next = { ...files };
    // Keys are plain sequence numbers: img1, img2, … (not filenames).
    for (const f of list) {
      let n = 1;
      while (next[`img${n}`]) n += 1;
      next[`img${n}`] = f;
    }
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

      <div
        role="button"
        tabIndex={0}
        aria-label="上传图片"
        className={`rounded-xl border-2 border-dashed p-7 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-accent bg-accent-wash/50'
            : 'border-edge-strong bg-paper-raised hover:border-accent'
        }`}
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
      >
        <p className="text-sm text-ink-faint">拖入图片或点击上传</p>
        <p className="text-xs text-ink-ghost mt-1">
          自动转换为 WebP q60，最大长边 1600px
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {Object.keys(files).length > 0 && (
        <>
          <p className="mt-2 text-2xs text-ink-ghost">
            图片自动编号 img1、img2…；点击图片或名称，复制引用并粘贴到正文
          </p>
          <div className="mt-1.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Object.entries(files).map(([key, file]) => (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`复制引用 ${key}`}
              title="点击复制引用"
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
                    已复制引用
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(key);
                }}
                aria-label={`移除图片 ${key}`}
                className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full
                             bg-paper-raised/90 text-ink-faint hover:text-danger shadow-sm
                             opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
              >
                <Close size={12} />
              </button>
              <span className="block text-2xs text-ink-faint mt-0.5 truncate">
                {key} · {(file.size / 1024).toFixed(0)}KB
              </span>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
