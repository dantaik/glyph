import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLog } from './helpers';

// A node with a head of its own: it refuses windows above it the way public
// gateways do, and can be told to refuse ranges or rate-limit instead.
const fake = { calls: [], head: 1000n, refuse: null };

vi.mock('../../src/lib/clients', () => ({
  getClient: () => ({
    async getLogs({ fromBlock, toBlock }) {
      fake.calls.push([fromBlock, toBlock]);
      if (fake.refuse) throw fake.refuse();
      if (toBlock > fake.head) throw new Error('block range extends beyond current head block');
      return [];
    },
    async getBlock({ blockNumber }) {
      return { number: blockNumber, timestamp: 1n };
    },
    async readContract({ functionName, args }) {
      fake.calls.push([functionName, ...args]);
      return 0n;
    },
    async getEnsName({ address }) {
      fake.calls.push(['ens', address]);
      return null;
    },
  }),
}));

const { createChainIO } = await import('../../src/lib/chainIO');

describe('chainIO.postsInRange — what the node refuses', () => {
  beforeEach(() => {
    fake.calls = [];
    fake.head = 1000n;
    fake.refuse = null;
  });
  afterEach(() => vi.useRealTimers());

  it('lowers the window top, block by block, when the node is behind the head it reported', async () => {
    fake.head = 997n;
    const io = createChainIO(1, silentLog());
    const res = await io.postsInRange(900n, 1000n);
    expect(res.to).toBe(997n);
    expect(fake.calls.map(([, to]) => to)).toEqual([1000n, 999n, 998n, 997n]);
  });

  it('gives up lowering after three tries', async () => {
    fake.head = 990n;
    const io = createChainIO(1, silentLog());
    await expect(io.postsInRange(900n, 1000n)).rejects.toThrow(/beyond current head/);
    expect(fake.calls).toHaveLength(4);
  });

  it('never lowers the top below the bottom of the window', async () => {
    fake.head = 0n;
    const io = createChainIO(1, silentLog());
    await expect(io.postsInRange(1000n, 1000n)).rejects.toThrow(/beyond current head/);
    expect(fake.calls).toHaveLength(1);
  });

  it('tags a range refusal so the sweep can shrink its window', async () => {
    fake.refuse = () => new Error('query returned more than 10000 results, range too large');
    const io = createChainIO(1, silentLog());
    const err = await io.postsInRange(0n, 1000n).catch((e) => e);
    expect(err.rangeTooLarge).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  it('backs off and retries a rate limit, and does not mistake it for a range refusal', async () => {
    vi.useFakeTimers();
    fake.refuse = () => Object.assign(new Error('429 Too Many Requests'), { status: 429 });
    const io = createChainIO(1, silentLog());
    const attempt = io.postsInRange(0n, 1000n);
    attempt.catch(() => {});
    await vi.runAllTimersAsync();
    const err = await attempt.catch((e) => e);
    expect(err.message).toMatch(/429/);
    expect(err.rangeTooLarge).toBeUndefined();
    expect(fake.calls).toHaveLength(3); // the call and two retries
  });
});

describe('chainIO — addresses as arguments', () => {
  beforeEach(() => {
    fake.calls = [];
  });

  it('hands the node lowercase addresses, so a wrongly-cased one is not refused as a bad checksum', async () => {
    const io = createChainIO(1, silentLog());
    const mixed = '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5'; // not the EIP-55 casing of these bytes
    await io.latestBlock(mixed);
    await io.count(mixed);
    await io.ensName(mixed);
    expect(fake.calls).toEqual([
      ['latestBlock', mixed.toLowerCase()],
      ['count', mixed.toLowerCase()],
      ['ens', mixed.toLowerCase()],
    ]);
  });
});
