import { Label } from './Text';

/** Section header with an optional right-side slot — no number, no divider. */
export default function SectionHeader({ label, right }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <Label>{label}</Label>
      {right}
    </div>
  );
}
