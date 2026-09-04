import { t } from '../lib/i18n';
import { Hint, Meta } from './Text';

/**
 * Text control that pages a list towards older posts. Shared by the home
 * feed and the author list so both read the same — a plain underlined line
 * of text rather than a button that competes with the titles above it.
 * `disabled` holds it while some other scan is running.
 */
export default function LoadMoreButton({
  onClick,
  loading,
  disabled = false,
  hasMore,
  label,
  loadingLabel,
  note,
}) {
  if (!hasMore) {
    return (
      <div className="mt-8 text-center">
        <Hint>{t('loadMore.noMore')}</Hint>
      </div>
    );
  }
  return (
    <div className="mt-8 text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="text-sm text-ink-soft underline-offset-4 transition-colors hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-soft disabled:hover:no-underline"
      >
        {loading ? (loadingLabel ?? t('loadMore.loading')) : (label ?? t('loadMore.label'))}
      </button>
      {note && !loading && <Meta className="mt-2">{note}</Meta>}
    </div>
  );
}
