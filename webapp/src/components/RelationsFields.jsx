import { useEffect, useState } from 'react';
import { isReadChain } from '../lib/config';
import { getReader } from '../lib/data';
import { chainName, fmtTitle } from '../lib/format';
import { parsePostRef } from '../lib/glyphRefs';
import { useT } from '../lib/i18n';
import { FIELD_LABEL, INPUT } from './formStyles';
import { Meta, Note } from './Text';

/** The three fields that name another post. */
const REFERENCE_FIELDS = ['re', 'supersedes', 'prev'];

/**
 * What a post says about other posts: a reply, a replacement, a continuation,
 * a series — and the language it is written in.
 *
 * All of it goes into the payload's front-matter, which the spec already
 * names as the extensibility mechanism: a reader that does not know a key
 * ignores it, so nothing here can break an older reader or the contract.
 *
 * Folded away by default. Most letters are not replies, and a form that
 * greets every writer with six empty boxes is a worse form.
 *
 * Props: { meta, onChange, chainId, disabled }
 */
export default function RelationsFields({ meta, onChange, chainId, disabled = false }) {
  const t = useT();
  const set = (key, value) => onChange({ ...meta, [key]: value });
  const filled = Object.values(meta ?? {}).some((v) => String(v ?? '').trim() !== '');

  return (
    <details open={filled} className="rounded-lg border border-edge bg-paper-raised px-4 py-3" data-relations-fields="">
      <summary className="cursor-pointer select-none text-sm text-ink-soft marker:text-ink-ghost">
        {t('relations.heading')}
      </summary>
      <Note className="mt-2">{t('relations.note')}</Note>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REFERENCE_FIELDS.map((key) => (
          <ReferenceField
            key={key}
            name={key}
            value={meta?.[key] ?? ''}
            onChange={(v) => set(key, v)}
            chainId={chainId}
            disabled={disabled}
          />
        ))}

        <label className="block">
          <span className={FIELD_LABEL}>{t('relations.series')}</span>
          <input
            type="text"
            maxLength={64}
            value={meta?.series ?? ''}
            onChange={(e) => set('series', e.target.value)}
            disabled={disabled}
            placeholder={t('relations.seriesPlaceholder')}
            className={INPUT}
          />
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t('relations.part')}</span>
          <input
            type="number"
            min="1"
            step="1"
            value={meta?.part ?? ''}
            onChange={(e) => set('part', e.target.value)}
            disabled={disabled}
            className={`${INPUT} tabular-nums`}
          />
          {meta?.part && !meta?.series && <Meta className="mt-1">{t('relations.partNeedsSeries')}</Meta>}
        </label>

        <label className="block">
          <span className={FIELD_LABEL}>{t('relations.language')}</span>
          <input
            type="text"
            list="glyph-langs"
            value={meta?.lang ?? ''}
            onChange={(e) => set('lang', e.target.value)}
            disabled={disabled}
            placeholder={t('relations.languagePlaceholder')}
            className={INPUT}
          />
          <datalist id="glyph-langs">
            <option value="en" />
            <option value="zh" />
          </datalist>
        </label>
      </div>
    </details>
  );
}

/**
 * One field naming another post. Whatever is typed — a bare transaction hash,
 * a `taiko:0x…/1`, or a link copied from the address bar — is read as a
 * reference, and the post it names is looked up so the writer can see they
 * pointed at the right letter.
 */
function ReferenceField({ name, value, onChange, chainId, disabled }) {
  const t = useT();
  const ref = parsePostRef(value, chainId);
  const [title, setTitle] = useState(undefined); // undefined: not looked up

  useEffect(() => {
    if (!ref || !isReadChain(ref.chainId)) {
      setTitle(undefined);
      return undefined;
    }
    let cancelled = false;
    setTitle(undefined);
    getReader(ref.chainId)
      .findMetaByTx(ref.txHash, ref.eventIndex)
      .then((meta) => !cancelled && setTitle(meta ? (fmtTitle(meta.title) ?? '') : null))
      .catch(() => !cancelled && setTitle(null));
    return () => {
      cancelled = true;
    };
    // The reference itself is the dependency, not the object around it.
  }, [ref?.chainId, ref?.txHash, ref?.eventIndex]);

  const invalid = value.trim() !== '' && !ref;

  return (
    <label className="block">
      <span className={FIELD_LABEL}>{t(`relations.${name}`)}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={t('relations.refPlaceholder')}
        aria-invalid={invalid}
        className={`${INPUT} ${invalid ? 'border-danger' : ''}`}
      />
      {invalid && <Meta className="mt-1 text-danger">{t('relations.invalidRef')}</Meta>}
      {!invalid && ref && title === null && <Meta className="mt-1 text-danger">{t('relations.noSuchPost')}</Meta>}
      {!invalid && ref && typeof title === 'string' && (
        <Meta className="mt-1">
          {title || t('common.untitled')}
          {ref.chainId !== chainId ? ` · ${chainName(ref.chainId)}` : ''}
        </Meta>
      )}
    </label>
  );
}
