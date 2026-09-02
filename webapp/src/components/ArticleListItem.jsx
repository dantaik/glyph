import { fmtTitle, fmtIndex, shortAddr } from '../lib/format';
import PostMeta from './PostMeta';

/**
 * One article row in a reading list — shared by the home feed and the
 * author title list. Layout: title on the first line; author (left) +
 * chain/time meta (right) on the second. `showIndex` prepends 第 N 篇
 * for author views.
 */
export default function ArticleListItem({ post, clock, navigate, showIndex = false }) {
  return (
    <li className="py-4">
      <div className="flex items-baseline gap-3">
        <a
          href={`/tx/${post.txHash}`}
          onClick={(e) => {
            e.preventDefault();
            navigate({ tx: post.txHash });
          }}
          className="flex-1 font-serif text-lg leading-snug group-hover:text-accent transition-colors line-clamp-1"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </a>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <a
          href={`?author=${post.author}`}
          onClick={(e) => {
            e.preventDefault();
            navigate({ author: post.author });
          }}
          title={post.author}
          className="font-mono text-2xs text-ink-faint hover:text-accent transition-colors"
        >
          {shortAddr(post.author)}
        </a>
        <PostMeta
          block={post.block}
          clock={clock}
          prefix={showIndex ? fmtIndex(post.index) : undefined}
        />
      </div>
    </li>
  );
}
