import { Hint, Title } from './Text';

/**
 * Reading-list page header: title on the left, optional subtitle on the
 * right, hairline divider below. Shared by the home feed and author pages.
 */
export default function ListHeader({ title, subtitle, titleAttr }) {
  return (
    <header className="mb-8 flex items-baseline justify-between border-b border-edge pb-3">
      <Title title={titleAttr}>{title}</Title>
      {subtitle && <Hint>{subtitle}</Hint>}
    </header>
  );
}
