import { useEffect, useState } from 'react';
import { CHAINS, defaultRpcs } from '../lib/chains';
import {
  GLYPH_ADDRESS,
  READ_CHAIN_IDS,
  getRescanDelayMs,
  getRpcUrls,
  hasCustomRpcs,
  hasOverrides,
  resetEndpointConfig,
  saveRescanDelay,
  saveRpcUrls,
  useRpcVersion,
} from '../lib/config';
import { shortAddr } from '../lib/format';
import { ChevronDown, ChevronUp, Plus, Trash } from './Icons';
import BackButton from './BackButton';
import BackupSection from './BackupSection';
import ListHeader from './ListHeader';
import Note from './Note';
import SectionHeader from './SectionHeader';
import { BTN_OUTLINE, BTN_PRIMARY, BTN_QUIET, FIELD_LABEL, ICON_BTN, INPUT, INPUT_MONO } from './formStyles';

const chainIds = READ_CHAIN_IDS;

const readLists = () => Object.fromEntries(chainIds.map((id) => [id, getRpcUrls(id)]));

/**
 * Settings page (/settings): each chain's ordered RPC endpoints, the
 * rescan delay, backup and restore. Endpoints are
 * tried top-down and the reader falls back to the next when one fails,
 * so order is the setting — hence move-up / move-down rather than a
 * single URL field. Saving takes effect at once, without a reload: even a
 * scan already running moves to the new endpoints at its next request.
 */
export default function SettingsPage({ navigate }) {
  const rpcVersion = useRpcVersion();
  const [lists, setLists] = useState(() => readLists());
  const [drafts, setDrafts] = useState(() => Object.fromEntries(chainIds.map((id) => [id, ''])));
  const [rescanDelay, setRescanDelay] = useState(String(getRescanDelayMs() / 60_000));
  const [dirty, setDirty] = useState(false);

  // Stored lists changed underneath (a save, a reset, a restored file):
  // show what is stored.
  useEffect(() => {
    setLists(readLists());
    setRescanDelay(String(getRescanDelayMs() / 60_000));
    setDirty(false);
  }, [rpcVersion]);

  const edit = (id, next) => {
    setLists((cur) => ({ ...cur, [id]: next }));
    setDirty(true);
  };

  const move = (id, i, delta) => {
    const list = [...(lists[id] ?? [])];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    edit(id, list);
  };

  const remove = (id, i) => edit(id, (lists[id] ?? []).filter((_, k) => k !== i));

  const add = (id) => {
    const url = (drafts[id] || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url) || (lists[id] ?? []).includes(url)) return;
    edit(id, [...(lists[id] ?? []), url]);
    setDrafts((cur) => ({ ...cur, [id]: '' }));
  };

  const handleSave = () => {
    saveRescanDelay(rescanDelay.trim() === '' ? null : Number(rescanDelay));
    for (const id of chainIds) saveRpcUrls(id, lists[id] ?? []);
    navigate({});
  };

  return (
    <div>
      <div className="mb-8">
        <BackButton onClick={() => navigate({})} />
      </div>

      <ListHeader title="设置" subtitle={hasOverrides() ? '已自定义' : '使用默认配置'} />

      <Note className="mb-8 max-w-2xl">
        合约通过 CREATE2 部署，在每条链上都是同一个地址（{shortAddr(GLYPH_ADDRESS)}），
        所以两条链读的是同一本刊物：首页把两条链上的文章按时间合在一起。每条链可以配置多个 RPC 节点：
        按顺序使用第一个，失败时自动回退到下一个。保存后立即生效，不刷新页面；正在进行的扫描会从下一次请求起使用新的节点。
      </Note>

      {chainIds.map((id) => {
        const chain = CHAINS[id];
        const list = lists[id] ?? [];
        return (
          <section key={id} className="mb-10">
            <SectionHeader label={`${chain?.name ?? `链 ${id}`} · ${id}`} />

            {list.length === 0 ? (
              <Note className="mb-3">没有节点，保存后将使用内置默认节点。</Note>
            ) : (
              <ol className="mb-3 divide-y divide-edge border-y border-edge">
                {list.map((url, i) => (
                  <li key={`${url}-${i}`} className="flex items-center gap-2 py-2">
                    <span className="w-6 shrink-0 text-center text-2xs tabular-nums text-ink-ghost">{i + 1}</span>
                    <span
                      title={url}
                      className={`min-w-0 flex-1 truncate font-mono text-xs ${i === 0 ? 'text-ink-soft' : 'text-ink-faint'}`}
                    >
                      {url}
                    </span>
                    {i === 0 && <span className="shrink-0 text-2xs text-ink-faint">优先</span>}
                    <button
                      type="button"
                      onClick={() => move(id, i, -1)}
                      disabled={i === 0}
                      aria-label={`将第 ${i + 1} 个节点上移`}
                      className={ICON_BTN}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(id, i, 1)}
                      disabled={i === list.length - 1}
                      aria-label={`将第 ${i + 1} 个节点下移`}
                      className={ICON_BTN}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(id, i)}
                      aria-label={`删除第 ${i + 1} 个节点`}
                      className={ICON_BTN}
                    >
                      <Trash size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex items-center gap-2">
              <input
                type="url"
                inputMode="url"
                value={drafts[id] ?? ''}
                onChange={(e) => setDrafts((cur) => ({ ...cur, [id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(id);
                  }
                }}
                placeholder="https://你的节点地址"
                aria-label={`为 ${chain?.name ?? id} 添加 RPC 节点`}
                className={INPUT_MONO}
              />
              <button type="button" onClick={() => add(id)} className={`${BTN_OUTLINE} shrink-0 px-3`}>
                <Plus size={15} />
                添加
              </button>
            </div>
            {hasCustomRpcs(id) && (
              <button
                type="button"
                onClick={() => edit(id, defaultRpcs(id))}
                className="mt-2 text-xs text-ink-faint hover:text-accent transition-colors"
              >
                恢复此链的默认节点
              </button>
            )}
          </section>
        );
      })}

      <section className="mb-10">
        <SectionHeader label="扫描频率" />
        <label className="block max-w-xs">
          <span className={FIELD_LABEL}>区块链扫描延迟（分钟）</span>
          <input
            type="number"
            min="0"
            step="1"
            value={rescanDelay}
            onChange={(e) => {
              setRescanDelay(e.target.value);
              setDirty(true);
            }}
            className={`${INPUT} tabular-nums`}
          />
        </label>
        <Note className="mt-2 max-w-2xl">
          上一次扫描结束后的 N 分钟内，重新打开首页或作者页只显示上次扫到的文章，不再向节点请求新区块；
          超过之后，下次打开会补扫这段时间新产生的区块。0 = 每次都扫。默认 1 分钟。
          这只决定「什么时候去读新区块」，不会漏掉任何文章：已经读到的内容是永久缓存的——链上数据不会改变，同一篇文章不会被重复请求。
        </Note>
      </section>

      <BackupSection />

      <div className="flex items-center justify-between gap-3 border-t border-edge pt-6">
        <button type="button" onClick={() => resetEndpointConfig()} className={BTN_QUIET}>
          恢复默认
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate({})} className={BTN_QUIET}>
            取消
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty} className={BTN_PRIMARY}>
            保存
          </button>
        </div>
      </div>

      <Note className="mt-8">
        节点列表保存在本机浏览器（localStorage）。已扫描的区块范围、正文与图片缓存都按链分别保存，互不污染。
      </Note>
    </div>
  );
}
