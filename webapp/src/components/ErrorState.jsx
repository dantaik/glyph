import { friendlyError } from '../lib/format';
import { t } from '../lib/i18n';
import EmptyState from './EmptyState';

/**
 * A failed read, as a centered placeholder: the friendly hint up front,
 * the raw message behind "technical details", and a retry. Shared by every
 * reading surface so they all fail the same way.
 */
export default function ErrorState({ error, onRetry, title }) {
  return (
    <EmptyState
      tone="danger"
      title={title ?? t('common.loadFailed')}
      body={friendlyError(error)}
      detail={error}
      actionLabel={onRetry ? t('common.retry') : undefined}
      onAction={onRetry}
    />
  );
}
