import { useSyncExternalStore } from 'react';
import { READ_CHAIN_IDS } from '../lib/config';
import { getReader } from '../lib/data';
import { lowest, highest, blockCount } from '../lib/segments';
import { chainName, fmtBlock } from '../lib/format';
import { t } from '../lib/i18n';
import { hrefFor } from '../lib/router';
import AddressLabel from './Address';
import BackButton from './BackButton';
import ListHeader from './ListHeader';
import SectionHeader from './SectionHeader';
import { Body, Hint, Meta, Note } from './Text';

/** How many global segments to spell out before collapsing the rest. */
const MAX_SHOWN = 8;

/**
 * Scan-range status page (/scan): the block ranges the local incremental
 * scan has already covered on each chain — the global home-feed ranges
 * plus one entry per visited author — straight from the scan stores, live.
 * Coverage is a SET of ranges, so reading deeper never re-reads a range
 * already held. Read-only diagnostics: the data exists only in this browser.
 */
export default function ScanPage({ navigate }) {
  return (
    <div>
      <div className="mb-8">
        <BackButton onClick={() => navigate({})} />
      </div>

      <ListHeader title={t('scan.title')} subtitle={t('scan.subtitle')} />

      <Note className="mb-8 max-w-2xl">{t('scan.intro')}</Note>

      {READ_CHAIN_IDS.map((id) => (
        <ChainScan key={id} chainId={id} navigate={navigate} />
      ))}

      <Note>{t('scan.outro')}</Note>
    </div>
  );
}

/** One chain's coverage: the global feed ranges, then the visited authors. */
function ChainScan({ chainId, navigate }) {
  const reader = getReader(chainId);
  const feed = useSyncExternalStore(
    reader.feed.subscribe,
    reader.feed.getSnapshot,
    reader.feed.getSnapshot,
  );
  // Author walks change the store without touching the feed snapshot.
  useSyncExternalStore(reader.store.subscribe, reader.store.getVersion, reader.store.getVersion);
  const authors = reader.store.readAuthorScanEntries();
  const segments = feed.coverage;
  const cached = reader.store.allPosts().length;

  return (
    <section className="mb-12">
      <SectionHeader
        label={t('settings.chainLabel', { chain: chainName(chainId), id: chainId })}
        right={
          feed.job ? (
            <Hint as="span" className="animate-pulse">{t('scan.backgroundScanning')}</Hint>
          ) : undefined
        }
      />
      <Meta nums className="mb-4">
        {t('scan.budget', { blocks: fmtBlock(feed.scanBlocks) })}
        {feed.floor > 0n && t('scan.floor', { block: fmtBlock(feed.floor) })}
        {t('common.period')}
      </Meta>

      <Meta as="h3" className="mb-2 tracking-label">{t('scan.globalHeading')}</Meta>
      {segments.length > 0 ? (
        <>
          <ul className="mb-2 space-y-1">
            {[...segments]
              .reverse()
              .slice(0, MAX_SHOWN)
              .map(([from, to]) => (
                <Body as="li" nums key={`${from}-${to}`}>
                  {t('scan.range', { from: fmtBlock(from), to: fmtBlock(to) })}
                  <span className="text-ink-ghost">{t('scan.rangeBlocks', { blocks: fmtBlock(to - from + 1n) })}</span>
                </Body>
              ))}
          </ul>
          {segments.length > MAX_SHOWN && (
            <Hint className="mb-2">{t('scan.moreRanges', { count: segments.length - MAX_SHOWN })}</Hint>
          )}
          <Hint nums className="mb-6">
            {t('scan.summary', {
              segments: segments.length,
              blocks: fmtBlock(blockCount(segments)),
              cached,
            })}
            {feed.head != null && t('scan.syncedTo', { block: fmtBlock(feed.head) })}
            {feed.job && feed.progress && (
              <>
                {' · '}
                <span className="animate-pulse">
                  {t('scan.scanningNow', {
                    from: fmtBlock(feed.progress.from),
                    to: fmtBlock(feed.progress.to),
                    fetched: fmtBlock(feed.progress.fetched),
                    budget: fmtBlock(feed.scanBlocks),
                  })}
                </span>
              </>
            )}
          </Hint>
        </>
      ) : (
        <Body className="mb-6">{feed.job ? t('scan.firstScan') : t('scan.noRanges')}</Body>
      )}

      <Meta as="h3" className="mb-2 tracking-label">{t('scan.authorHeading')}</Meta>
      {authors.length > 0 ? (
        <ul className="divide-y divide-edge">
          {authors.map((a) => (
            <li
              key={a.address}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5"
            >
              <a
                href={hrefFor({ author: a.address })}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ author: a.address });
                }}
                title={a.address}
                className="inline-flex items-center text-ink-soft hover:text-accent transition-colors"
              >
                <AddressLabel address={a.address} size={14} tailClassName="text-xs" />
              </a>
              {a.segments.length > 0 ? (
                <Body as="span" nums>
                  {t('scan.authorRange', {
                    from: fmtBlock(lowest(a.segments)),
                    to: fmtBlock(highest(a.segments)),
                  })}
                  <span className="text-ink-ghost">
                    {t('scan.authorSummary', { segments: a.segments.length, count: a.count })}
                  </span>
                </Body>
              ) : (
                <Body as="span">
                  {t('scan.authorNoRange')}
                  {a.count > 0 ? t('scan.authorCached', { count: a.count }) : ''}
                </Body>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Body>{t('scan.noAuthors')}</Body>
      )}
    </section>
  );
}
