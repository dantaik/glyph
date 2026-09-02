import { fmtTitle, fmtIndex } from '../lib/format';
import PostMeta from './PostMeta';

/**
 * One article row in a reading list — shared by the home feed and the
 * author title list. `showIndex` prepends 第 N 篇 for author views.
 */
export default function ArticleListItem({ post, clock, navigate, showIndex = false, chainBadge = true }) {
  return (
    <li>
      <a
        href={`?author=${post.author}&i=${post.index}`}
        onClick={(e) => {
          e.preventDefault();
          navigate({ author: post.author, i: String(post.index) });
        }}
        className="group flex items-baseline gap-4 py-4"
      >
        <span className="flex-1 font-serif text-lg leading-snug group-hover:text-accent transition-colors line-clamp-2">
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </span>
        <PostMeta
          block={post.block}
          clock={clock}
          prefix={showIndex ? fmtIndex(post.index) : undefined}
          className="whitespace-nowrap"
          chainBadge={chainBadge}
        />
      </a>
    </li>
  );
}
