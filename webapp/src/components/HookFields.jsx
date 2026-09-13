import { MULTI_HOOK_ADDRESS } from '../lib/config';
import { hookInfo, resolveHookConfig } from '../lib/hookRegistry';
import { useT } from '../lib/i18n';
import { shortAddr } from '../lib/format';
import { FIELD_LABEL, ICON_BTN, INPUT, SEGMENT_GROUP, SEGMENT_OFF, SEGMENT_ON } from './formStyles';
import { Close } from './Icons';
import { Meta, Note } from './Text';

const MODES = ['none', 'single', 'multi'];

/**
 * Which hook a post goes through, if any: none, one (an address, its data
 * and the ETH to send along), or several, packed into the fan-out that is
 * deployed beside the v2 contract.
 *
 * Folded away by default, like the relations: most letters go through no
 * hook, and a hook is something an author reaches for on purpose.
 *
 * Props: { config, onChange, disabled }  — config from hookRegistry.emptyHookConfig()
 */
export default function HookFields({ config, onChange, disabled = false }) {
  const t = useT();
  const set = (patch) => onChange({ ...config, ...patch });
  const resolved = resolveHookConfig(config);
  const problem = (code, position) => resolved.problems.find((p) => p.code === code && p.position === position);

  const setEntry = (i, patch) =>
    set({ entries: config.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const addEntry = () => set({ entries: [...config.entries, { address: '', data: '', value: '' }] });
  const removeEntry = (i) => set({ entries: config.entries.filter((_, j) => j !== i) });

  return (
    <details open={config.mode !== 'none'} className="rounded-lg border border-edge bg-paper-raised px-4 py-3" data-hook-fields="">
      <summary className="cursor-pointer select-none text-sm text-ink-soft marker:text-ink-ghost">
        {t('hooks.heading')}
      </summary>
      <Note className="mt-2">{t('hooks.note')}</Note>

      <div role="group" aria-label={t('hooks.mode')} className={`${SEGMENT_GROUP} mt-4`}>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => set({ mode })}
            aria-pressed={config.mode === mode}
            disabled={disabled}
            className={config.mode === mode ? SEGMENT_ON : SEGMENT_OFF}
          >
            {t(`hooks.${mode}`)}
          </button>
        ))}
      </div>

      {config.mode === 'single' && (
        <div className="mt-4">
          <Entry
            entry={config}
            position={1}
            onChange={(patch) => set(patch)}
            disabled={disabled}
            problem={problem}
          />
        </div>
      )}

      {config.mode === 'multi' && (
        <div className="mt-4 space-y-4" data-hook-entries="">
          <Note>{t('hooks.multiNote', { address: shortAddr(MULTI_HOOK_ADDRESS) })}</Note>
          {config.entries.map((entry, i) => (
            <div key={i} className="rounded-lg border border-edge px-3 py-3" data-hook-entry={i + 1}>
              <div className="mb-2 flex items-center justify-between">
                <Meta as="span">{t('hooks.entry', { position: i + 1 })}</Meta>
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  disabled={disabled || config.entries.length <= 1}
                  aria-label={t('hooks.removeHook', { position: i + 1 })}
                  className={ICON_BTN}
                >
                  <Close size={14} />
                </button>
              </div>
              <Entry
                entry={entry}
                position={i + 1}
                onChange={(patch) => setEntry(i, patch)}
                disabled={disabled}
                problem={problem}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addEntry}
            disabled={disabled}
            className="text-xs text-accent underline-offset-4 hover:underline disabled:opacity-40"
          >
            {t('hooks.addHook')}
          </button>
          {problem('noHooks', 0) && <Meta className="text-danger">{t('hooks.noHooks')}</Meta>}
        </div>
      )}
    </details>
  );
}

/**
 * One field of a hook entry. The message lives beside the label rather
 * than inside it, so the field is still found by its name once it has
 * something to say.
 */
function Field({ label, message, note, children }) {
  return (
    <div>
      <label className="block">
        <span className={FIELD_LABEL}>{label}</span>
        {children}
      </label>
      {message && <Meta className="mt-1 text-danger">{message}</Meta>}
      {note && <Meta className="mt-1">{note}</Meta>}
    </div>
  );
}

/** One hook: its address, its data, the ETH to send it. */
function Entry({ entry, position, onChange, disabled, problem }) {
  const t = useT();
  const info = entry.address ? hookInfo(entry.address) : null;
  const badAddress = Boolean(problem('invalidAddress', position) && entry.address);
  const badHex = Boolean(problem('invalidHex', position));
  const badValue = Boolean(problem('invalidValue', position));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field
          label={t('hooks.address')}
          message={badAddress ? t('hooks.invalidAddress', { position }) : null}
          note={info?.known ? t('hooks.known', { name: info.name }) : null}
        >
          <input
            type="text"
            value={entry.address ?? ''}
            onChange={(e) => onChange({ address: e.target.value })}
            disabled={disabled}
            placeholder="0x…"
            aria-invalid={badAddress}
            className={`${INPUT} ${badAddress ? 'border-danger' : ''}`}
          />
        </Field>
      </div>
      <Field label={t('hooks.data')} message={badHex ? t('hooks.invalidHex', { position }) : null}>
        <input
          type="text"
          value={entry.data ?? ''}
          onChange={(e) => onChange({ data: e.target.value })}
          disabled={disabled}
          placeholder="0x"
          aria-invalid={badHex}
          className={`${INPUT} ${badHex ? 'border-danger' : ''}`}
        />
      </Field>
      <Field label={t('hooks.value')} message={badValue ? t('hooks.invalidValue', { position }) : null}>
        <input
          type="text"
          inputMode="decimal"
          value={entry.value ?? ''}
          onChange={(e) => onChange({ value: e.target.value })}
          disabled={disabled}
          placeholder="0"
          aria-invalid={badValue}
          className={`${INPUT} tabular-nums ${badValue ? 'border-danger' : ''}`}
        />
      </Field>
    </div>
  );
}
