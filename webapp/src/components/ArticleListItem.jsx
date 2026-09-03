import { fmtTitle, fmtIndex } from '../lib/format';
import { hrefFor } from '../lib/router';
import AddressLabel from './Address';
import PostMeta from './PostMeta';

/**
 * One article row in a reading list — shared by the home feed and the
 * author title list. Layout: title on the first line; author (left) +
 * chain/time meta (right) on the second. `showIndex` prepends 第 N 篇
 * for author views. Rows come from a merged view, so each carries the
 * chain it was read on; `currentChain` is the chain the list is filtered
 * to, if any, so that chain's chip reads as a label rather than a link.
 */
export default function ArticleListItem({ post, clock, navigate, currentChain = null, showIndex = false }) {
  const target = { chain: post.chainId, tx: post.txHash, txEvent: post.eventIndex ?? 0 };
  return (
    <li className="py-4">
      <div className="flex items-baseline gap-3">
        <a
          href={hrefFor(target)}
          onClick={(e) => {
            e.preventDefault();
            navigate(target);
          }}
          className="flex-1 font-serif text-lg leading-snug group-hover:text-accent transition-colors line-clamp-1"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </a>
      </div>
      <div className="mt-1.5">
        <PostMeta
          block={post.block}
          ts={post.ts}
          clock={clock}
          chainId={post.chainId}
          currentChain={currentChain}
          navigate={navigate}
          prefix={showIndex ? fmtIndex(post.index) : undefined}
          lead={
            <a
              href={hrefFor({ author: post.author })}
              onClick={(e) => {
                e.preventDefault();
                navigate({ author: post.author });
              }}
              title={post.author}
              className="inline-flex items-center text-ink-faint hover:text-accent transition-colors"
            >
              <AddressLabel address={post.author} size={14} tailClassName="text-2xs" />
            </a>
          }
        />
      </div>
    </li>
  );
}
