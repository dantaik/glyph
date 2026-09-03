import { friendlyError } from '../lib/format';
import EmptyState from './EmptyState';

/**
 * A failed read, as a centered placeholder: the friendly hint up front,
 * the raw message behind 技术细节, and a retry. Shared by every reading
 * surface so they all fail the same way.
 */
export default function ErrorState({ error, onRetry, title = '加载失败' }) {
  return (
    <EmptyState
      tone="danger"
      title={title}
      body={friendlyError(error)}
      detail={error}
      actionLabel={onRetry ? '重试' : undefined}
      onAction={onRetry}
    />
  );
}
