import { ArrowLeft } from './Icons';
import { t } from '../lib/i18n';

/** The "← Back" control at the top of a secondary page. */
export default function BackButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-accent hover:bg-paper-sunken transition-colors"
    >
      <ArrowLeft size={16} />
      {label ?? t('common.back')}
    </button>
  );
}
