import { useEffect, useState } from 'react';
import { fmtTitle, fmtIndex, excerpt } from '../lib/format';
import { hrefFor } from '../lib/router';
import AuthorLink from './AuthorLink';
import PostMeta from './PostMeta';

export const EXCERPT_CHARS = 256;

/**
 * One article row in a reading list — shared by the home feed and the
 * author title list. Layout: title on the first line; author (left) +
 * chain/time meta (right) on the second. `showIndex` prepends 第 N 篇
 * for author views. Rows come from a merged view, so each carries the
 * chain it was read on; `currentChain` is the chain the list is filtered
 * to, if any, so that chain's chip reads as a label rather than a link.
 */
export default function ArticleListItem({ post, clock, navigate, currentChain = null, showIndex = false, loadBody }) {
  const target = { chain: post.chainId, tx: post.txHash, txEvent: post.eventIndex ?? 0 };
  // Content preview: the body is fetched cache-first (IndexedDB) and shown
  // as a short plain-text excerpt; silently degrades to title-only.
  const [teaser, setTeaser] = useState(null);
  useEffect(() => {
    if (!loadBody) return undefined;
    let cancelled = false;
    setTeaser(null);
    loadBody(post)
      .then((res) => {
        if (cancelled) return;
        setTeaser(excerpt(res?.body?.markdown, EXCERPT_CHARS) || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.txHash, post.chainId, loadBody]);
  return (
    <li className="py-4">
      <div className="flex items-baseline gap-3">
        <a
          href={hrefFor(target)}
          onClick={(e) => {
            e.preventDefault();
            navigate(target);
          }}
          className="flex-1 font-serif text-display sm:text-jumbo group-hover:text-accent transition-colors line-clamp-1"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </a>
      </div>
      {teaser && (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{teaser}</p>
      )}
      <div className="mt-1.5">
        <PostMeta
          block={post.block}
          ts={post.ts}
          clock={clock}
          chainId={post.chainId}
          currentChain={currentChain}
          navigate={navigate}
          prefix={showIndex ? fmtIndex(post.index) : undefined}
          lead={<AuthorLink author={post.author} navigate={navigate} />}
        />
      </div>
    </li>
  );
}
