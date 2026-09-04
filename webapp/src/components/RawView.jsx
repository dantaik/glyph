import { chainName, fmtBlock, fmtBytes, shortAddr } from '../lib/format';
import { t } from '../lib/i18n';
import { Micro } from './Text';

/**
 * The post exactly as the chain holds it: the decompressed document,
 * front-matter and all, in a monospace block, under a line of provenance.
 *
 * The whole design rests on the claim that what is stored is plain,
 * human-readable Markdown that any editor will open decades from now. This is
 * where that claim stops being a claim: the bytes are right there, with what
 * they cost to store and the transaction they live in.
 */
export default function RawView({ text, compressedBytes, block, txHash, chainId }) {
  const decompressed = new TextEncoder().encode(text ?? '').length;
  const ratio = compressedBytes && decompressed ? decompressed / compressedBytes : null;

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
