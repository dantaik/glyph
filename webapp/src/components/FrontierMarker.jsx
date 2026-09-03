import { chainName } from '../lib/chains';
import { fmtRelTime, friendlyError } from '../lib/format';

const LINE = 'py-3 text-center text-xs tabular-nums text-ink-ghost';
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
  const names = frontier.leaders.map((l) => chainName(l.chainId)).join('与');
  const states = new Set(frontier.leaders.map((l) => l.state));
  let text;
  let action = null;
  if (states.has('error')) {
    const failed = frontier.leaders.find((l) => l.state === 'error');
    text = `${names} 读取失败：${friendlyError(failed.error)}`;
    action = { label: '重试', onClick: onRetry };
  } else if (states.has('scanning') || states.has('idle')) {
    text =
      variant === 'author'
        ? `正在读取${names}上的文章，以下暂未包含${names}的文章`
        : `${names} 正在进行第一次扫描，以下暂未包含${names}的文章`;
  } else {
    const exact = frontier.leaders.every((l) => l.exact);
    const when = Number.isFinite(frontier.ts) ? fmtRelTime(new Date(frontier.ts * 1000), { exact }) : null;
    text =
      variant === 'author'
        ? `${names}上更早的文章尚未读取`
        : `以下文章可能不完整：${names} 只扫描到${when ? ` ${when}` : '这里'}`;
    action = { label: variant === 'author' ? '继续读取' : '继续扫描', onClick: onLoadMore };
  }
  return (
    <li className={LINE} data-frontier="">
      <span>{text}</span>
      {action && (
        <>
          <span className="select-none" aria-hidden="true"> · </span>
          <button type="button" onClick={action.onClick} disabled={busy} className={ACTION}>
            {action.label}
          </button>
        </>
      )}
    </li>
  );
}
