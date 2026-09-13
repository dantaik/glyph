import { chainName, fmtAbsTime, fmtBlock, fmtBytes, shortAddr } from '../lib/format';
import { t } from '../lib/i18n';
import { Micro } from './Text';

/** The three calls a post can arrive by, as their signatures. */
const CALL_SIGNATURES = {
  publish: 'publish(bytes32,bytes)',
  publishWithHook: 'publish(bytes32,bytes,address,bytes)',
  publishFor: 'publishFor(address,bytes32,bytes,address,bytes,uint256,bytes)',
};

const hexBytes = (hex) => (hex && hex !== '0x' ? (hex.length - 2) / 2 : 0);

/**
 * The post exactly as the chain holds it: the decompressed document,
 * front-matter and all, in a monospace block, under a line of provenance.
 *
 * The whole design rests on the claim that what is stored is plain,
 * human-readable Markdown that any editor will open decades from now. This is
 * where that claim stops being a claim: the bytes are right there, with what
 * they cost to store and the transaction they live in.
 *
 * `call` is what the transaction's calldata says beyond the document (the
 * body record from chainIO): which call carried the post, the hook and its
 * data, and for a relayed post the signer, the sender, the deadline and the
 * signature. A plain v1 post has nothing to add and shows nothing extra.
 */
export default function RawView({ text, compressedBytes, block, txHash, chainId, call = null }) {
  const decompressed = new TextEncoder().encode(text ?? '').length;
  const ratio = compressedBytes && decompressed ? decompressed / compressedBytes : null;
  const form = call?.form ?? 'publish';
  const hookData = call?.hookData && call.hookData !== '0x' ? call.hookData : null;
  const relayed = call?.relayed ?? null;
  const detailed = form !== 'publish' || Boolean(call?.hook);

  return (
    <section className="article-column mt-10" data-raw-view="">
      <Micro nums className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>{t('raw.compressed', { bytes: fmtBytes(compressedBytes) })}</span>
        <Dot />
        <span>{t('raw.decompressed', { bytes: fmtBytes(decompressed) })}</span>
        {ratio && (
          <>
            <Dot />
            <span>{t('raw.ratio', { ratio: ratio.toFixed(1) })}</span>
          </>
        )}
        <Dot />
        <span>{chainName(chainId)}</span>
        <Dot />
        <span>{t('post.block', { block: fmtBlock(block) })}</span>
        <Dot />
        <span title={txHash}>{shortAddr(txHash)}</span>
      </Micro>
      {detailed && (
        <Micro nums className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1" data-raw-call={form}>
          <span>{t('raw.call', { call: CALL_SIGNATURES[form] ?? form })}</span>
          {call?.hook && (
            <>
              <Dot />
              <span title={call.hook}>{t('raw.hook', { hook: shortAddr(call.hook) })}</span>
            </>
          )}
          {hookData && (
            <>
              <Dot />
              <span>{t('raw.hookData', { bytes: fmtBytes(hexBytes(hookData)) })}</span>
            </>
          )}
          {relayed && (
            <>
              <Dot />
              <span>{t('raw.relayed', { author: shortAddr(relayed.author), sender: shortAddr(call.sender ?? '') })}</span>
              <Dot />
              <span>{t('raw.deadline', { when: fmtAbsTime(relayed.deadline) ?? relayed.deadline })}</span>
            </>
          )}
        </Micro>
      )}
      {(hookData || relayed) && (
        <Micro as="pre" className="mb-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-edge bg-paper-sunken p-3 leading-relaxed" data-raw-call-bytes="">
          {hookData ? `${t('raw.hookDataHex')}: ${hookData}\n` : ''}
          {relayed ? `${t('raw.signature')}: ${relayed.signature}` : ''}
        </Micro>
      )}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-edge bg-paper-sunken p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </section>
  );
}

function Dot() {
  return (
    <span className="select-none" aria-hidden="true">
      ·
    </span>
  );
}
