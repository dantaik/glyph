// chainIOContract.test.js — the real chain I/O against a fake node: logs
// come from the one contract address in one request, a row says which hook
// the post went through, the head and the count are 0 where the contract is
// not deployed, and a body says which call carried it and who sent it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, pad, stringToHex, toEventSelector, toHex } from 'viem';
import { silentLog } from './helpers';

const fake = {
  calls: [],
  logs: [],
  txs: new Map(), // hash -> { input, from }
  deployed: new Set(),
};

vi.mock('../../src/lib/payload', async () => {
  const { parsePayloadText } = await import('../../src/lib/payloadText');
  return {
    decodePayload: async (bytes) => {
      const text = new TextDecoder().decode(bytes);
      return { ...parsePayloadText(text), text };
    },
  };
});

class ZeroData extends Error {
  constructor() {
    super('The contract function "latestBlock" returned no data ("0x").');
    this.name = 'ContractFunctionExecutionError';
    this.cause = { name: 'ContractFunctionZeroDataError' };
  }
}

vi.mock('../../src/lib/clients', () => ({
  getClient: () => ({
    async getBlockNumber() {
      return 1000n;
    },
    async getBlock({ blockNumber }) {
      return { number: blockNumber, timestamp: 1_700_000_000n + blockNumber, baseFeePerGas: 1n };
    },
    async getLogs(args) {
      fake.calls.push({ method: 'getLogs', args });
      const addresses = new Set((Array.isArray(args.address) ? args.address : [args.address]).map((a) => a.toLowerCase()));
      return fake.logs.filter(
        (l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock && addresses.has(l.address.toLowerCase()),
      );
    },
    async readContract({ address, functionName, args }) {
      fake.calls.push({ method: functionName, address, args });
      if (!fake.deployed.has(address.toLowerCase())) throw new ZeroData();
      return functionName === 'count' ? 3n : 700n;
    },
    async getCode({ address }) {
      fake.calls.push({ method: 'getCode', address });
      return fake.deployed.has(address.toLowerCase()) ? '0x6080' : undefined;
    },
    async getTransaction({ hash }) {
      return fake.txs.get(hash);
    },
    async getTransactionReceipt({ hash }) {
      const logs = fake.logs.filter((l) => l.transactionHash === hash);
      return { blockNumber: logs[0]?.blockNumber ?? 0n, logs: logs.map(toRawLog) };
    },
  }),
}));

const { createChainIO } = await import('../../src/lib/chainIO');
const { XUENI_ADDRESS } = await import('../../src/lib/config');
const { abi } = await import('../../src/lib/abi');

const AUTHOR = '0x1111111111111111111111111111111111111111';
const RELAYER = '0x9999999999999999999999999999999999999999';
const HOOK = '0x00000000000000000000000000000000000000ab';
const ZERO = `0x${'00'.repeat(20)}`;
const TX1 = `0x${'01'.repeat(32)}`;
const TX2 = `0x${'02'.repeat(32)}`;
const TX3 = `0x${'03'.repeat(32)}`;
const titleHex = (s) => pad(stringToHex(s), { dir: 'right', size: 32 });
const POST_TOPIC = toEventSelector('Post(address,address,uint256,uint256,bytes32)');

/** A decoded log the way viem's getLogs({ event }) returns it. */
const decoded = ({ block, index, tx, logIndex, hook = null }) => ({
  address: XUENI_ADDRESS,
  eventName: 'Post',
  args: {
    author: AUTHOR,
    hook: hook ?? ZERO,
    index: BigInt(index),
    prevBlock: 0n,
    title: titleHex(`#${index}`),
  },
  transactionHash: tx,
  logIndex,
  blockNumber: BigInt(block),
  blockTimestamp: 1_700_000_000n + BigInt(block),
});

/** The same log undecoded, as a receipt carries it. */
function toRawLog(l) {
  return {
    address: l.address,
    topics: [POST_TOPIC, pad(AUTHOR, { size: 32 }), pad(l.args.hook, { size: 32 })],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [l.args.index, l.args.prevBlock, l.args.title],
    ),
    logIndex: l.logIndex,
    transactionHash: l.transactionHash,
    blockNumber: l.blockNumber,
  };
}

const text = '---\ntags: home\n---\n\nBody.';
const payload = toHex(new TextEncoder().encode(text));

