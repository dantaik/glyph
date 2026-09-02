import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, AlertCircle, Close } from './Icons';

/** Sanitize a filename into an upload:KEY — ASCII alnum, `_`, `-`, CJK. */
function toKey(name) {
  return (
    name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '') ||
    'img'
  );
}

/**
 * Dropzone + thumbnail grid for draft images. The parent owns the `files`
 * map ({ key: File }); this component only renders and mutates via onChange.
 */
export default function ImageUploader({ files, uploadRefs, onChange, disabled }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Stable preview URLs, revoked when the set changes or on unmount.
  const filePreviews = useMemo(() => {
    const map = {};
    for (const [key, file] of Object.entries(files)) {
      map[key] = URL.createObjectURL(file);
    }
    return map;
  }, [files]);
  useEffect(
    () => () =>
      Object.values(filePreviews).forEach((url) => URL.revokeObjectURL(url)),
    [filePreviews],
  );

  const addFiles = (list) => {
    if (disabled) return;
    const next = { ...files };
    for (const f of list) {
      const base = toKey(f.name);
      let key = base;
      let suffix = 2;
      while (next[key]) key = `${base}-${suffix++}`;
      next[key] = f;
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
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {Object.entries(files).map(([key, file]) => (
            <div key={key} className="relative group">
              <img
                src={filePreviews[key]}
                alt={key}
                className="w-full h-24 object-cover rounded-lg border border-edge"
              />
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
              <span className="block text-[10px] text-ink-faint mt-0.5 truncate">
                {key} · {(file.size / 1024).toFixed(0)}KB
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
