/**
 * Explanatory text beside a control — one size and one colour everywhere,
 * so a settings page reads as one page. The colour is `ink-faint` (5:1,
 * AA), not `ink-ghost`: that one is decorative and too light to read a
 * sentence in.
 */
export default function Note({ as: Tag = 'p', className = '', children }) {
  return <Tag className={`text-xs leading-relaxed text-ink-faint ${className}`}>{children}</Tag>;
}
