import { useState, useEffect, useCallback, useRef } from 'react';
import { loadPostBody, resolveImages, getChainClock, resolveEnsName } from '../lib/data';
import { renderMarkdown } from '../lib/renderMarkdown';
import {
  fmtBlock,
  fmtIndex,
  fmtTitle,
  shortAddr,
  estimateBlockTime,
  fmtRelTime,
  chainName,
  etherscanTxUrl,
  friendlyError,
} from '../lib/format';
import { ArrowLeft, AlertCircle } from './Icons';
import FontSizeControl from './FontSizeControl';
import PostNav from './PostNav';

const SKELETON_GROUPS = [
  ['w-full', 'w-11/12', 'w-full', 'w-3/5'],
  ['w-full', 'w-10/12', 'w-full', 'w-2/3'],
];

/**
 * Single post view — a letter set on the page.
 * Props: { meta: { author, index, block, title, txHash }, onBack,
 *          neighbors: { prev, next } (undefined=resolving, null=absent),
 *          onNavigateIndex(index) }
 *
 * Fetches the body (tags + markdown) from the publish() tx calldata, then
 * resolves any eth:<txhash> image refs to blob URLs before rendering.
 */
export default function PostPage({ meta, onBack, neighbors, onNavigateIndex, onOpenAuthor }) {
  const [body, setBody] = useState(null); // { tags, markdown }
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relTime, setRelTime] = useState(null);

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
    try {
      const b = await loadPostBody(meta.txHash);
      setBody(b);
      const { markdown: resolved, urls } = await resolveImages(b.markdown);
      urlsRef.current = urls;
      setHtml(renderMarkdown(resolved));
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [meta.txHash]);

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
    document.title = `${fmtTitle(meta.title) || '无标题'} · 留声`;
    return () => {
      document.title = '留声';
    };
  }, [meta.title]);

  // Estimated wall-clock time from the chain clock (null → suppressed).
  useEffect(() => {
    let cancelled = false;
    setRelTime(null);
    getChainClock()
      .then((clock) => {
        if (!cancelled) {
          setRelTime(fmtRelTime(estimateBlockTime(clock, meta.block)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.block]);

  // Author display: ENS name when the address has one, else the address.
  const [ensName, setEnsName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setEnsName(null);
    resolveEnsName(meta.author).then((name) => !cancelled && setEnsName(name));
    return () => {
      cancelled = true;
    };
  }, [meta.author]);

  const title = fmtTitle(meta.title);
  const loaded = !loading && !error && html != null;

  return (
    <article>
      <div className="mb-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="-ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-sunken transition-colors"
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <FontSizeControl />
      </div>

      <header className="mb-10 text-center">
        <h1 className="font-serif text-2xl leading-[1.45] font-bold sm:text-display">
          {title || <span className="text-ink-ghost">无标题</span>}
        </h1>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-ink-faint tabular-nums">
          <span>{fmtIndex(meta.index)}</span>
          <span className="select-none" aria-hidden="true">·</span>
          {relTime && (
            <>
              <span>{relTime}</span>
              <span className="select-none" aria-hidden="true">·</span>
            </>
          )}
          <span>{chainName()}</span>
        </div>
        <div className="mt-2 text-xs text-ink-faint tabular-nums">
          <span>作者：</span>
          <a
            href={`?author=${meta.author}`}
            onClick={(e) => {
              e.preventDefault();
              onOpenAuthor?.();
            }}
            title={meta.author}
            className="hover:text-accent transition-colors"
          >
            {ensName || shortAddr(meta.author)}
          </a>
        </div>
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

      </header>

      {loading && (
        <div className="mx-auto max-w-[36em] space-y-9" aria-hidden="true">
          {SKELETON_GROUPS.map((widths, g) => (
            <div key={g} className="space-y-4">
              {widths.map((w, i) => (
                <div
                  key={i}
                  className={`h-4 animate-pulse rounded bg-paper-sunken ${w}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="mx-auto max-w-[36em] py-6">
          <div className="flex items-start gap-2.5 text-sm text-danger">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>加载失败：{friendlyError(error)}</p>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-xs text-ink-faint hover:text-ink transition-colors">
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
          className="prose-glyph"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}

      {loaded && (
        <footer className="mt-14 text-center">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-ink-faint tabular-nums">
            <span>{chainName()}</span>
            <span className="select-none" aria-hidden="true">·</span>
            <span>区块 {fmtBlock(meta.block)}</span>
            <span className="select-none" aria-hidden="true">·</span>
            <a
              href={etherscanTxUrl(meta.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              在 Etherscan 查看
            </a>
          </p>
        </footer>
      )}

      <PostNav
        prev={neighbors?.prev}
        next={neighbors?.next}
        onGo={onNavigateIndex}
      />
    </article>
  );
}
