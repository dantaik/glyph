import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useBodiesFor } from '../lib/hooks';
import { t } from '../lib/i18n';
import { getBodyIndex } from '../lib/bodyIndex';
import { highlightParts, matchPost, normalizeQuery } from '../lib/search';
import { hrefFor } from '../lib/router';
import { rowKey } from '../lib/timeline';
import { fmtTitle } from '../lib/format';
import AuthorLink from './AuthorLink';
import EmptyState from './EmptyState';
import ListHeader from './ListHeader';
import LoadMoreButton from './LoadMoreButton';
import PostMeta from './PostMeta';
import { INPUT } from './formStyles';
import { ArticleTitle, Body, Hint } from './Text';

/** How long after a keystroke the URL and the results are updated. */
const DEBOUNCE_MS = 250;

/**
 * `/search?q=…` — find a word among the posts this browser has read.
 *
 * Matching is a case-folded substring rather than tokens, because the posts
 * this app was written for are often Chinese, which puts no spaces between
 * words: a tokeniser would fail exactly where it matters most (search.js).
 *
 * With no query, the tags seen so far stand in for a starting point.
 */
export default function SearchPage({ view, query, navigate, currentChain = null }) {
  const feed = useSyncExternalStore(view.feed.subscribe, view.feed.getSnapshot, view.feed.getSnapshot);
  const [typed, setTyped] = useState(query ?? '');

  // The URL follows the box, a moment behind, so a search can be shared and
  // the back button steps through searches rather than keystrokes.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((typed ?? '') !== (query ?? '')) navigate({ search: '1', q: typed }, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed, query, navigate]);

  const known = useMemo(
    () => view.knownRows(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, feed],
  );
  const loadBody = useCallback((row) => view.loadPostBody(row), [view]);
  const { bodies, pending } = useBodiesFor(loadBody, known);

  const needle = normalizeQuery(typed);
  const results = useMemo(() => {
    if (!needle) return [];
    const out = [];
    for (const row of known) {
      const body = bodies.get(`${row.chainId}:${String(row.txHash).toLowerCase()}`);
      const hit = matchPost({ title: row.title, tags: body?.tags, markdown: body?.markdown }, needle);
      if (hit) out.push({ row, hit });
    }
    return out;
  }, [known, bodies, needle]);

  // With nothing typed, the tags this browser has seen are the way in.
  const tags = useMemo(() => {
    if (needle) return [];
    return view.readers
      .flatMap((r) => getBodyIndex(r.chainId).tagsWithCounts())
      .reduce((acc, { tag, count }) => {
        const hit = acc.find((e) => e.tag === tag);
        if (hit) hit.count += count;
        else acc.push({ tag, count });
        return acc;
      }, [])
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, needle, feed, bodies]);

  return (
    <div data-search-page="">
      <ListHeader title={t('search.title')} subtitle={t('search.scope', { count: known.length })} />

      <input
        type="search"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.title')}
        autoFocus
        className={`${INPUT} mb-8`}
      />

      {!needle && (
        <div data-tag-cloud="">
          <Hint className="mb-3">{t('search.tagCloud')}</Hint>
          <div className="flex flex-wrap gap-2">
            {tags.map(({ tag, count }) => (
              <a
                key={tag}
                href={hrefFor({ tag })}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ tag });
                }}
                className="rounded-md border border-edge bg-paper-sunken px-2 py-0.5 text-xs text-ink-soft hover:border-accent hover:text-accent transition-colors"
              >
                {tag}
                <span className="ml-1.5 tabular-nums text-ink-ghost">{count}</span>
              </a>
            ))}
          </div>
          {tags.length === 0 && <Hint>{t('search.noTagsYet')}</Hint>}
        </div>
      )}

      {needle && results.length > 0 && (
        <ul>
          {results.map(({ row, hit }) => (
            <Result key={rowKey(row)} row={row} hit={hit} needle={needle} navigate={navigate} currentChain={currentChain} />
          ))}
        </ul>
      )}

      {needle && results.length === 0 && pending > 0 && (
        <Hint className="py-16 text-center">{t('search.reading')}</Hint>
      )}
      {needle && results.length === 0 && pending === 0 && (
        <EmptyState title={t('search.none', { query: typed })} body={t('search.noneBody')} />
      )}

      {needle && pending > 0 && results.length > 0 && (
        <Hint className="mt-6 text-center">{t('search.reading')}</Hint>
      )}

      {needle && (
        <LoadMoreButton
          onClick={() => view.feed.loadMore()}
          loading={feed.job === 'more'}
          disabled={feed.job != null}
          hasMore={!feed.done}
          label={t('search.readMore')}
        />
      )}
    </div>
  );
}

/** One result: the title, where the word was found, and the words around it. */
function Result({ row, hit, needle, navigate, currentChain }) {
  const target = { chain: row.chainId, tx: row.txHash, txEvent: row.eventIndex ?? 0 };
  return (
    <li className="py-4">
      <ArticleTitle
        as="a"
        href={hrefFor(target)}
        onClick={(e) => {
          e.preventDefault();
          navigate(target);
        }}
        className="line-clamp-1 transition-colors hover:text-accent"
      >
        {fmtTitle(row.title) ?? <span className="text-ink-ghost">{t('common.untitled')}</span>}
      </ArticleTitle>
      <Body className="mt-2 leading-relaxed">
        {highlightParts(hit.snippet, needle).map((part, i) =>
          part.hit ? (
            <mark key={i} className="rounded-sm bg-accent-wash px-0.5 text-ink">
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </Body>
      <div className="mt-1.5">
        <PostMeta
          block={row.block}
          ts={row.ts}
          chainId={row.chainId}
          currentChain={currentChain}
          navigate={navigate}
          lead={<AuthorLink author={row.author} navigate={navigate} />}
        />
      </div>
    </li>
  );
}
