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
      {body?.tags?.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {body.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent-wash px-2.5 py-0.5 text-xs text-accent-strong"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <h3>
        <a
          href={`/tx/${post.txHash}`}
          onClick={(e) => {
            e.preventDefault();
            navigate({ tx: post.txHash });
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
