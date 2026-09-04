import { useEffect, useState } from 'react';
import { isReadChain } from '../lib/config';
import { getReader } from '../lib/data';
import { chainName, fmtTitle } from '../lib/format';
import { parsePostRef } from '../lib/glyphRefs';
import { t } from '../lib/i18n';
import { hrefFor } from '../lib/router';
import { Meta } from './Text';

/**
 * What this post says about others, and what others say about it.
 *
 * The forward half is read straight out of the post's own front-matter, so it
 * is as durable as the post: a reply says it is a reply forever, whether or
 * not anyone has read the letter it answers.
 *
 * The backward half — replies, continuations, a newer version — comes from
 * the local index of bodies this browser has read (bodyIndex.js). It can only
 * ever be partial, and it never pretends otherwise: it shows what is known
 * and says nothing about what is not.
 */

/** A link to another post, with its title once that has been looked up. */
function PostRefLink({ refValue, currentChainId, navigate, fallback }) {
  const ref = parsePostRef(refValue, currentChainId);
  const [title, setTitle] = useState(undefined);

  useEffect(() => {
    if (!ref || !isReadChain(ref.chainId)) return undefined;
    let cancelled = false;
    getReader(ref.chainId)
      .findMetaByTx(ref.txHash, ref.eventIndex)
      .then((meta) => !cancelled && setTitle(meta ? (fmtTitle(meta.title) ?? '') : null))
      .catch(() => !cancelled && setTitle(null));
    return () => {
      cancelled = true;
    };
  }, [ref?.chainId, ref?.txHash, ref?.eventIndex]);

  if (!ref) return null;
  const target = { chain: ref.chainId, tx: ref.txHash, txEvent: ref.eventIndex };
  const shown = title === undefined ? (fallback ?? t('common.loading')) : title || t('common.untitled');
  return (
    <a
      href={hrefFor(target)}
      onClick={(e) => {
        e.preventDefault();
        navigate?.(target);
      }}
      className="hover:text-accent transition-colors"
    >
      {shown}
      {ref.chainId !== currentChainId ? ` · ${chainName(ref.chainId)}` : ''}
    </a>
  );
}

/**
 * The lines under a post's byline: what it replies to, continues, replaces,
 * and where it sits in a series.
 */
export function RelationsAbove({ meta, chainId, navigate, series }) {
  const lines = [];
  if (meta?.re) {
    lines.push(
      <>
        {t('relations.inReplyTo')}{' '}
        <PostRefLink refValue={meta.re} currentChainId={chainId} navigate={navigate} />
      </>,
    );
  }
  if (meta?.prev) {
    lines.push(
      <>
        {t('relations.continuesFrom')}{' '}
        <PostRefLink refValue={meta.prev} currentChainId={chainId} navigate={navigate} />
      </>,
    );
  }
  if (meta?.supersedes) {
    lines.push(
      <>
        {t('relations.supersedesLine')}{' '}
        <PostRefLink refValue={meta.supersedes} currentChainId={chainId} navigate={navigate} />
      </>,
    );
  }
  if (meta?.series) {
    // "Part 2 of Letters to Xiaoman" — and how many parts are known, when the
    // index has seen more than this one.
    const known = series?.length ?? 0;
    lines.push(
      <>
        {meta.part
          ? t('relations.partOf', { part: meta.part, series: meta.series })
          : t('relations.inSeries', { series: meta.series })}
        {known > 1 ? t('relations.partsKnown', { count: known }) : ''}
      </>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div className="mt-3 space-y-0.5" data-relations-above="">
      {lines.map((line, i) => (
        <Meta key={i}>{line}</Meta>
      ))}
    </div>
  );
}

/**
 * A banner for a post that has been superseded: whoever wrote it says a newer
 * version exists. On an immutable chain this is the only honest kind of edit,
 * so it is worth showing before the body rather than after it.
 */
export function SupersededNotice({ by, chainId, navigate }) {
  if (!by?.length) return null;
  return (
    <div
      role="note"
      data-superseded=""
      className="article-column mt-6 rounded-lg border border-edge bg-paper-sunken px-4 py-3"
    >
      <Meta>
        {t('relations.supersededBy')}{' '}
        {by.map(({ post }, i) => (
          <span key={post.txHash}>
            {i > 0 ? ', ' : ''}
            <PostRefLink
              refValue={`${post.txHash}/${post.eventIndex ?? 0}`}
              currentChainId={chainId}
              navigate={navigate}
              fallback={post.title}
            />
          </span>
        ))}
      </Meta>
    </div>
  );
}

/**
 * The posts that point back at this one, grouped by how they point. Drawn
 * from what this browser has read, and it says so.
 */
export function RelationsBelow({ backlinks, seriesParts, meta, chainId, navigate }) {
  const groups = [
    ['re', backlinks.filter((b) => b.kind === 're')],
    ['prev', backlinks.filter((b) => b.kind === 'prev')],
  ].filter(([, list]) => list.length > 0);

  // A post can qualify for two lists at once — the next part of a series is
  // usually also the post that continues this one — and seeing the same
  // title twice under one letter reads as a mistake. Named relations win;
  // the series list shows what is left.
  const alreadyShown = new Set(groups.flatMap(([, list]) => list.map(({ post }) => post.txHash)));
  const otherParts = (seriesParts ?? []).filter(
    (p) => p.post.txHash !== meta?.txHash && !alreadyShown.has(p.post.txHash),
  );
  if (groups.length === 0 && otherParts.length === 0) return null;

  return (
    <section className="article-column mt-12 border-t border-edge pt-6" data-relations-below="">
      {groups.map(([kind, list]) => (
        <div key={kind} className="mb-4">
          <Meta as="h2" className="mb-1.5 tracking-label">
            {t(kind === 're' ? 'relations.replies' : 'relations.continuedIn')}
          </Meta>
          <ul className="space-y-1">
            {list.map(({ post }) => (
              <Meta as="li" key={`${post.txHash}:${post.eventIndex ?? 0}`}>
                <PostRefLink
                  refValue={`${post.txHash}/${post.eventIndex ?? 0}`}
                  currentChainId={chainId}
                  navigate={navigate}
                  fallback={post.title}
                />
              </Meta>
            ))}
          </ul>
        </div>
      ))}

      {otherParts.length > 0 && (
        <div className="mb-4">
          <Meta as="h2" className="mb-1.5 tracking-label">
            {t('relations.seriesHeading', { series: meta.series })}
          </Meta>
          <ul className="space-y-1">
            {otherParts.map(({ part, post }) => (
              <Meta as="li" key={post.txHash} nums>
                {part ? `${t('relations.partShort', { part })} · ` : ''}
                <PostRefLink
                  refValue={`${post.txHash}/${post.eventIndex ?? 0}`}
                  currentChainId={chainId}
                  navigate={navigate}
                  fallback={post.title}
                />
              </Meta>
            ))}
          </ul>
        </div>
      )}

      <Meta className="text-ink-ghost">{t('relations.knownHere')}</Meta>
    </section>
  );
}
