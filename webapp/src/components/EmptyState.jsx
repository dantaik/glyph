import { BTN_OUTLINE_PILL } from './formStyles';
import { GeeseMark, AlertCircle } from './Icons';
import { Body, Meta, Micro, Title } from './Text';
import { t } from '../lib/i18n';

/**
 * Centered empty/error placeholder. Error states (tone=danger) show a
 * friendly summary plus the raw technical message in a collapsible
 * <details> block instead of dumping it into the layout.
 */
export default function EmptyState({ title, body, actionLabel, onAction, tone, detail }) {
  const danger = tone === 'danger';
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      {danger ? (
        <AlertCircle size={36} className="mx-auto text-danger" />
      ) : (
        <GeeseMark size={168} className="mx-auto text-ink-ghost/50" />
      )}
      <Title className="mt-5">{title}</Title>
      {body && (
        <Body className="mt-2 leading-relaxed">{body}</Body>
      )}
      {danger && detail && (
        <details className="mt-4 text-left">
          <Meta as="summary" className="cursor-pointer select-none hover:text-accent transition-colors">
            {t('common.technicalDetails')}
          </Meta>
          <Micro as="pre" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper-sunken p-3 leading-relaxed">
            {detail}
          </Micro>
        </details>
      )}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className={`mt-6 ${BTN_OUTLINE_PILL}`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
