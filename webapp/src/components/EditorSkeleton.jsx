/** Placeholder shown while the CodeMirror chunk lazy-loads. */
export default function EditorSkeleton({ height }) {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 gap-3"
      style={{ height }}
    >
      <div className="animate-pulse rounded-xl border border-edge bg-paper-raised" />
    </div>
  );
}
