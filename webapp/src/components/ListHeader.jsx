import { Hint, Title } from './Text';

/**
 * Reading-list page header: title on the left, an optional subtitle on the
 * right and an optional control beside it, hairline divider below. Shared
 * by the home feed, the author page and the pages that find things.
 */
export default function ListHeader({ title, subtitle, titleAttr, right }) {
  return (
    <header className="mb-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-edge pb-3">
      <Title title={titleAttr}>{title}</Title>
      <div className="flex items-center gap-3">
        {subtitle && <Hint>{subtitle}</Hint>}
        {right}
      </div>
    </header>
  );
}
