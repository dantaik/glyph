import { GeeseMark, AlertCircle } from './Icons';

/** Centered empty/error placeholder: glyph mark, serif title, optional action pill */
export default function EmptyState({ title, body, actionLabel, onAction, tone }) {
  const danger = tone === 'danger';
  return (
    <div className="py-20 text-center max-w-sm mx-auto">
      {danger ? (
        <AlertCircle size={36} className="mx-auto text-danger" />
      ) : (
        <GeeseMark size={168} className="mx-auto text-ink-ghost/50" />
      )}
      <h2 className="mt-5 text-lg text-ink-soft">{title}</h2>
      {body && (
        <p className="mt-2 text-sm leading-relaxed text-ink-faint">{body}</p>
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
