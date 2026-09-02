import { useFontSize } from '../lib/theme';

const SIZES = [
  ['s', '小'],
  ['m', '中'],
  ['l', '大'],
];

/** Segmented 小/中/大 pills controlling the article font size */
export default function FontSizeControl() {
  const { size, setSize } = useFontSize();
  return (
    <div
      role="group"
      aria-label="正文字号"
      className="inline-flex rounded-full border border-edge p-0.5 gap-0.5"
    >
      {SIZES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setSize(value)}
          aria-pressed={size === value}
          className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
            size === value
              ? 'bg-paper-sunken text-ink font-medium'
              : 'text-ink-faint hover:text-accent'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
