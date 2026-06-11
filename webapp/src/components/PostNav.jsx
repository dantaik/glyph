import { ArrowLeft, ArrowRight } from './Icons';
import { fmtTitle } from '../lib/format';

const CARD =
  'group block rounded-xl border border-edge px-5 py-4 hover:border-edge-strong hover:bg-paper-raised transition-colors w-full text-left';

function SkeletonCard({ side }) {
  const next = side === 'next';
  return (
    <div
      aria-hidden="true"
      className={`rounded-xl border border-edge px-5 py-4${next ? ' sm:col-start-2' : ''}`}
    >
      <div
        className={`h-3 w-12 animate-pulse rounded bg-paper-sunken${next ? ' ml-auto' : ''}`}
      />
      <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-paper-sunken" />
    </div>
  );
}

function NeighborCard({ side, meta, onGo }) {
  const next = side === 'next';
  return (
    <button
      type="button"
      rel={next ? 'next' : 'prev'}
      onClick={() => onGo(Number(meta.index))}
      className={`${CARD}${next ? ' sm:col-start-2' : ''}`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs text-ink-faint${next ? ' justify-end' : ''}`}
      >
        {next ? (
          <>
            下一篇
            <ArrowRight size={14} />
          </>
        ) : (
          <>
            <ArrowLeft size={14} />
            上一篇
          </>
        )}
      </span>
      <span className="mt-1 font-serif text-[15px] leading-snug text-ink group-hover:text-accent line-clamp-2">
        {fmtTitle(meta.title) || '无标题'}
      </span>
    </button>
  );
}

/**
 * Prev/next letter cards under an open post.
 * `prev`/`next`: undefined = resolving (skeleton), null = absent (omitted),
 * meta = card. Both null → renders nothing.
 */
export default function PostNav({ prev, next, onGo }) {
  if (prev === null && next === null) return null;
  return (
    <nav aria-label="前后篇" className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-10">
      {prev === undefined ? (
        <SkeletonCard side="prev" />
      ) : prev ? (
        <NeighborCard side="prev" meta={prev} onGo={onGo} />
      ) : null}
      {next === undefined ? (
        <SkeletonCard side="next" />
      ) : next ? (
        <NeighborCard side="next" meta={next} onGo={onGo} />
      ) : null}
    </nav>
  );
}
