import { useEffect, useMemo, useRef, useState } from 'react';
import { XUENI_ADDRESS, isReadChain } from '../lib/config';
import { chainName, etherscanTxUrl, fmtAbsTime, shortAddr } from '../lib/format';
import { hookInfo } from '../lib/hookRegistry';
import { useT } from '../lib/i18n';
import { fmtEth } from '../lib/price';
import { relayTicket } from '../lib/publish';
import { parseTicket, signatureKind, ticketExpired } from '../lib/relay';
import { BTN_OUTLINE, BTN_PRIMARY } from './formStyles';
import { AlertCircle, Check, ExternalLink } from './Icons';
import { Meta, Note } from './Text';

/**
 * Relay a post somebody else signed: paste the ticket (or open its file),
 * see what it is, send it. The connected wallet pays; the post is recorded
 * under the author who signed it. The ticket is checked for shape, for the
 * chain and contract this build knows, for its deadline, and — where the
 * signature is not the 64 or 65 bytes a wallet key makes — for the author
 * being a contract account, since only one of those can have made it. Nothing
 * in the ticket can be altered here, because the signature covers all of it.
 *
 * Props: { chainId (the publish target), reader (the target chain's, for the
 *          code check), disabled }
 */
export default function RelayPanel({ chainId, reader = null, disabled = false }) {
  const t = useT();
  const [text, setText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [message, setMessage] = useState('');
  const [txHash, setTxHash] = useState(null);
  const fileInput = useRef(null);

  const parsed = useMemo(() => (text.trim() ? parseTicket(text) : null), [text]);
  const ticket = parsed?.ticket ?? null;

  // A signature of another length than a wallet's is a contract account's
  // or nobody's; the chain says which. `undefined` = asking, `null` = could
  // not ask (the contract is the judge then), boolean = the answer.
  const contractSigned = Boolean(ticket) && signatureKind(ticket.signature) === 'contract';
  const [authorHasCode, setAuthorHasCode] = useState(undefined);
  useEffect(() => {
    if (!contractSigned) return undefined;
    let cancelled = false;
    setAuthorHasCode(undefined);
    Promise.resolve(reader?.hasCode ? reader.hasCode(ticket.author) : null)
      .then((code) => !cancelled && setAuthorHasCode(code == null ? null : Boolean(code)))
      .catch(() => !cancelled && setAuthorHasCode(null));
    return () => {
      cancelled = true;
    };
  }, [contractSigned, reader, ticket?.author]);

  // What the parser cannot know: which chains and contracts this app reads,
  // and who the author is.
  const problems = useMemo(() => {
    if (!parsed) return [];
    const out = parsed.problems.map((p) => {
      if (p.code === 'badField') return t('relay.badField', { field: p.field });
      if (p.code === 'wrongFormat') return t('relay.wrongFormat', { format: p.format });
      return t(`relay.${p.code}`);
    });
    if (!ticket) return out;
    if (!isReadChain(ticket.chainId)) out.push(t('relay.unknownChain', { id: ticket.chainId }));
    else if (ticket.contract !== String(XUENI_ADDRESS).toLowerCase()) {
      out.push(t('relay.wrongContract', { contract: ticket.contract }));
    }
    if (ticketExpired(ticket)) out.push(t('relay.expired'));
    if (contractSigned && authorHasCode === false) {
      out.push(t('relay.signatureShape', { bytes: (ticket.signature.length - 2) / 2 }));
    }
    return out;
  }, [parsed, ticket, t, contractSigned, authorHasCode]);

  const wrongChain = ticket && isReadChain(ticket.chainId) && Number(ticket.chainId) !== Number(chainId);
  const checking = contractSigned && authorHasCode === undefined;
  const canSend = Boolean(ticket) && problems.length === 0 && !wrongChain && !checking && status !== 'sending' && !disabled;

  const openFile = async (file) => {
    if (!file) return;
    setText(await file.text());
    setStatus('idle');
  };

  const send = async () => {
    try {
      setStatus('sending');
      setMessage('');
      const hash = await relayTicket(ticket, { chainId });
      setTxHash(hash);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setMessage(err?.message || t('relay.failed'));
    }
  };

  return (
    <details className="rounded-lg border border-edge bg-paper-raised px-4 py-3" data-relay-panel="">
      <summary className="cursor-pointer select-none text-sm text-ink-soft marker:text-ink-ghost">
        {t('relay.heading')}
      </summary>
      <Note className="mt-2">{t('relay.note')}</Note>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
        disabled={disabled || status === 'sending'}
        rows={6}
        placeholder={t('relay.paste')}
        aria-label={t('relay.paste')}
        className="mt-3 w-full rounded-lg border border-edge-strong bg-paper px-3 py-2 font-mono text-2xs placeholder:text-ink-ghost focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label={t('relay.pickFile')}
          className="hidden"
          onChange={(e) => {
            openFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled} className={BTN_OUTLINE}>
          {t('relay.import')}
        </button>
      </div>

      {ticket && problems.length === 0 && (
        <Meta as="div" nums className="mt-3 space-y-1" data-relay-summary="">
          <div>
            {t('relay.summary', {
              title: ticket.titleText || t('common.untitled'),
              author: shortAddr(ticket.author),
              chain: chainName(ticket.chainId),
            })}
          </div>
          <div>
            {t('relay.indexNote', { index: ticket.index + 1 })}
            <span className="select-none" aria-hidden="true"> · </span>
            {t('relay.deadline', { when: fmtAbsTime(ticket.deadline) })}
            {ticket.hook && (
              <>
                <span className="select-none" aria-hidden="true"> · </span>
                {t('relay.hookNote', { hook: hookInfo(ticket.hook).name ?? shortAddr(ticket.hook) })}
              </>
            )}
            {BigInt(ticket.value ?? 0) > 0n && (
              <>
                <span className="select-none" aria-hidden="true"> · </span>
                {t('relay.valueNote', { eth: fmtEth(Number(BigInt(ticket.value)) / 1e18) })}
              </>
            )}
          </div>
          {wrongChain && <div className="text-danger">{t('relay.wrongChain', { chain: chainName(ticket.chainId) })}</div>}
          {contractSigned && authorHasCode === true && <div>{t('relay.contractSigned')}</div>}
          {checking && <div data-relay-checking="">{t('relay.checkingAuthor')}</div>}
        </Meta>
      )}

      {problems.length > 0 && (
        <div role="alert" className="mt-3 space-y-1 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger">
          {problems.map((p) => (
            <div key={p} className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="break-all">{p}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <button type="button" onClick={send} disabled={!canSend} className={BTN_PRIMARY}>
          {status === 'sending' && (
            <span className="h-4 w-4 rounded-full border-2 border-edge-strong border-t-accent animate-spin" aria-hidden="true" />
          )}
          {status === 'sending' ? t('relay.sending') : t('relay.send')}
        </button>
      </div>

      {status === 'error' && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="break-all">{message}</span>
        </div>
      )}

      {status === 'done' && txHash && (
        <div className="mt-3 rounded-lg bg-success-wash px-4 py-3 text-sm text-success" data-relay-sent="">
          <div className="flex flex-wrap items-center gap-2">
            <Check size={16} className="shrink-0" />
            <span className="font-medium">{t('relay.sent', { chain: chainName(chainId) })}</span>
            <a
              href={etherscanTxUrl(txHash, chainId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-accent transition-colors"
            >
              {txHash.slice(0, 10)}…
              <ExternalLink size={12} />
            </a>
          </div>
          <p className="mt-1 text-xs">{t('publish.waitForBlock')}</p>
        </div>
      )}
    </details>
  );
}
