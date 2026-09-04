import { useEffect, useState } from 'react';
import { fmtTitle, fmtIndex, excerpt } from '../lib/format';
import { t } from '../lib/i18n';
import { ArticleTitle, Body } from './Text';
import { hrefFor } from '../lib/router';
import AuthorLink from './AuthorLink';
import PostMeta from './PostMeta';

export const EXCERPT_CHARS = 256;

/** Tags shown on a row before the rest are left to the post page. */
export const ROW_TAGS = 3;

/**
 * One article row in a reading list — shared by the home feed and the
 * author title list. Layout: title on the first line; author (left) +
 * chain/time meta (right) on the second. `showIndex` prepends the post's
 * ordinal for author views. Rows come from a merged view, so each carries the
 * chain it was read on; `currentChain` is the chain the list is filtered
 * to, if any, so that chain's chip reads as a label rather than a link.
 */
export default function ArticleListItem({ post, clock, navigate, currentChain = null, showIndex = false, loadBody }) {
  const target = { chain: post.chainId, tx: post.txHash, txEvent: post.eventIndex ?? 0 };
  // Content preview: the body is fetched cache-first (IndexedDB) and shown
  // as a short plain-text excerpt; silently degrades to title-only.
  const [teaser, setTeaser] = useState(null);
  const [tags, setTags] = useState([]);
  useEffect(() => {
    if (!loadBody) return undefined;
    let cancelled = false;
    setTeaser(null);
    setTags([]);
    loadBody(post)
      .then((res) => {
        if (cancelled) return;
        setTeaser(excerpt(res?.body?.markdown, EXCERPT_CHARS) || null);
        // The row already has the body; showing its tags costs nothing and
        // gives the reader somewhere to go sideways.
        setTags((res?.body?.tags ?? []).slice(0, ROW_TAGS));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.txHash, post.chainId, loadBody]);
  return (
    <li className="py-4">
      <div className="flex items-baseline gap-3">
        <ArticleTitle
          as="a"
          href={hrefFor(target)}
          onClick={(e) => {
            e.preventDefault();
            navigate(target);
          }}
          className="line-clamp-1 flex-1 transition-colors group-hover:text-accent"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">{t('common.untitled')}</span>}
        </ArticleTitle>
      </div>
      {teaser && (
        <Body className="mt-2 leading-relaxed">{teaser}</Body>
      )}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <a
              key={tag}
              href={hrefFor({ tag })}
              onClick={(e) => {
                e.preventDefault();
                navigate({ tag });
              }}
              className="rounded-md border border-edge bg-paper-sunken px-2 py-0.5 text-2xs text-ink-faint hover:border-accent hover:text-accent transition-colors"
            >
              {tag}
            </a>
          ))}
        </div>
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
