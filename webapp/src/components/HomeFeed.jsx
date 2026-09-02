import { useState, useEffect } from 'react';
import {
  loadRecentAcrossAuthors,
  loadPostBody,
  getChainClock,
} from '../lib/data';
import {
  fmtTitle,
  estimateBlockTime,
  fmtRelTime,
  excerpt,
  chainName,
} from '../lib/format';
import EmptyState from './EmptyState';

const FEED_SIZE = 20;
const EXCERPT_CHARS = 80;

/**
 * Home feed (no author in URL): literary-magazine front page with the most
 * recent posts across all authors. Best-effort, bounded block scan — see
 * loadRecentAcrossAuthors(). The first entry is featured: tag chips and a
 * two-line excerpt are fetched from its tx calldata (silent degrade).
 */
export default function HomeFeed({ navigate, onStartWriting }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clock, setClock] = useState(null);
  const [featuredBody, setFeaturedBody] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRecentAcrossAuthors(FEED_SIZE)
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e.message || '加载失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Chain clock for 约-relative times; silently degrade to block numbers.
  useEffect(() => {
    let cancelled = false;
    getChainClock()
      .then((c) => !cancelled && setClock(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Featured entry body (tags + excerpt); silently degrade to title-only.
  useEffect(() => {
    setFeaturedBody(null);
    const first = rows[0];
    if (!first) return undefined;
    let cancelled = false;
    loadPostBody(first.txHash)
      .then((b) => !cancelled && setFeaturedBody(b))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const openPost = (r) => navigate({ author: r.author, i: String(r.index) });
  const featured = rows[0];
  const rest = rows.slice(1);
  const teaser = featuredBody ? excerpt(featuredBody.markdown, EXCERPT_CHARS) : '';

  return (
    <div>
      <section className="mb-9 text-center">
        <h1 className="text-2xl font-bold leading-snug tracking-wide text-ink sm:text-[1.75rem]">
          人过留名，雁过留声。
          <br />
          人海亿万，唯留字者不朽。
        </h1>
      </section>

      <header className="mb-8 flex items-baseline justify-between border-b border-edge pb-3">
        <h2 className="text-xl font-semibold">最新文章</h2>
        <p className="text-xs text-ink-ghost">来自所有作者的最近 {FEED_SIZE} 篇</p>
      </header>

      {loading ? (
        <FeedSkeleton />
      ) : error ? (
        <EmptyState
          tone="danger"
          title="加载失败"
          body={error}
          actionLabel="重试"
          onAction={() => setTick((t) => t + 1)}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="此刻还没有文章"
          body="最近的区块里没有发现新的文章。连接钱包，刻下第一篇。"
          actionLabel="刻第一篇"
          onAction={onStartWriting}
        />
      ) : (
        <>
          <article className="border-b border-edge pb-8">
            {featuredBody?.tags?.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {featuredBody.tags.map((t) => (
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
                href={`?author=${featured.author}&i=${featured.index}`}
                onClick={(e) => {
                  e.preventDefault();
                  openPost(featured);
                }}
                className="font-serif text-[1.35rem] leading-[1.4] font-bold sm:text-feature hover:text-accent transition-colors"
              >
                {fmtTitle(featured.title) ?? <span className="text-ink-ghost">无标题</span>}
              </a>
            </h3>
            {teaser && (
              <p className="mt-2 font-serif text-[0.95rem] leading-relaxed text-ink-soft line-clamp-2">
                {teaser}
              </p>
            )}
            <MetaLine row={featured} clock={clock} className="mt-3" />
          </article>

          <ul className="divide-y divide-edge">
            {rest.map((r) => (
              <li key={`${r.txHash}-${r.index}`}>
                <a
                  href={`?author=${r.author}&i=${r.index}`}
                  onClick={(e) => {
                    e.preventDefault();
                    openPost(r);
                  }}
                  className="group block py-5"
                >
                  <span className="block font-serif text-lg leading-snug group-hover:text-accent transition-colors line-clamp-2">
                    {fmtTitle(r.title) ?? <span className="text-ink-ghost">无标题</span>}
                  </span>
                  <MetaLine row={r} clock={clock} className="mt-2" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** chain badge · 约-relative-time (suppressed when unknown) */
function MetaLine({ row, clock, className = '' }) {
  const rel = fmtRelTime(estimateBlockTime(clock, row.block));
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint tabular-nums ${className}`}
    >
      <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-[11px]">{chainName()}</span>
      {rel && (
        <>
          <span aria-hidden="true">·</span>
          <span>{rel}</span>
        </>
      )}
    </span>
  );
}

function FeedSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="border-b border-edge pb-8">
        <div className="h-7 w-3/5 animate-pulse rounded bg-paper-sunken" />
        <div className="mt-4 h-4 w-full animate-pulse rounded bg-paper-sunken" />
        <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-paper-sunken" />
        <div className="mt-4 h-3 w-2/5 animate-pulse rounded bg-paper-sunken" />
      </div>
      <ul className="divide-y divide-edge">
        {[0, 1, 2, 3].map((k) => (
          <li key={k} className="py-5">
            <div className="h-5 w-2/3 animate-pulse rounded bg-paper-sunken" />
            <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-paper-sunken" />
          </li>
        ))}
      </ul>
      <p className="mt-10 animate-pulse text-center text-xs text-ink-ghost">
        正在扫描最近区块…
      </p>
    </div>
  );
}
