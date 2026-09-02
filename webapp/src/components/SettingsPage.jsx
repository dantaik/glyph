import { useState } from 'react';
import { CHAINS, SELECTABLE_CHAIN_IDS, defaultRpcs } from '../lib/chains';
import {
  CHAIN_ID,
  GLYPH_ADDRESS,
  getCacheTtlMs,
  getRpcUrls,
  hasCustomRpcs,
  hasOverrides,
  resetEndpointConfig,
  saveCacheTtl,
  saveRpcUrls,
  setActiveChain,
} from '../lib/config';
import { shortAddr } from '../lib/format';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Plus, Trash } from './Icons';
import ListHeader from './ListHeader';
import SectionHeader from './SectionHeader';

const INPUT =
  'w-full rounded-lg border border-edge-strong bg-paper px-3 py-2 font-mono text-sm placeholder:text-ink-ghost focus:border-accent focus:outline-none';
const BTN_QUIET =
  'rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-accent hover:bg-paper-sunken transition-colors';
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-paper hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-ghost hover:text-accent hover:bg-paper-sunken disabled:opacity-25 disabled:hover:text-ink-ghost disabled:hover:bg-transparent transition-colors';

const chainIds = SELECTABLE_CHAIN_IDS.includes(CHAIN_ID)
  ? SELECTABLE_CHAIN_IDS
  : [...SELECTABLE_CHAIN_IDS, CHAIN_ID];

/**
 * Settings page (/settings): the active chain, each chain's ordered RPC
 * endpoints, and the read-cache TTL. Endpoints are tried top-down and the
 * reader falls back to the next when one fails, so order is the setting —
 * hence move-up / move-down rather than a single URL field.
 */
export default function SettingsPage({ navigate }) {
  const [lists, setLists] = useState(() =>
    Object.fromEntries(chainIds.map((id) => [id, getRpcUrls(id)])),
  );
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(chainIds.map((id) => [id, ''])),
  );
  const [cacheTtl, setCacheTtl] = useState(String(getCacheTtlMs() / 60_000));
  const [saved, setSaved] = useState(false);

  const edit = (id, next) => {
    setLists((cur) => ({ ...cur, [id]: next }));
    setSaved(false);
  };

  const move = (id, i, delta) => {
    const list = [...lists[id]];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    edit(id, list);
  };

  const remove = (id, i) => edit(id, lists[id].filter((_, k) => k !== i));

  const add = (id) => {
    const url = (drafts[id] || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url) || lists[id].includes(url)) return;
    edit(id, [...lists[id], url]);
    setDrafts((cur) => ({ ...cur, [id]: '' }));
  };

  const handleSave = () => {
    saveCacheTtl(cacheTtl.trim() === '' ? null : Number(cacheTtl));
    // The active chain goes last: it reloads the page, and the others must
    // already be written by then.
    for (const id of chainIds.filter((x) => x !== CHAIN_ID)) {
      saveRpcUrls(id, lists[id], { reloadPage: false });
    }
    setSaved(true);
    saveRpcUrls(CHAIN_ID, lists[CHAIN_ID]);
  };

  return (
    <div>
      <div className="mb-8">
        <button
          type="button"
          onClick={() => navigate({})}
          className="-ml-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:text-accent hover:bg-paper-sunken transition-colors"
        >
          <ArrowLeft size={16} />
          返回
        </button>
      </div>

      <ListHeader
        title="设置"
        subtitle={hasOverrides() ? '已自定义' : '使用默认配置'}
      />

      <p className="mb-8 max-w-2xl text-xs leading-relaxed text-ink-ghost">
        合约通过 CREATE2 部署，在每条链上都是同一个地址（{shortAddr(GLYPH_ADDRESS)}），
        所以切换网络只是换一个节点去读。每条链可以配置多个 RPC 节点：按顺序使用第一个，
        失败时自动回退到下一个。保存后会刷新页面。
      </p>

      {chainIds.map((id) => {
        const chain = CHAINS[id];
        const list = lists[id] ?? [];
        const active = id === CHAIN_ID;
        return (
          <section key={id} className="mb-10">
            <SectionHeader
              label={`${chain?.name ?? `链 ${id}`} · ${id}`}
              right={
                active ? (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Check size={13} />
                    当前网络
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveChain(id)}
                    className="text-xs text-ink-faint hover:text-accent transition-colors"
                  >
                    切换到此网络
                  </button>
                )
              }
            />

            {list.length === 0 ? (
              <p className="mb-3 text-sm text-ink-ghost">
                没有节点，保存后将使用内置默认节点。
              </p>
            ) : (
              <ol className="mb-3 divide-y divide-edge border-y border-edge">
                {list.map((url, i) => (
                  <li key={`${url}-${i}`} className="flex items-center gap-2 py-2">
                    <span className="w-6 shrink-0 text-center font-mono text-2xs text-ink-ghost">
                      {i + 1}
                    </span>
                    <span
                      title={url}
                      className={`min-w-0 flex-1 truncate font-mono text-xs ${
                        i === 0 ? 'text-ink-soft' : 'text-ink-faint'
                      }`}
                    >
                      {url}
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 text-2xs text-ink-ghost">优先</span>
                    )}
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
                className={INPUT}
              />
              <button
                type="button"
                onClick={() => add(id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-edge-strong px-3 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors"
              >
                <Plus size={15} />
                添加
              </button>
            </div>
            {hasCustomRpcs(id) && (
              <button
                type="button"
                onClick={() => edit(id, defaultRpcs(id))}
                className="mt-2 text-xs text-ink-ghost hover:text-accent transition-colors"
              >
                恢复此链的默认节点
              </button>
            )}
          </section>
        );
      })}

      <section className="mb-10">
        <SectionHeader label="读取缓存" />
        <label className="block max-w-xs">
          <span className="mb-1.5 block text-xs tracking-label text-ink-faint">
            缓存时长（分钟）
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={cacheTtl}
            onChange={(e) => {
              setCacheTtl(e.target.value);
              setSaved(false);
            }}
            className={INPUT}
          />
          <span className="mt-1 block text-xs text-ink-faint">
            相同数据在 N 分钟内不重复请求；0 = 不缓存。默认 1 分钟。
          </span>
        </label>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-edge pt-6">
        <button type="button" onClick={resetEndpointConfig} className={BTN_QUIET}>
          恢复默认
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate({})} className={BTN_QUIET}>
            取消
          </button>
          <button type="button" onClick={handleSave} disabled={saved} className={BTN_PRIMARY}>
            {saved ? '正在刷新…' : '保存并刷新'}
          </button>
        </div>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-ink-ghost">
        节点列表保存在本机浏览器（localStorage）。已扫描的区块范围按链分别缓存，切换网络不会互相污染。
      </p>
    </div>
  );
}
