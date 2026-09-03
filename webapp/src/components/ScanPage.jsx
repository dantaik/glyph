import { useSyncExternalStore } from 'react';
import { CHAINS, SELECTABLE_CHAIN_IDS } from '../lib/chains';
import { useActiveChainId } from '../lib/config';
import { getReader } from '../lib/data';
import { lowest, highest, blockCount } from '../lib/segments';
import { fmtBlock } from '../lib/format';
import AddressLabel from './Address';
import BackButton from './BackButton';
import ListHeader from './ListHeader';
import SectionHeader from './SectionHeader';

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
  const activeId = useActiveChainId();
  const ids = SELECTABLE_CHAIN_IDS.includes(activeId)
    ? SELECTABLE_CHAIN_IDS
    : [...SELECTABLE_CHAIN_IDS, activeId];
  const ordered = [activeId, ...ids.filter((id) => id !== activeId)];

  return (
    <div>
      <div className="mb-8">
        <BackButton onClick={() => navigate({})} />
      </div>

      <ListHeader title="扫描范围" subtitle="本机缓存的区块覆盖范围" />

      <p className="mb-8 max-w-2xl text-xs leading-relaxed text-ink-ghost">
        为了在公共 RPC 上增量读取链上文章，浏览器会在本地记录已经扫描过的区块范围，刷新后只拉取新出现的区块，不再重复请求。
        记录的是多段范围而不是一整段：先扫过 1–100、后来扫过 200–300，再往前翻时只会补上中间的 101–199。
        每条链各自记录，互不影响；切换网络时，正在进行的扫描会在后台继续完成并缓存结果。
        全局流最多缓存 300 篇、每位作者最多缓存最近 200 篇标题；缓存被裁剪时对应的范围也会一并收回，避免「以为扫过」而漏掉文章。
      </p>

      {ordered.map((id) => (
        <ChainScan key={id} chainId={id} active={id === activeId} navigate={navigate} />
      ))}

      <p className="text-xs leading-relaxed text-ink-ghost">
        记录保存在本机浏览器（localStorage），按链分开，只用于避免重复的链上请求；清除浏览器数据后会自动重新扫描。
        同一篇文章在一次会话里只会向节点请求一次，正文与图片缓存另存于浏览器 IndexedDB（同样按链区分）。
      </p>
    </div>
  );
}

/** One chain's coverage: the global feed ranges, then the visited authors. */
function ChainScan({ chainId, active, navigate }) {
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
  const chain = CHAINS[chainId];

  return (
    <section className="mb-12">
      <SectionHeader
        label={`${chain?.name ?? `链 ${chainId}`} · ${chainId}`}
        right={
          active ? (
            <span className="text-xs text-accent">当前网络</span>
          ) : feed.job ? (
            <span className="animate-pulse text-xs text-ink-ghost">后台扫描中</span>
          ) : undefined
        }
      />
      <p className="mb-4 text-xs tabular-nums text-ink-ghost">
        每次扫描（打开首页、点一次「加载更早的文章」）最多向节点读取 {fmtBlock(feed.scanBlocks)} 个区块
        {feed.floor > 0n && <>；合约部署于区块 {fmtBlock(feed.floor)}，不会读取更早的区块</>}。
      </p>

      <h3 className="mb-2 text-xs tracking-label text-ink-faint">全局扫描（首页流）</h3>
      {segments.length > 0 ? (
        <>
          <ul className="mb-2 space-y-1">
            {[...segments]
              .reverse()
              .slice(0, MAX_SHOWN)
              .map(([from, to]) => (
                <li key={`${from}-${to}`} className="text-sm tabular-nums text-ink-soft">
                  区块 {fmtBlock(from)} 至 {fmtBlock(to)}
                  <span className="text-ink-ghost"> · {fmtBlock(to - from + 1n)} 个区块</span>
                </li>
              ))}
          </ul>
          {segments.length > MAX_SHOWN && (
            <p className="mb-2 text-xs text-ink-ghost">
              …另有 {segments.length - MAX_SHOWN} 段更早的范围
            </p>
          )}
          <p className="mb-6 text-xs tabular-nums text-ink-ghost">
            {segments.length} 段 · 共 {fmtBlock(blockCount(segments))} 个区块 · 缓存 {cached} 篇
            {feed.head != null && <> · 已同步至区块 {fmtBlock(feed.head)}</>}
            {feed.job && feed.progress && (
              <>
                {' · '}
                <span className="animate-pulse">
                  正在扫描区块 {fmtBlock(feed.progress.from)} 至 {fmtBlock(feed.progress.to)}
                  ，本次已读 {fmtBlock(feed.progress.fetched)} / 最多 {fmtBlock(feed.scanBlocks)}
                </span>
              </>
            )}
          </p>
        </>
      ) : (
        <p className="mb-6 text-sm text-ink-ghost">
          {feed.job ? '正在进行第一次扫描…' : '还没有扫描记录——打开首页后自动记录。'}
        </p>
      )}

      <h3 className="mb-2 text-xs tracking-label text-ink-faint">作者扫描</h3>
      {authors.length > 0 ? (
        <ul className="divide-y divide-edge">
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
                className="inline-flex items-center text-ink-soft hover:text-accent transition-colors"
              >
                <AddressLabel address={a.address} size={14} tailClassName="text-xs" />
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
        <p className="text-sm text-ink-ghost">还没有作者记录——打开某位作者的文章页后自动记录。</p>
      )}
    </section>
  );
}
