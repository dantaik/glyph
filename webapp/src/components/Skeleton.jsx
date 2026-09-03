/**
 * Loading placeholders. `Bar` is the one shimmering block every skeleton
 * is built from; the named skeletons mirror the layouts they stand in for.
 */
export function Bar({ className = '' }) {
  return <div className={`animate-pulse rounded bg-paper-sunken ${className}`} />;
}

/** The home feed: a featured entry over a few rows. */
export function FeedSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="border-b border-edge pb-8">
        <Bar className="h-7 w-3/5" />
        <Bar className="mt-4 h-4 w-full" />
        <Bar className="mt-2 h-4 w-4/5" />
        <Bar className="mt-4 h-3 w-2/5" />
      </div>
      <ul className="divide-y divide-edge">
        {[0, 1, 2, 3].map((k) => (
          <li key={k} className="py-5">
            <Bar className="h-5 w-2/3" />
            <Bar className="mt-3 h-3 w-1/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An author's title list. */
export function ListSkeleton() {
  return (
    <ul className="divide-y divide-edge" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((k) => (
        <li key={k} className="flex items-baseline gap-4 py-4">
          <Bar className="h-3 w-8" />
          <Bar className="h-5 max-w-[60%] flex-1" />
          <Bar className="ml-auto h-3 w-16" />
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
