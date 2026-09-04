import { chainName, fmtClock } from '../lib/format';
import { lowestSample, latestSample, sparklinePoints } from '../lib/gasHistory';
import { t } from '../lib/i18n';
import { fmtEth, fmtUsd, fmtGwei, gasToCost } from '../lib/price';
import ChainIcon from './ChainIcon';
import { Body, Meta, Micro, Note } from './Text';

/**
 * The last day of base fees as one small line.
 *
 * Twenty-odd numbers do not need axes or a legend; what the writer wants to
 * know is whether now is a peak or a trough, which is a shape. Drawn as an
 * inline SVG with no library, in `currentColor`, so it follows the theme.
 */
function GasSparkline({ samples, label }) {
  const points = sparklinePoints(samples);
  if (points.length < 2) return null;
  // The line is drawn cheapest-at-the-bottom, which is how a price reads.
  const path = points.map((p) => `${(p.x * 100).toFixed(2)},${((1 - p.y) * 24 + 2).toFixed(2)}`).join(' ');
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-7 w-full text-accent"
    >
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Live cost breakdown for the current draft: the body, each image, the total
 * — and the two things that actually change what it costs, which are WHEN
 * and WHERE. The last day of base fees says when; a line per other network
 * says where.
 *
 * Props: { estimate, market, chainId, history, comparisons, onPublishThere }
 */
export default function CostPanel({ estimate, market, chainId, history = [], comparisons = [], onPublishThere }) {
  if (!estimate) {
    return (
      <Meta as="div" className="rounded-xl border border-edge bg-paper-sunken px-5 py-4">
        {t('cost.loading')}
      </Meta>
    );
  }
  const { postCost, imageCosts, totalCost, totalGas, estCompressed, limitBytes, nearLimit } = estimate;
  const usdAvailable = totalCost.usd != null;

  const low = lowestSample(history);
  const now = latestSample(history);
  // What this same post would have cost at the cheapest hour of the day.
  const thenCost = low ? gasToCost(totalGas, low.baseFeePerGas, market.ethUsd) : null;

  return (
    <div className="rounded-xl border border-edge bg-paper-sunken px-5 py-4">
      <div className="mb-3 flex justify-end">
        <Micro as="span" nums>
          {fmtGwei(market.gasPriceWei)}
          {usdAvailable && market.ethUsd != null ? (
            <> · ETH ${market.ethUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</>
          ) : (
            <>{t('cost.noUsd')}</>
          )}
        </Micro>
      </div>

      <ul className="space-y-1.5">
        <Body as="li" className="flex items-baseline justify-between gap-4">
          <span>{t('cost.body', { bytes: estCompressed })}</span>
          <span className="tabular-nums text-right">
            {fmtEth(postCost.eth)}
            {usdAvailable && <span className="ml-2 text-ink-faint">{fmtUsd(postCost.usd)}</span>}
          </span>
        </Body>
        {imageCosts.map((c) => (
          <Body as="li" key={c.key} className="flex items-baseline justify-between gap-4">
            <span className="truncate">{t('cost.image', { key: c.key })}</span>
            <span className="tabular-nums text-right shrink-0">
              {fmtEth(c.eth)}
              {usdAvailable && <span className="ml-2 text-ink-faint">{fmtUsd(c.usd)}</span>}
            </span>
          </Body>
        ))}
      </ul>

      {nearLimit && (
        <p className="mt-3 text-2xs leading-relaxed text-danger">
          {t('cost.nearLimit', { limit: Math.floor(limitBytes / 1024) })}
        </p>
      )}

      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-edge pt-2.5 text-sm font-medium text-ink">
        <span>{t('cost.total')}</span>
        <span className="tabular-nums text-right">
          {fmtEth(totalCost.eth)}
          {usdAvailable && <span className="ml-2 font-normal text-ink-soft">{fmtUsd(totalCost.usd)}</span>}
        </span>
      </div>

      {/* When: the last day of block space, from the chain's own headers. */}
      {history.length >= 2 && (
        <div className="mt-4 border-t border-edge pt-3" data-gas-history="">
          <GasSparkline samples={history} label={t('cost.sparklineLabel', { chain: chainName(chainId) })} />
          <Micro nums className="mt-1.5">
            {now && t('cost.nowAt', { fee: fmtGwei(now.baseFeePerGas) })}
            {low && (
              <>
                {now ? ' · ' : ''}
                {t('cost.low24h', { fee: fmtGwei(low.baseFeePerGas), time: fmtClock(low.ts) })}
              </>
            )}
            {thenCost?.eth != null && (
              <>
                {' · '}
                {t('cost.wouldHaveCost', {
                  cost: usdAvailable ? fmtUsd(thenCost.usd) : fmtEth(thenCost.eth),
                })}
              </>
            )}
          </Micro>
        </div>
      )}

      {/* Where: the same draft, on the other networks. */}
      {comparisons.length > 0 && (
        <div className="mt-3 space-y-1" data-chain-costs="">
          {comparisons.map((c) => (
            <Micro key={c.chainId} nums className="flex flex-wrap items-baseline gap-x-2">
              <span className="inline-flex items-center gap-1">
                <ChainIcon chainId={c.chainId} size={11} />
                {c.cost?.eth != null
                  ? t('cost.onOtherChain', {
                      chain: chainName(c.chainId),
                      eth: fmtEth(c.cost.eth),
                      usd: c.cost.usd != null ? fmtUsd(c.cost.usd) : '',
                    })
                  : t('cost.onOtherChainUnknown', { chain: chainName(c.chainId) })}
              </span>
              <button
                type="button"
                onClick={() => onPublishThere?.(c.chainId)}
                className="underline-offset-4 hover:text-accent hover:underline"
              >
                {t('cost.publishThere')}
              </button>
            </Micro>
          ))}
          <Note>{t('cost.ownGasPriceNote')}</Note>
        </div>
      )}
    </div>
  );
}
