/**
 * Loading placeholders. `Bar` is the one shimmering block every skeleton
 * is built from; the named skeletons mirror the layouts they stand in for.
 */
export function Bar({ className = '' }) {
  return <div className={`animate-pulse rounded bg-paper-sunken ${className}`} />;
}

/** A reading list — the home feed or an author's: rows of a title over a meta line (ArticleListItem). */
export function ListSkeleton() {
  return (
    <ul className="divide-y divide-edge" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((k) => (
        <li key={k} className="py-4">
          <Bar className="h-5 w-2/3" />
          <Bar className="mt-3 h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

const ARTICLE_GROUPS = [
  ['w-full', 'w-11/12', 'w-full', 'w-3/5'],
  ['w-full', 'w-10/12', 'w-full', 'w-2/3'],
];

/** An article body: two paragraphs of lines. */
export function ArticleSkeleton() {
  return (
    <div className="article-column space-y-9" aria-hidden="true">
      {ARTICLE_GROUPS.map((widths, g) => (
        <div key={g} className="space-y-4">
          {widths.map((w, i) => (
            <Bar key={i} className={`h-4 ${w}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
