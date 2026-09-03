import { useState, useEffect, useCallback, useRef } from 'react';
import { useAsync } from '../lib/hooks';
import { renderMarkdown } from '../lib/renderMarkdown';
import {
  fmtBlock,
  fmtIndex,
  fmtTitle,
  estimateBlockTime,
  fmtRelTime,
  etherscanTxUrl,
  friendlyError,
} from '../lib/format';
import { AlertCircle } from './Icons';
import AddressLabel from './Address';
import BackButton from './BackButton';
import FontSizeControl from './FontSizeControl';
import PostNav from './PostNav';
import { ArticleSkeleton } from './Skeleton';

/**
 * Single post view — a letter set on the page.
 * Props: { reader, meta: { author, index, block, title, txHash, eventIndex },
 *          onBack, neighbors: { prev, next } (undefined=resolving,
 *          null=absent), onNavigate(neighborMeta), onOpenAuthor() }
 *
 * Fetches the body (tags + markdown) from the publish() tx calldata through
 * the reader of the chain being shown, rewrites `0x<txhash>/<n>` article
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
      setError(err.message || '加载失败');
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
    document.title = `${fmtTitle(meta.title) || '无标题'} · 雪泥`;
    return () => {
      document.title = '雪泥';
    };
  }, [meta.title]);

  // Estimated wall-clock time from the chain clock (null → suppressed).
  const clock = useAsync(() => reader.clock(), [reader]);
  const relTime = clock.value ? fmtRelTime(estimateBlockTime(clock.value, meta.block)) : null;

  // Author display: ENS name when the address has one, else the address.
  const ens = useAsync(() => reader.ensName(meta.author), [reader, meta.author]);
  const ensName = ens.value ?? null;

  const title = fmtTitle(meta.title);
  const loaded = !loading && !error && html != null;

  return (
    <article>
      <div className="mb-8 flex items-center justify-between">
        <BackButton onClick={onBack} />
        <FontSizeControl />
      </div>

      <header className="mb-10">
        <div className="article-column text-center">
        <h1 className="font-serif text-2xl leading-[1.45] font-bold sm:text-display">
          {title || <span className="text-ink-ghost">无标题</span>}
        </h1>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 text-xs text-ink-faint tabular-nums">
          <span className="flex items-center gap-1">
            <span>作者：</span>
            <a
              href={`/author/${meta.author}`}
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
            <span>{fmtIndex(meta.index)}</span>
            {relTime && (
              <>
                <span className="select-none" aria-hidden="true">·</span>
                <span>{relTime}</span>
              </>
            )}
          </span>
        </div>
        </div>
      </header>

      {loading && <ArticleSkeleton />}

      {error && !loading && (
        <div className="mx-auto max-w-[36em] py-6">
          <div className="flex items-start gap-2.5 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>加载失败：{friendlyError(error)}</p>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-xs text-ink-faint hover:text-accent transition-colors">
              技术细节
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-paper-sunken p-3 font-mono text-2xs leading-relaxed text-ink-faint whitespace-pre-wrap break-all">
              {error}
            </pre>
          </details>
          <button
            type="button"
            onClick={load}
            className="mt-4 rounded-full border border-edge-strong px-5 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {loaded && (
        <div
          className="article-column prose-glyph"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            // 0x… cross-article refs render as /tx/<hash>/<n> links —
            // route them in-app instead of a full page load.
            const a = e.target.closest?.('a[href^="/tx/"]');
            if (!a) return;
            e.preventDefault();
            const m = a.getAttribute('href').match(/^\/tx\/(0x[0-9a-fA-F]{64})(?:\/(\d+))?\/?$/);
            if (m) navigate?.({ tx: m[1], txEvent: m[2] != null ? Number(m[2]) : 0 });
          }}
        />
      )}

      {loaded && (
        <footer className="mt-14 text-center">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-ink-faint tabular-nums">
            <span>区块 {fmtBlock(meta.block)}</span>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={etherscanTxUrl(meta.txHash, reader.chainId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              交易
            </a>
            {fromCache && (
              <>
                <span className="select-none" aria-hidden="true">·</span>
                <span>来自本地缓存</span>
              </>
            )}
          </p>
          {body?.tags && body.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {body.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-edge bg-paper-sunken px-2 py-0.5 text-xs text-ink-soft"
                >
                  {t}
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
