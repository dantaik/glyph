import { ArrowLeft } from './Icons';
import { t } from '../lib/i18n';
import { BTN_QUIET } from './formStyles';

/** The "← Back" control at the top of a secondary page. */
export default function BackButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-noprint=""
      className={`-ml-3 inline-flex items-center gap-1.5 ${BTN_QUIET}`}
    >
      <ArrowLeft size={16} />
      {label ?? t('common.back')}
    </button>
  );
}
