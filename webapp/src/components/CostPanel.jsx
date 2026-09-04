import { t } from '../lib/i18n';
import { fmtEth, fmtUsd, fmtGwei } from '../lib/price';
import { Body, Meta, Micro } from './Text';

/** Live cost breakdown for the current draft (body + images + total). */
export default function CostPanel({ estimate, market, chainId }) {
  if (!estimate) {
    return (
      <Meta as="div" className="rounded-xl border border-edge bg-paper-sunken px-5 py-4">
        {t('cost.loading')}
      </Meta>
    );
  }
  const { postCost, imageCosts, totalCost, estCompressed, limitBytes, nearLimit } = estimate;
  const usdAvailable = totalCost.usd != null;

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
            {usdAvailable && (
              <span className="ml-2 text-ink-faint">{fmtUsd(postCost.usd)}</span>
            )}
          </span>
        </Body>
        {imageCosts.map((c) => (
          <Body as="li" key={c.key} className="flex items-baseline justify-between gap-4">
            <span className="truncate">{t('cost.image', { key: c.key })}</span>
            <span className="tabular-nums text-right shrink-0">
              {fmtEth(c.eth)}
              {usdAvailable && (
                <span className="ml-2 text-ink-faint">{fmtUsd(c.usd)}</span>
              )}
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
          {usdAvailable && (
            <span className="ml-2 font-normal text-ink-soft">
              {fmtUsd(totalCost.usd)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
