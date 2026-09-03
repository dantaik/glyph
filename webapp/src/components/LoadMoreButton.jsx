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
  label = '加载更早的文章',
  loadingLabel = '正在加载…',
  note,
}) {
  if (!hasMore) {
    return (
      <div className="mt-8 text-center">
        <p className="text-xs text-ink-ghost">没有更多文章</p>
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
        {loading ? loadingLabel : label}
      </button>
      {note && !loading && <p className="mt-2 text-xs text-ink-ghost">{note}</p>}
    </div>
  );
}
