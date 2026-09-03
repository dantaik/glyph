import { useAsync } from '../lib/hooks';
import { fmtTitle, fmtIndex, excerpt } from '../lib/format';
import { hrefFor } from '../lib/router';
import AuthorLink from './AuthorLink';
import PostMeta from './PostMeta';

/**
 * Large card for the most recent post — shared by the home feed and the
 * author page. Fetches a short excerpt from the post body through the
 * view (silently degrades to title-only). The post carries the chain it
 * was read on; the body comes from that chain's reader. The meta line is
 * the rows' (ArticleListItem): author · chain · [第 N 篇] · time, so the
 * first entry of a list reads like the rest; `showIndex` adds 第 N 篇 for
 * author views.
 */
export default function FeaturedPost({
  view,
  post,
  clock,
  navigate,
  currentChain = null,
  showIndex = false,
  excerptChars = 80,
}) {
  const body = useAsync(() => view.loadPostBody(post), [view, post.chainId, post.txHash]);
  const teaser = body.value?.body?.markdown ? excerpt(body.value.body.markdown, excerptChars) : null;
  const target = { chain: post.chainId, tx: post.txHash, txEvent: post.eventIndex ?? 0 };

  return (
    <article className="border-b border-edge pb-8">
      <h3>
        <a
          href={hrefFor(target)}
          onClick={(e) => {
            e.preventDefault();
            navigate(target);
          }}
          className="font-serif text-xl leading-[1.4] font-bold sm:text-2xl hover:text-accent transition-colors"
        >
          {fmtTitle(post.title) ?? <span className="text-ink-ghost">无标题</span>}
        </a>
      </h3>
      {teaser && (
        <p className="mt-2 text-base leading-relaxed text-ink-soft line-clamp-2">{teaser}</p>
      )}
      <PostMeta
        block={post.block}
        ts={post.ts}
        clock={clock}
        chainId={post.chainId}
        currentChain={currentChain}
        navigate={navigate}
        prefix={showIndex ? fmtIndex(post.index) : undefined}
        lead={<AuthorLink author={post.author} navigate={navigate} />}
        className="mt-3"
      />
    </article>
  );
}
