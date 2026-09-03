/**
 * Reading-list page header: title on the left, optional subtitle on the
 * right, hairline divider below. Shared by the home feed and author pages.
 */
export default function ListHeader({ title, subtitle, titleAttr }) {
  return (
    <header className="mb-8 flex items-baseline justify-between border-b border-edge pb-3">
      <h2 className="font-serif text-xl font-semibold" title={titleAttr}>{title}</h2>
      {subtitle && <p className="text-xs text-ink-ghost">{subtitle}</p>}
    </header>
  );
}
