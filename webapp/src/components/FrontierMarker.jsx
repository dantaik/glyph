import { chainName, fmtRelTime, friendlyError } from '../lib/format';
import { t } from '../lib/i18n';
import { Hint } from './Text';
const ACTION =
  'underline-offset-4 hover:text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 transition-colors';

/**
 * Where a merged list stops being complete. Above it every chain has been
 * read; below it, the chains named here have not been read that far back
 * yet, so posts from them may be missing among the rows that follow. The
 * text says why, and what the action does: deepen those chains, or retry
 * the one that failed. A row of the list it sits in (an `li`).
 *
 * `frontier`: { ts, leaders: [{ chainId, state: 'covered'|'scanning'|'error'|'idle', error, exact }] }
 * `variant`: 'feed' (scans) or 'author' (walks).
 */
export default function FrontierMarker({ frontier, busy, onLoadMore, onRetry, variant = 'feed' }) {
  const names = frontier.leaders.map((l) => chainName(l.chainId)).join(t('frontier.join'));
  const states = new Set(frontier.leaders.map((l) => l.state));
  let text;
  let action = null;
  if (states.has('error')) {
    const failed = frontier.leaders.find((l) => l.state === 'error');
    text = t('frontier.readFailed', { names, reason: friendlyError(failed.error) });
    action = { label: t('common.retry'), onClick: onRetry };
  } else if (states.has('scanning') || states.has('idle')) {
    text =
      variant === 'author'
        ? t('frontier.authorScanning', { names })
        : t('frontier.feedScanning', { names });
  } else {
    const exact = frontier.leaders.every((l) => l.exact);
    const when = Number.isFinite(frontier.ts) ? fmtRelTime(new Date(frontier.ts * 1000), { exact }) : null;
    text =
      variant === 'author'
        ? t('frontier.authorIncomplete', { names })
        : t('frontier.feedIncomplete', { names, when: when ?? t('frontier.here') });
    action = {
      label: variant === 'author' ? t('frontier.continueReading') : t('frontier.continueScanning'),
      onClick: onLoadMore,
    };
  }
  return (
    <Hint as="li" nums className="py-3 text-center" data-frontier="">
      <span>{text}</span>
      {action && (
        <>
          <span className="select-none" aria-hidden="true"> · </span>
          <button type="button" onClick={action.onClick} disabled={busy} className={ACTION}>
            {action.label}
          </button>
        </>
      )}
    </Hint>
  );
}
