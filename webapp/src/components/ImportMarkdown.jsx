import { useRef, useState } from 'react';
import { importMarkdown } from '../lib/markdownImport';
import { useT } from '../lib/i18n';
import { BTN_QUIET } from './formStyles';
import { Meta } from './Text';

/**
 * Bring a `.md` file in as the draft — the other half of downloading a post
 * as the text the chain holds. Front-matter this version knows fills the
 * fields; anything else is named rather than silently carried.
 *
 * Props: { onImport(fields), confirmReplace, disabled }
 * `confirmReplace` is asked before overwriting a draft that has something in
 * it; the caller decides what "something" means.
 */
export default function ImportMarkdown({ onImport, confirmReplace = false, disabled = false }) {
  const t = useT();
  const inputRef = useRef(null);
  const [notice, setNotice] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
    if (!file) return;
    setNotice(null);
    if (confirmReplace && !window.confirm(t('export.importReplace'))) return;
    const fields = importMarkdown(await file.text(), { fileName: file.name });
    onImport(fields);
    setNotice(
      fields.dropped.length > 0
        ? t('export.importDropped', { keys: fields.dropped.join(', ') })
        : t('export.imported', { name: file.name }),
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={BTN_QUIET}
      >
        {t('export.import')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={pick}
        aria-label={t('export.pickMarkdown')}
        className="hidden"
      />
      {notice && (
        <Meta as="p" role="status" className="mt-2 basis-full">
          {notice}
        </Meta>
      )}
    </>
  );
}