beforeEach(() => {
  fake.calls = [];
  fake.logs = [
    decoded({ block: 500, index: 0, tx: TX1, logIndex: 0 }),
    decoded({ block: 500, index: 1, tx: TX2, logIndex: 1, hook: HOOK }),
    decoded({ block: 600, index: 2, tx: TX3, logIndex: 0 }),
  ];
  fake.txs = new Map([
    [TX1, { from: AUTHOR, input: encodeFunctionData({ abi, functionName: 'publish', args: [titleHex('#0'), payload] }) }],
    [
      TX2,
      {
        from: AUTHOR,
        input: encodeFunctionData({ abi, functionName: 'publish', args: [titleHex('#1'), payload, HOOK, '0xc0ffee'] }),
      },
    ],
    [
      TX3,
      {
        from: RELAYER,
        input: encodeFunctionData({
          abi,
          functionName: 'publishFor',
          args: [AUTHOR, titleHex('#2'), payload, ZERO, '0x', 1_900_000_000n, `0x${'ab'.repeat(65)}`],
        }),
      },
    ],
  ]);
  fake.deployed = new Set([XUENI_ADDRESS.toLowerCase()]);
});

describe('chainIO over the contract', () => {
  it('asks for one address and one event in one request', async () => {
    const io = createChainIO(1, silentLog());
    const { rows } = await io.postsInRange(400n, 800n);
    const call = fake.calls.find((c) => c.method === 'getLogs');
    expect(String(call.args.address).toLowerCase()).toBe(XUENI_ADDRESS.toLowerCase());
    expect(call.args.event.name).toBe('Post');
    expect(rows.map((r) => [Number(r.index), r.hook, r.title])).toEqual([
      [0, null, '#0'],
      [1, HOOK, '#1'],
      [2, null, '#2'],
    ]);
    // Posts in different transactions are each their transaction's first.
    expect(rows.map((r) => r.eventIndex)).toEqual([0, 0, 0]);
  });

  it("an author's block read carries the block's rows, hook and all", async () => {
    const io = createChainIO(1, silentLog());
    const rows = await io.authorPostsInBlock(AUTHOR, 500n);
    expect(rows.map((r) => Number(r.index))).toEqual([0, 1]);
    expect(rows[1].hook).toBe(HOOK);
  });

  it('reads the head and the count, and 0 where the contract is not deployed', async () => {
    const io = createChainIO(1, silentLog());
    expect(await io.latestBlock(AUTHOR)).toBe(700n);
    expect(await io.count(AUTHOR)).toBe(3n);
    expect(fake.calls.filter((c) => c.method === 'latestBlock').map((c) => c.address.toLowerCase())).toEqual([
      XUENI_ADDRESS.toLowerCase(),
    ]);
    fake.deployed.delete(XUENI_ADDRESS.toLowerCase());
    expect(await io.latestBlock(AUTHOR)).toBe(0n);
    expect(await io.count(AUTHOR)).toBe(0n);
  });

  it('a receipt yields the posts in log order, with their hook', async () => {
    fake.logs = [
      decoded({ block: 500, index: 0, tx: TX1, logIndex: 3 }),
      decoded({ block: 500, index: 1, tx: TX1, logIndex: 5, hook: HOOK }),
    ];
    const io = createChainIO(1, silentLog());
    const posts = await io.postsInTx(TX1);
    expect(posts.map((p) => [Number(p.index), p.eventIndex, p.logIndex, p.hook])).toEqual([
      [0, 0, 3, null],
      [1, 1, 5, HOOK],
    ]);
  });

  it('a body says which call carried it: plain, through a hook, or relayed', async () => {
    const io = createChainIO(1, silentLog());
    const plain = await io.postBody(TX1);
    expect(plain).toMatchObject({ form: 'publish', hook: null, hookData: '0x', relayed: null, sender: AUTHOR, text });
    const hooked = await io.postBody(TX2);
    expect(hooked).toMatchObject({ form: 'publishWithHook', hook: HOOK, hookData: '0xc0ffee', relayed: null, sender: AUTHOR });
    expect(hooked.tags).toEqual(['home']);
    const relayed = await io.postBody(TX3);
    expect(relayed).toMatchObject({
      form: 'publishFor',
      hook: null,
      relayed: { author: AUTHOR, deadline: '1900000000', signature: `0x${'ab'.repeat(65)}` },
      sender: RELAYER,
    });
    expect(relayed.compressedBytes).toBe(new TextEncoder().encode(text).length);
  });
});
