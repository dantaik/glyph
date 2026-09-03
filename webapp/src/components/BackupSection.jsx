import { useRef, useState } from 'react';
import { applySettings, parseSettingsFile, serializeSettings, settingsFileName } from '../lib/settingsFile';
import { Download } from './Icons';
import Note from './Note';
import SectionHeader from './SectionHeader';
import { BTN_OUTLINE, BTN_PRIMARY, BTN_QUIET } from './formStyles';

/**
 * 备份与恢复 — the settings as one file, out and back in. Export hands the
 * browser a JSON file (a Blob, so it works off a file:// page too); import
 * reads one, shows what it would change and what is wrong with it, and
 * applies only on 应用 — through the same setters the page uses, so the
 * lists above, the theme and the rest change at once.
 */
export default function BackupSection() {
  const fileRef = useRef(null);
  const [review, setReview] = useState(null); // { name, settings, problems, summary }
  const [notice, setNotice] = useState(null);

  const exportFile = () => {
    const name = settingsFileName();
    const blob = new Blob([serializeSettings()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setReview(null);
    setNotice(`已导出 ${name}`);
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReview({ name: file.name, ...parseSettingsFile(String(reader.result)) });
    reader.onerror = () => setReview({ name: file.name, settings: {}, problems: ['无法读取这个文件。'], summary: [] });
    setNotice(null);
    reader.readAsText(file);
  };

  const apply = () => {
    applySettings(review.settings);
    setNotice(`已应用 ${review.name} 里的设置`);
    setReview(null);
  };

  return (
    <section className="mb-10">
      <SectionHeader label="备份与恢复" />
      <Note>
        把这一页的全部设置——各链的节点列表、扫描延迟、发布目标、主题、正文字号、控制台日志——存成一个 JSON 文件，
        换浏览器、换电脑或打开离线版时再导入。导入前会先列出将要改动的项目，确认后才生效，无需刷新。
      </Note>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportFile} className={BTN_OUTLINE}>
          <Download size={16} />
          导出设置
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className={BTN_OUTLINE}>
          导入设置…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={pick}
          aria-label="选择设置文件"
          className="hidden"
        />
      </div>

      {review && (
        <div className="mt-4 rounded-lg border border-edge bg-paper-raised px-4 py-3" data-settings-review="">
          <p className="text-sm text-ink-soft">
            来自 <span className="font-mono text-xs">{review.name}</span>
            {review.summary.length ? '，应用后将：' : '：'}
          </p>
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
                应用
              </button>
            )}
            <button type="button" onClick={() => setReview(null)} className={BTN_QUIET}>
              取消
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
