import { useEffect, useState } from 'react';
import { loadPostBody } from '../lib/data';
import { fmtTitle, excerpt } from '../lib/format';
import PostMeta from './PostMeta';

/**
 * Large card for the most recent post — shared by the home feed and the
 * author page. Fetches tags + a short excerpt from the post body
 * (silently degrades to title-only).
 */
export default function FeaturedPost({ post, clock, navigate, excerptChars = 80 }) {
  const [body, setBody] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    loadPostBody(post.txHash)
      .then((res) => !cancelled && setBody(res.body))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.txHash]);

  const teaser = body ? excerpt(body.markdown, excerptChars) : '';

  return (
    <article className="border-b border-edge pb-8">
      <h3>
        <a
          href={`/tx/${post.txHash}/${post.eventIndex ?? 0}`}
          onClick={(e) => {
            e.preventDefault();
            navigate({ tx: post.txHash, txEvent: post.eventIndex ?? 0 });
          }}
          className="font-serif text-xl leading-[1.4] font-bold sm:text-2xl hover:text-accent transition-colors"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </a>
      </h3>
      {teaser && (
        <p className="mt-2 font-serif text-base leading-relaxed text-ink-soft line-clamp-2">
          {teaser}
        </p>
      )}
      <PostMeta block={post.block} clock={clock} className="mt-3" />
    </article>
  );
}
