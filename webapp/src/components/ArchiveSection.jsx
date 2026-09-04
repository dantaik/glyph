import { useEffect, useRef, useState } from 'react';
import {
  applyArchive,
  archiveFileName,
  collectBrowserArchive,
  parseArchive,
  serializeArchive,
} from '../lib/archive';
import { downloadText } from '../lib/download';
import { useView } from '../lib/view';
import { useT } from '../lib/i18n';
import { Download } from './Icons';
import SectionHeader from './SectionHeader';
import { Body, Note } from './Text';
import { BTN_OUTLINE, BTN_PRIMARY, BTN_QUIET } from './formStyles';

/**
 * The archive, on the settings page: everything this browser has read, out
 * as one file and back in.
 *
 * The export is the interesting direction. What a reader has read is the
 * only copy of this journal they control, and until it is a file it is a
 * browser profile that a cleared cache takes away.
 */
export default function ArchiveSection() {
  const t = useT();
  const view = useView();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null); // { done, total }
  const [review, setReview] = useState(null); // { name, doc, problems, summary }
  const [notice, setNotice] = useState(null);

  // How much there is to export, so the button can say so before it is used.
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    setCounts(view.readers.reduce((n, r) => n + r.store.allPosts().length, 0));
  }, [view]);

  const exportAll = async () => {
    setNotice(null);
    setBusy({ done: 0, total: counts ?? 0 });
    try {
      const doc = await collectBrowserArchive(view.readers, { onProgress: setBusy });
      const name = archiveFileName(doc.scope);
      downloadText(name, serializeArchive(doc), 'application/json');
      setNotice(t('archive.counts', { posts: doc.posts.length, images: doc.images.length }));
    } catch (err) {
      setNotice(t('archive.failed', { reason: err?.message ?? String(err) }));
    } finally {
      setBusy(null);
    }
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReview({ name: file.name, ...parseArchive(String(reader.result)) });
    reader.onerror = () =>
      setReview({ name: file.name, doc: null, problems: [t('archive.failed', { reason: file.name })], summary: [] });
    setNotice(null);
    reader.readAsText(file);
  };

  const apply = async () => {
    const doc = review.doc;
    setReview(null);
    setBusy({ done: 0, total: doc.posts.length });
    try {
      const result = await applyArchive(doc, view.readers);
      setCounts(view.readers.reduce((n, r) => n + r.store.allPosts().length, 0));
      setNotice(t('archive.applied', result));
    } catch (err) {
      setNotice(t('archive.failed', { reason: err?.message ?? String(err) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-10" data-archive-section="">
      <SectionHeader label={t('archive.heading')} />
      <Note className="max-w-2xl">{t('archive.note')}</Note>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={exportAll}
          disabled={busy != null || counts === 0}
          className={BTN_OUTLINE}
        >
          <Download size={16} />
          {t('archive.exportBrowser')}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy != null}
          className={BTN_OUTLINE}
        >
          {t('archive.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={pick}
          aria-label={t('archive.pickFile')}
          className="hidden"
        />
        {counts === 0 && <Note>{t('archive.nothingRead')}</Note>}
      </div>

      {busy && (
        <p role="status" className="mt-3 text-xs text-ink-faint">
          {t('archive.exporting', { done: busy.done ?? 0, total: busy.total ?? 0 })}
        </p>
      )}

      {review && (
        <div className="mt-4 rounded-lg border border-edge bg-paper-raised px-4 py-3" data-archive-review="">
          <Body>{t('backup.reviewFrom', { name: review.name })}</Body>
          {review.summary.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-soft">
              {review.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {review.problems.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-danger">
              {review.problems.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            {review.doc && review.doc.posts.length > 0 && (
              <button type="button" onClick={apply} className={BTN_PRIMARY}>
                {t('common.apply')}
              </button>
            )}
            <button type="button" onClick={() => setReview(null)} className={BTN_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {notice && !busy && (
        <p role="status" className="mt-3 text-xs text-success">
          {notice}
        </p>
      )}
    </section>
  );
}
