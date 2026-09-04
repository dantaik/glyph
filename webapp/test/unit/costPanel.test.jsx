// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CostPanel from '../../src/components/CostPanel';
import { setLang } from '../../src/lib/i18n';

afterEach(cleanup);

const estimate = {
  postGas: 85_000,
  postCost: { eth: 0.00002, usd: 0.05 },
  imageCosts: [],
  totalGas: 85_000,
  totalCost: { eth: 0.00002, usd: 0.05 },
  estCompressed: 1_400,
  limitBytes: 130_048,
  nearLimit: false,
};
const market = { gasPriceWei: 230_000_000n, ethUsd: 2500 };

/** A day whose cheapest hour is a tenth of the current price. */
const history = [
  { block: 1n, ts: 1_757_000_000, baseFeePerGas: 5_000_000_000n },
  { block: 2n, ts: 1_757_003_600, baseFeePerGas: 500_000_000n },
  { block: 3n, ts: 1_757_007_200, baseFeePerGas: 3_000_000_000n },
];

describe('the cost panel', () => {
  it('shows the day’s shape, the cheapest hour, and what that hour would have cost', () => {
    setLang('en');
    render(<CostPanel estimate={estimate} market={market} chainId={1} history={history} />);

    // The sparkline is a picture, so it says in words what it shows.
    expect(screen.getByRole('img', { name: /Ethereum base fee over the last day/ })).toBeTruthy();
    const facts = document.querySelector('[data-gas-history]').textContent;
    expect(facts).toContain('24h low');
    expect(facts).toContain('this post would have cost');
  });

  it('leaves the line out when the node would not give a day’s headers', () => {
    setLang('en');
    render(<CostPanel estimate={estimate} market={market} chainId={1} history={[]} />);
    expect(document.querySelector('[data-gas-history]')).toBeNull();
    // …and the panel itself still says what the post costs.
    expect(screen.getByText('Total')).toBeTruthy();
  });

  it('prices the same draft on the other network, and offers to send it there', () => {
    setLang('en');
    const onPublishThere = vi.fn();
    render(
      <CostPanel
        estimate={estimate}
        market={market}
        chainId={1}
        history={history}
        comparisons={[{ chainId: 167000, cost: { eth: 0.0000001, usd: 0.0002 } }]}
        onPublishThere={onPublishThere}
      />,
    );

    expect(document.querySelector('[data-chain-costs]').textContent).toContain('On Taiko this would cost');
    fireEvent.click(screen.getByRole('button', { name: 'Publish there' }));
    expect(onPublishThere).toHaveBeenCalledWith(167000);
  });

  it('says so plainly when the other network’s price cannot be read', () => {
    setLang('en');
    render(
      <CostPanel
        estimate={estimate}
        market={market}
        chainId={1}
        comparisons={[{ chainId: 167000, cost: null }]}
      />,
    );
    expect(document.querySelector('[data-chain-costs]').textContent).toContain(
      'Taiko’s gas price is unavailable',
    );
  });
});
