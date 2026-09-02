import { useEffect, useState } from 'react';
import { readFeedScan, readAuthorScanEntries } from '../lib/scanStore';
import { lowest, highest, blockCount } from '../lib/segments';
import { fmtBlock, shortAddr } from '../lib/format';
import { ArrowLeft } from './Icons';
import ListHeader from './ListHeader';
import SectionHeader from './SectionHeader';

/** How many global segments to spell out before collapsing the rest. */
const MAX_SHOWN = 8;

/**
 * Scan-range status page (/scan): the block ranges the local incremental
 * scan has already covered — the global home-feed ranges plus one entry per
 * visited author — read straight from the persisted scan state. Coverage is
 * a SET of ranges, so reading deeper never re-reads a range already held.
 * Read-only diagnostics: the data exists only in this browser.
 */
export default function ScanPage({ navigate }) {
  const [feedScan, setFeedScan] = useState(readFeedScan);
  const [authors, setAuthors] = useState(readAuthorScanEntries);

  useEffect(() => {
    const sync = () => {
      setFeedScan(readFeedScan());
      setAuthors(readAuthorScanEntries());
    };
    window.addEventListener('glyph:feedscan', sync);
    window.addEventListener('glyph:authorscan', sync);
    return () => {
      window.removeEventListener('glyph:feedscan', sync);
      window.removeEventListener('glyph:authorscan', sync);
    };
  }, []);

  const globalSegments = feedScan?.segments ?? [];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate({})}
          className="-ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-accent hover:bg-paper-sunken transition-colors"
        >
          <ArrowLeft size={16} />
          返回
        </button>
      </div>

      <ListHeader title="扫描范围" subtitle="本机缓存的区块覆盖范围" />

      <p className="mb-8 max-w-2xl text-xs leading-relaxed text-ink-ghost">
        为了在公共 RPC 上增量读取链上文章，浏览器会在本地记录已经扫描过的区块范围，刷新后只拉取新出现的区块，不再重复请求。
        记录的是多段范围而不是一整段：先扫过 1–100、后来扫过 200–300，再往前翻时只会补上中间的 101–199。
        全局流最多缓存 300 篇、每位作者最多缓存最近 200 篇标题；缓存被裁剪时对应的范围也会一并收回，避免「以为扫过」而漏掉文章。
      </p>

      <SectionHeader
        label="全局扫描（首页流）"
        right={
          globalSegments.length > 0 ? (
            <span className="text-xs text-ink-ghost">
              {globalSegments.length} 段 · 共 {fmtBlock(blockCount(globalSegments))} 个区块
            </span>
          ) : undefined
        }
      />
      {globalSegments.length > 0 ? (
        <>
          <ul className="mb-2 space-y-1">
            {[...globalSegments]
              .reverse()
              .slice(0, MAX_SHOWN)
              .map(([from, to]) => (
                <li key={`${from}-${to}`} className="text-sm tabular-nums text-ink-soft">
                  区块 {fmtBlock(from)} 至 {fmtBlock(to)}
                  <span className="text-ink-ghost"> · {fmtBlock(to - from + 1n)} 个区块</span>
                </li>
              ))}
          </ul>
          {globalSegments.length > MAX_SHOWN && (
            <p className="mb-2 text-xs text-ink-ghost">
              …另有 {globalSegments.length - MAX_SHOWN} 段更早的范围
            </p>
          )}
          <p className="mb-8 text-xs text-ink-ghost">
            缓存 {(feedScan.rows ?? []).length} 篇
            {feedScan.head != null && <> · 已同步至区块 {fmtBlock(feedScan.head)}</>}
          </p>
        </>
      ) : (
        <p className="mb-8 text-sm text-ink-ghost">还没有扫描记录——打开首页后自动记录。</p>
      )}

      <SectionHeader label="作者扫描" />
      {authors.length > 0 ? (
        <ul className="mb-8 divide-y divide-edge">
          {authors.map((a) => (
            <li
              key={a.address}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5"
            >
              <a
                href={`/author/${a.address}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ author: a.address });
                }}
                title={a.address}
                className="font-mono text-xs text-ink-soft hover:text-accent transition-colors"
              >
                {shortAddr(a.address)}
              </a>
              {a.segments.length > 0 ? (
                <span className="text-sm tabular-nums text-ink-faint">
                  区块 {fmtBlock(lowest(a.segments))} 至 {fmtBlock(highest(a.segments))}
                  <span className="text-ink-ghost">
                    {' · '}
                    {a.segments.length} 段 · {a.count} 篇
                  </span>
                </span>
              ) : (
                <span className="text-sm text-ink-ghost">
                  未记录范围{a.count > 0 ? ` · 缓存 ${a.count} 篇` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-8 text-sm text-ink-ghost">还没有作者记录——打开某位作者的文章页后自动记录。</p>
      )}

      <p className="text-xs leading-relaxed text-ink-ghost">
        记录保存在本机浏览器（localStorage），只用于避免重复的链上请求；清除浏览器数据后会自动重新扫描。
        同一篇文章在一次会话里只会向节点请求一次，正文与图片缓存另存于浏览器 IndexedDB。
      </p>
    </div>
  );
}
