import { useEffect, useState } from 'react';
import { defaultRpcs } from '../lib/chains';
import { GLYPH_ADDRESS, READ_CHAIN_IDS, getRescanDelayMs, getRpcUrls, hasCustomRpcs, hasOverrides, resetEndpointConfig, saveRescanDelay, saveRpcUrls, useRpcVersion } from '../lib/config';
import { chainName, shortAddr } from '../lib/format';
import { LANGS, LANG_NAMES, setLang, useLang, useT } from '../lib/i18n';
import { ChevronDown, ChevronUp, Plus, Trash } from './Icons';
import BackButton from './BackButton';
import BackupSection from './BackupSection';
import FollowingSection from './FollowingSection';
import ListHeader from './ListHeader';
import SectionHeader from './SectionHeader';
import { Micro, Note } from './Text';
import { BTN_OUTLINE, BTN_PRIMARY, BTN_QUIET, FIELD_LABEL, ICON_BTN, INPUT, SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON } from './formStyles';

const chainIds = READ_CHAIN_IDS;

const readLists = () => Object.fromEntries(chainIds.map((id) => [id, getRpcUrls(id)]));

/**
 * Settings page (/settings): each chain's ordered RPC endpoints, the
 * rescan delay, the interface language, backup and restore. Endpoints are
 * tried top-down and the reader falls back to the next when one fails,
 * so order is the setting — hence move-up / move-down rather than a
 * single URL field. Saving takes effect at once, without a reload: even a
 * scan already running moves to the new endpoints at its next request.
 */
export default function SettingsPage({ navigate }) {
  const t = useT();
  const lang = useLang();
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

      <ListHeader
        title={t('settings.title')}
        subtitle={hasOverrides() ? t('settings.customized') : t('settings.defaults')}
      />

      <Note className="mb-8 max-w-2xl">{t('settings.intro', { address: shortAddr(GLYPH_ADDRESS) })}</Note>

      <section className="mb-10">
        <SectionHeader label={t('settings.languageHeading')} />
        <div role="group" aria-label={t('settings.languageLabel')} className={SEGMENT_GROUP}>
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              aria-pressed={code === lang}
              className={code === lang ? SEGMENT_ON : SEGMENT_OFF}
            >
              {LANG_NAMES[code]}
            </button>
          ))}
        </div>
        <Note className="mt-2 max-w-2xl">{t('settings.languageNote')}</Note>
      </section>

      {chainIds.map((id) => {
        const name = chainName(id);
        const list = lists[id] ?? [];
        return (
          <section key={id} className="mb-10">
            <SectionHeader label={t('settings.chainLabel', { chain: name, id })} />

            {list.length === 0 ? (
              <Note className="mb-3">{t('settings.noEndpoints')}</Note>
            ) : (
              <ol className="mb-3 divide-y divide-edge border-y border-edge">
                {list.map((url, i) => (
                  <li key={`${url}-${i}`} className="flex items-center gap-2 py-2">
                    <Micro as="span" nums className="w-6 shrink-0 text-center text-ink-ghost">
                      {i + 1}
                    </Micro>
                    <span
                      title={url}
                      className={`min-w-0 flex-1 truncate text-xs ${i === 0 ? 'text-ink-soft' : 'text-ink-faint'}`}
                    >
                      {url}
                    </span>
                    {i === 0 && (
                      <Micro as="span" className="shrink-0">
                        {t('settings.primary')}
                      </Micro>
                    )}
                    <button
                      type="button"
                      onClick={() => move(id, i, -1)}
                      disabled={i === 0}
                      aria-label={t('settings.moveUp', { position: i + 1 })}
                      className={ICON_BTN}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(id, i, 1)}
                      disabled={i === list.length - 1}
                      aria-label={t('settings.moveDown', { position: i + 1 })}
                      className={ICON_BTN}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(id, i)}
                      aria-label={t('settings.removeEndpoint', { position: i + 1 })}
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
                placeholder={t('settings.endpointPlaceholder')}
                aria-label={t('settings.addEndpointFor', { chain: name })}
                className={INPUT}
              />
              <button type="button" onClick={() => add(id)} className={`${BTN_OUTLINE} shrink-0 px-3`}>
                <Plus size={15} />
                {t('common.add')}
              </button>
            </div>
            {hasCustomRpcs(id) && (
              <button
                type="button"
                onClick={() => edit(id, defaultRpcs(id))}
                className="mt-2 text-xs text-ink-faint hover:text-accent transition-colors"
              >
                {t('settings.restoreChainDefaults')}
              </button>
            )}
          </section>
        );
      })}

      <section className="mb-10">
        <SectionHeader label={t('settings.rescanHeading')} />
        <label className="block max-w-xs">
          <span className={FIELD_LABEL}>{t('settings.rescanLabel')}</span>
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
        <Note className="mt-2 max-w-2xl">{t('settings.rescanNote')}</Note>
      </section>

      <FollowingSection navigate={navigate} />

      <BackupSection />

      <div className="flex items-center justify-between gap-3 border-t border-edge pt-6">
        <button type="button" onClick={() => resetEndpointConfig()} className={BTN_QUIET}>
          {t('settings.resetAll')}
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate({})} className={BTN_QUIET}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleSave} disabled={!dirty} className={BTN_PRIMARY}>
            {t('common.save')}
          </button>
        </div>
      </div>

      <Note className="mt-8">{t('settings.storageNote')}</Note>
    </div>
  );
}
