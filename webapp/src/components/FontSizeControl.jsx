import { useT } from '../lib/i18n';
import { useFontSize } from '../lib/theme';

const SIZES = ['s', 'm', 'l'];

/** Segmented small/medium/large pills controlling the article font size */
export default function FontSizeControl() {
  const { size, setSize } = useFontSize();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('fontSize.label')}
      className="inline-flex rounded-full border border-edge p-0.5 gap-0.5"
    >
      {SIZES.map((value) => (
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
          {t(`fontSize.${value}`)}
        </button>
      ))}
    </div>
  );
}
