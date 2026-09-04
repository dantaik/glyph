import { useRef, useState } from 'react';
import { t as translateNow, useT } from '../lib/i18n';
import { downloadText } from '../lib/download';
import { applySettings, parseSettingsFile, serializeSettings, settingsFileName } from '../lib/settingsFile';
import { Download } from './Icons';
import SectionHeader from './SectionHeader';
import { Body, Note } from './Text';
import { BTN_OUTLINE, BTN_PRIMARY, BTN_QUIET } from './formStyles';

/**
 * Backup and restore — the settings as one file, out and back in. Export
 * hands the browser a JSON file (a Blob, so it works off a file:// page
 * too); import reads one, shows what it would change and what is wrong
 * with it, and applies only on confirmation — through the same setters the
 * page uses, so the lists above, the language, the theme and the rest
 * change at once.
 */
export default function BackupSection() {
  const t = useT();
  const fileRef = useRef(null);
  const [review, setReview] = useState(null); // { name, settings, problems, summary }
  const [notice, setNotice] = useState(null);

  const exportFile = () => {
    const name = settingsFileName();
    downloadText(name, serializeSettings(), 'application/json');
    setReview(null);
    setNotice(t('backup.exported', { name }));
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReview({ name: file.name, ...parseSettingsFile(String(reader.result)) });
    reader.onerror = () =>
      setReview({ name: file.name, settings: {}, problems: [t('backup.unreadable')], summary: [] });
    setNotice(null);
    reader.readAsText(file);
  };

  const apply = () => {
    const { name } = review;
    applySettings(review.settings);
    // Read after applying, not through this render's `t`: a file that set
    // the language should have its own confirmation in that language.
    setNotice(translateNow('backup.applied', { name }));
    setReview(null);
  };

  return (
    <section className="mb-10">
      <SectionHeader label={t('backup.heading')} />
      <Note>{t('backup.note')}</Note>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportFile} className={BTN_OUTLINE}>
          <Download size={16} />
          {t('backup.export')}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className={BTN_OUTLINE}>
          {t('backup.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={pick}
          aria-label={t('backup.pickFile')}
          className="hidden"
        />
      </div>

      {review && (
        <div className="mt-4 rounded-lg border border-edge bg-paper-raised px-4 py-3" data-settings-review="">
          <Body>
            {t('backup.reviewFrom', { name: review.name })}
            {review.summary.length ? t('backup.reviewWill') : t('backup.reviewColon')}
          </Body>
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
            {review.summary.length > 0 && (
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

      {notice && (
        <p role="status" className="mt-3 text-xs text-success">
          {notice}
        </p>
      )}
    </section>
  );
}
