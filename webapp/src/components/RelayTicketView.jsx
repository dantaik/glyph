import { useState } from 'react';
import { downloadText } from '../lib/download';
import { chainName } from '../lib/format';
import { useT } from '../lib/i18n';
import { serializeTicket, ticketFileName } from '../lib/relay';
import { BTN_OUTLINE, BTN_QUIET } from './formStyles';
import { Check } from './Icons';
import { Note } from './Text';

/**
 * A post the author has signed for somebody else to send: the ticket as
 * text, to copy or to save. It is data — nothing here is sent, and nothing
 * in it is secret, since the signature is good for this one post alone.
 *
 * Props: { ticket, chainId, onDone }
 */
export default function RelayTicketView({ ticket, chainId, onDone }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = serializeTicket(ticket);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard here — the text is selectable below */
    }
  };

  return (
    <div className="mt-4 rounded-lg bg-success-wash px-4 py-3 text-sm text-success" data-relay-ticket="">
      <div className="flex flex-wrap items-center gap-2">
        <Check size={16} className="shrink-0" />
        <span className="font-medium">{t('relay.ticketHeading')}</span>
      </div>
      <p className="mt-1 text-xs">{t('relay.ticketNote', { index: ticket.index + 1, chain: chainName(chainId) })}</p>
      <textarea
        readOnly
        value={text}
        rows={8}
        aria-label={t('relay.ticketHeading')}
        onFocus={(e) => e.target.select()}
        className="mt-3 w-full rounded-lg border border-edge bg-paper px-3 py-2 font-mono text-2xs text-ink-soft"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={BTN_OUTLINE}>
          {copied ? t('relay.copied') : t('relay.copy')}
        </button>
        <button
          type="button"
          onClick={() => downloadText(ticketFileName(ticket), text, 'application/json;charset=utf-8')}
          className={BTN_OUTLINE}
        >
          {t('relay.download')}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className={BTN_QUIET}>
            {t('publish.writeAnother')}
          </button>
        )}
      </div>
      <Note className="mt-2 text-success">{t('publish.permanentNotice')}</Note>
    </div>
  );
}
