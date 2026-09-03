import { GeeseMark, AlertCircle } from './Icons';

/**
 * Centered empty/error placeholder. Error states (tone=danger) show a
 * friendly summary plus the raw technical message in a collapsible
 * <details> block instead of dumping it into the layout.
 */
export default function EmptyState({ title, body, actionLabel, onAction, tone, detail }) {
  const danger = tone === 'danger';
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      {danger ? (
        <AlertCircle size={36} className="mx-auto text-danger" />
      ) : (
        <GeeseMark size={168} className="mx-auto text-ink-ghost/50" />
      )}
      <h2 className="mt-5 text-lg text-ink-soft">{title}</h2>
      {body && (
        <p className="mt-2 text-sm leading-relaxed text-ink-faint">{body}</p>
      )}
      {danger && detail && (
        <details className="mt-4 text-left">
          <summary className="cursor-pointer select-none text-xs text-ink-faint hover:text-accent transition-colors">
            技术细节
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-paper-sunken p-3 text-2xs leading-relaxed text-ink-faint whitespace-pre-wrap break-all">
            {detail}
          </pre>
        </details>
      )}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 rounded-full border border-edge-strong px-5 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
