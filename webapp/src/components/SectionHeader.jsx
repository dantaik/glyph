/** Section header with an optional right-side slot — no number, no divider. */
export default function SectionHeader({ label, right }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium tracking-label text-ink-soft">{label}</h2>
      {right}
    </div>
  );
}
