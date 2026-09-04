import { useState, useEffect, useCallback, useRef } from 'react';
import { useAsync } from '../lib/hooks';
import { chainFromSlug } from '../lib/chains';
import ChainChip from './ChainChip';
import { hrefFor } from '../lib/router';
import { renderMarkdown } from '../lib/renderMarkdown';
import {
  fmtBlock,
  fmtIndex,
  fmtTitle,
  fmtAbsTime,
  fmtRelTime,
  etherscanTxUrl,
  friendlyError,
} from '../lib/format';
import { t, useLang } from '../lib/i18n';
import { AlertCircle } from './Icons';
import AddressLabel from './Address';
import BackButton from './BackButton';
import { BTN_OUTLINE_PILL } from './formStyles';
import { ArticleTitle, Meta, Micro } from './Text';
import PostNav from './PostNav';
import { ArticleSkeleton } from './Skeleton';

/**
 * Single post view — a letter set on the page.
 * Props: { reader, meta: { author, index, block, title, txHash, eventIndex },
 *          onBack, neighbors: { prev, next } (undefined=resolving,
 *          null=absent), onNavigate(neighborMeta), onOpenAuthor() }
 *
 * Fetches the body (tags + markdown) from the publish() tx calldata through
 * the reader of the chain the post is on, rewrites `0x<txhash>/<n>` article
 * refs to in-app links, then resolves any eth:<txhash> image refs to blob
 * URLs before rendering.
 */
export default function PostPage({
  reader,
  meta,
  navigate,
  onBack,
  neighbors,
  onNavigate,
  onOpenAuthor,
}) {
  const [body, setBody] = useState(null); // { tags, markdown }
  const [fromCache, setFromCache] = useState(false);
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // The tab title is written imperatively, so it needs the language as a
  // dependency of its own — a re-render alone would not rewrite it.
  const lang = useLang();

  // Object URLs for the resolved images of the *current* post — revoked
  // whenever the post changes or the page unmounts.
  const urlsRef = useRef([]);
  const releaseUrls = () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  };

  const load = useCallback(async () => {
    releaseUrls();
    setLoading(true);
    setError(null);
    setBody(null);
    setHtml(null);
    setFromCache(false);
    try {
      const res = await reader.loadPostBody(meta.txHash);
      const b = res.body;
      setBody(b);
      setFromCache(res.fromCache);
      const md = await reader.resolveGlyphRefs(b.markdown);
      const { markdown: resolved, urls } = await reader.resolveImages(md);
      urlsRef.current = urls;
      setHtml(renderMarkdown(resolved));
    } catch (err) {
      setError(err.message || t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [reader, meta.txHash]);

  useEffect(() => {
    load();
  }, [load]);

  // Unmount-only cleanup: load() already revokes on every post switch.
  useEffect(() => () => releaseUrls(), []);

  // Jump back to the top instantly when switching letters (prev/next nav).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [meta.txHash]);

  // Tab title mirrors the open letter; restore the site title on leave.
  useEffect(() => {
    document.title = t('post.titleSuffix', { title: fmtTitle(meta.title) || t('common.untitled') });
    return () => {
      document.title = t('brand.title');
    };
  }, [meta.title, lang]);

  // The exact time the post was mined: on the row when the feed read it,
  // otherwise one header read (null while resolving → suppressed).
  const time = useAsync(
    () => (meta.ts != null ? Promise.resolve(meta.ts) : reader.blockTime(meta.block)),
    [reader, meta.txHash, meta.ts],
  );
  const relTime = time.value != null ? fmtRelTime(new Date(time.value * 1000), { exact: true }) : null;
  const absTime = fmtAbsTime(time.value);

  // Author display: ENS name when the address has one, else the address.
  const ens = useAsync(() => reader.ensName(meta.author), [reader, meta.author]);
  const ensName = ens.value ?? null;

  const title = fmtTitle(meta.title);
  const loaded = !loading && !error && html != null;

  return (
    <article>
      <div className="mb-8">
        <BackButton onClick={onBack} />
      </div>

      <header className="mb-10">
        <div className="article-column text-center">
        <ArticleTitle>
          {title || <span className="text-ink-ghost">{t('common.untitled')}</span>}
        </ArticleTitle>
        <Meta as="div" nums className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1">
            <span>{t('post.by')}</span>
            <a
              href={hrefFor({ author: meta.author })}
              onClick={(e) => {
                e.preventDefault();
                onOpenAuthor?.();
              }}
              title={meta.author}
              className="inline-flex items-center hover:text-accent transition-colors"
            >
              {ensName || <AddressLabel address={meta.author} size={14} tailClassName="text-xs" />}
            </a>
          </span>
          <span className="flex items-center gap-2">
            <ChainChip chainId={reader.chainId} navigate={navigate} />
            <span className="select-none" aria-hidden="true">·</span>
            <span>{fmtIndex(meta.index)}</span>
            {relTime && (
              <>
                <span className="select-none" aria-hidden="true">·</span>
                <span title={absTime ?? undefined}>{relTime}</span>
              </>
            )}
          </span>
        </Meta>
        </div>
      </header>

      {loading && <ArticleSkeleton />}

      {error && !loading && (
        <div className="mx-auto max-w-[36em] py-6">
          <div className="flex items-start gap-2.5 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>{t('post.loadFailed', { reason: friendlyError(error) })}</p>
          </div>
          <details className="mt-3">
            <Meta as="summary" className="cursor-pointer select-none hover:text-accent transition-colors">
              {t('common.technicalDetails')}
            </Meta>
            <Micro as="pre" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper-sunken p-3 leading-relaxed">
              {error}
            </Micro>
          </details>
          <button
            type="button"
            onClick={load}
            className={`mt-4 ${BTN_OUTLINE_PILL}`}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {loaded && (
        <div
          className="article-column prose-glyph"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            // 0x… cross-article refs render as in-app post links (glyphRefs)
            // — route them instead of reloading the page. The chain segment
            // is optional here so a ref written before the prefix, or by
            // hand, still lands somewhere sensible: this post's own chain.
            const href = e.target.closest?.('a[href]')?.getAttribute('href');
            const m = href?.match(
              /^#?\/(?:([^/]+)\/)?tx\/(0x[0-9a-fA-F]{64})(?:\/(\d+))?\/?$/,
            );
            if (!m) return; // an ordinary link — let the browser have it
            e.preventDefault();
            navigate?.({
              chain: chainFromSlug(m[1]) ?? reader.chainId,
              tx: m[2],
              txEvent: m[3] != null ? Number(m[3]) : 0,
            });
          }}
        />
      )}

      {loaded && (
        <footer className="mt-14 text-center">
          <Meta nums className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
            <span>{t('post.block', { block: fmtBlock(meta.block) })}</span>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={etherscanTxUrl(meta.txHash, reader.chainId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              {t('post.transaction')}
            </a>
            {fromCache && (
              <>
                <span className="select-none" aria-hidden="true">·</span>
                <span>{t('post.fromCache')}</span>
              </>
            )}
          </Meta>
          {body?.tags && body.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {body.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-edge bg-paper-sunken px-2 py-0.5 text-xs text-ink-soft"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </footer>
      )}

      <PostNav
        prev={neighbors?.prev}
        next={neighbors?.next}
        onGo={onNavigate}
      />
    </article>
  );
}
