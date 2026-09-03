import { useEffect, useState } from 'react';
import { cachePersists } from '../lib/cache';
import { useAsync } from '../lib/hooks';
import { FROM_FILE, IS_OFFLINE_BUILD, OFFLINE_FILE } from '../lib/offline';
import { Download } from './Icons';
import SectionHeader from './SectionHeader';

const NOTE = 'text-xs leading-relaxed text-ink-faint';

/** Wallets inject late; a page opened from disk may get no injection at all. */
function useHasWallet() {
  const [has, setHas] = useState(() => typeof window !== 'undefined' && !!window.ethereum);
  useEffect(() => {
    if (has) return undefined;
    const check = () => setHas(!!window.ethereum);
    window.addEventListener('ethereum#initialized', check);
    const t = setTimeout(check, 1500);
    return () => {
      window.removeEventListener('ethereum#initialized', check);
      clearTimeout(t);
    };
  }, [has]);
  return has;
}

/**
 * The offline copy, from both sides.
 *
 * On the hosted site: the download. One HTML file with the app, the contract
 * address and the default endpoints inside it — the reader's only dependency
 * is an RPC endpoint, so a saved copy keeps reading after the domain stops
 * resolving.
 *
 * Inside that copy: what a page opened from disk can and cannot do — the
 * permanent cache and the wallet both hang on browser permissions that
 * file:// pages don't get by default.
 */
export default function OfflineSection() {
  const { value: persists } = useAsync(() => cachePersists(), []);
  const hasWallet = useHasWallet();

  if (!IS_OFFLINE_BUILD) {
    return (
      <section className="mb-10">
        <SectionHeader label="离线备份" />
        <p className={NOTE}>
          把整个应用存成一个 HTML 文件。文章本身在链上，这个文件只是读它的窗口——
          存到硬盘或 U 盘，双击就能打开，本站的域名以后是否还在都不影响。
        </p>
        <a
          href={`/${OFFLINE_FILE}`}
          download={OFFLINE_FILE}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-edge-strong px-4 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors"
        >
          <Download size={16} />
          下载离线版（单个 HTML 文件）
        </a>
        <ul className={`mt-3 list-disc space-y-1 pl-4 ${NOTE}`}>
          <li>
            <strong className="font-medium text-ink-soft">阅读</strong>
            ：完全可用。文件直接向 RPC 节点请求，节点地址可在上面改，改动存在打开它的那个浏览器里。
          </li>
          <li>
            <strong className="font-medium text-ink-soft">发布</strong>
            ：需要给钱包扩展开权限。浏览器默认不把钱包注入本地文件页面——
            以 MetaMask 为例，在扩展管理页打开它的「详细信息 →
            允许访问文件网址」，之后本地文件里也能连钱包发文。
          </li>
          <li>
            <strong className="font-medium text-ink-soft">缓存</strong>
            ：有的浏览器不允许本地文件页面使用 IndexedDB。不允许时，离线副本里的正文缓存只在本次会话内有效，
            关掉标签页后重新扫；节点列表与扫描记录（localStorage）不受影响。离线副本的设置页会写明当前实际情况。
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <SectionHeader label="离线版" />
      <p className={NOTE}>
        你正在使用离线副本——应用本身来自这个 HTML 文件，只有链上数据仍要向 RPC 节点请求。
      </p>
      <ul className={`mt-3 list-disc space-y-1 pl-4 ${NOTE}`}>
        <li>
          正文缓存：
          {persists == null ? '检测中…' : persists ? '永久（IndexedDB 可用）' : '仅本次会话（浏览器不允许本地文件使用 IndexedDB）'}
        </li>
        {FROM_FILE && !hasWallet && (
          <li>
            未检测到钱包。浏览器默认不把钱包注入本地文件页面，需要在扩展管理页为它打开
            「允许访问文件网址」（MetaMask：详细信息 →
            允许访问文件网址），然后刷新本页。只读文章不需要这一步。
          </li>
        )}
      </ul>
    </section>
  );
}
