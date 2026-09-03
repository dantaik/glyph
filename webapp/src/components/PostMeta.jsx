import { Fragment } from 'react';
import { estimateBlockTime, fmtAbsTime, fmtRelTime } from '../lib/format';
import ChainChip from './ChainChip';

/**
 * The shared meta line for article rows and the featured entry:
 *
 *   [lead] · [chain] · [prefix] · [time]
 *
 * `lead` is e.g. the author link, `prefix` e.g. the post's ordinal. The
 * chain chip names the network the post was read on and links to that
 * network's view — unless the list is already filtered to it
 * (`currentChain`), when it is just a label. The time is exact when the
 * row carries its block's timestamp (`ts`), an estimate from the chain
 * clock — marked approximate — until it does.
 */
export default function PostMeta({
  block,
  clock,
  ts,
  chainId,
  currentChain = null,
  navigate,
  prefix,
  className = '',
  lead,
}) {
  const exact = ts != null;
  const date = exact ? new Date(Number(ts) * 1000) : estimateBlockTime(clock, block);
  const rel = fmtRelTime(date, { exact });
  const parts = [
    lead,
    chainId != null && (
      <ChainChip chainId={chainId} navigate={navigate} current={currentChain != null && Number(currentChain) === Number(chainId)} />
    ),
    prefix && <span className="text-ink-ghost">{prefix}</span>,
    rel && <span title={exact ? fmtAbsTime(ts) : undefined}>{rel}</span>,
  ].filter(Boolean);
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint tabular-nums ${className}`}
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="select-none" aria-hidden="true">·</span>}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
