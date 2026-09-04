import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stringToHex, pad, toEventSelector } from 'viem';
import { silentLog } from './helpers';

// chainIO talks to viem through clients.js; the fake client below answers
// exactly the calls it makes and counts them.
const fake = {
  calls: [],
  logs: [],
  blocks: new Map(),
  failBlocks: false,
  baseFee: 7n,
  txInput: new Map(),
};

// brotli-wasm needs a browser to initialise, so the compression boundary is
// stubbed: a "payload" here is its plain UTF-8 text. What is under test is
// chainIO — that it decodes the calldata, takes the payload argument,
// measures it, and passes the decoded document through. Real brotli runs in
// the e2e suite, in a real browser, against the mock node.
vi.mock('../../src/lib/payload', async () => {
  const { parsePayloadText } = await import('../../src/lib/payloadText');
  return {
    decodePayload: async (bytes) => {
      const text = new TextDecoder().decode(bytes);
      return { ...parsePayloadText(text), text };
    },
  };
});

vi.mock('../../src/lib/clients', () => ({
  getClient: () => ({
    async getBlockNumber() {
      fake.calls.push('getBlockNumber');
      return 1000n;
    },
    async getBlock({ blockNumber }) {
      fake.calls.push(`getBlock:${blockNumber}`);
      if (fake.failBlocks) throw new Error('header unavailable');
      return {
        number: blockNumber,
        timestamp: BigInt(fake.blocks.get(String(blockNumber)) ?? 0),
        baseFeePerGas: fake.baseFee,
      };
    },
    async getLogs({ fromBlock, toBlock }) {
      fake.calls.push(`getLogs:${fromBlock}-${toBlock}`);
      return fake.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    async getTransaction({ hash }) {
      fake.calls.push('getTransaction');
      return { input: fake.txInput.get(hash) };
    },
    async getTransactionReceipt({ hash }) {
      fake.calls.push(`getTransactionReceipt`);
      const logs = fake.logs.filter((l) => l.transactionHash === hash);
      return { blockNumber: logs[0]?.blockNumber ?? 0n, logs: logs.map(toRawLog) };
    },
  }),
}));

const { createChainIO } = await import('../../src/lib/chainIO');
const { GLYPH_ADDRESS } = await import('../../src/lib/config');
const { encodeAbiParameters } = await import('viem');

const AUTHOR = '0x1111111111111111111111111111111111111111';
const TX1 = `0x${'01'.repeat(32)}`;
const TX2 = `0x${'02'.repeat(32)}`;
const titleHex = (s) => pad(stringToHex(s), { dir: 'right', size: 32 });

/** A decoded log the way viem's getLogs({ event }) returns it. */
const decoded = ({ block, index, tx, logIndex, blockTimestamp }) => ({
  args: { author: AUTHOR, index: BigInt(index), prevBlock: 0n, title: titleHex(`t${index}`) },
  transactionHash: tx,
  logIndex,
  blockNumber: BigInt(block),
  ...(blockTimestamp != null ? { blockTimestamp: BigInt(blockTimestamp) } : {}),
});

/** The same log undecoded, as a receipt carries it. */
function toRawLog(l) {
  const POST_TOPIC = toEventSelector('Post(address,uint256,uint256,bytes32)');
  return {
    address: GLYPH_ADDRESS,
    topics: [POST_TOPIC, pad(AUTHOR, { size: 32 })],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [l.args.index, l.args.prevBlock, l.args.title],
    ),
    logIndex: l.logIndex,
    transactionHash: l.transactionHash,
    blockNumber: l.blockNumber,
  };
}

describe('chainIO timestamps', () => {
  beforeEach(() => {
    fake.calls = [];
    fake.logs = [];
    fake.blocks = new Map([['500', 1_700_000_000], ['700', 1_700_002_400]]);
    fake.failBlocks = false;
  });

  it('attaches ts to every row with one header read per distinct block', async () => {
    fake.logs = [
      decoded({ block: 500, index: 0, tx: TX1, logIndex: 3 }),
      decoded({ block: 500, index: 1, tx: TX2, logIndex: 9 }),
      decoded({ block: 700, index: 2, tx: `0x${'03'.repeat(32)}`, logIndex: 1 }),
    ];
    const io = createChainIO(1, silentLog());
    const { rows } = await io.postsInRange(400n, 800n);
    expect(rows.map((r) => [Number(r.block), r.ts])).toEqual([
      [500, 1_700_000_000],
      [500, 1_700_000_000],
      [700, 1_700_002_400],
    ]);
    expect(fake.calls.filter((c) => c.startsWith('getBlock:'))).toEqual(['getBlock:500', 'getBlock:700']);
    // Asked again, the same blocks cost nothing.
    await io.postsInRange(400n, 800n);
    expect(fake.calls.filter((c) => c.startsWith('getBlock:'))).toHaveLength(2);
  });

  it('uses a timestamp the node already put on the log', async () => {
    fake.logs = [decoded({ block: 500, index: 0, tx: TX1, logIndex: 0, blockTimestamp: 1_699_999_000 })];
    const io = createChainIO(1, silentLog());
    const { rows } = await io.postsInRange(400n, 800n);
    expect(rows[0].ts).toBe(1_699_999_000);
    expect(fake.calls.some((c) => c.startsWith('getBlock:'))).toBe(false);
  });

  it('keeps the rows when a header read fails, with ts null, and retries later', async () => {
    fake.logs = [decoded({ block: 500, index: 0, tx: TX1, logIndex: 0 })];
    fake.failBlocks = true;
    const io = createChainIO(1, silentLog());
    const { rows } = await io.postsInRange(400n, 800n);
    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toBeNull();
    fake.failBlocks = false;
    const again = await io.postsInRange(400n, 800n);
    expect(again.rows[0].ts).toBe(1_700_000_000);
  });

  it('numbers Post events per transaction and stamps the receipt block time', async () => {
    fake.logs = [
      decoded({ block: 500, index: 0, tx: TX1, logIndex: 7 }),
      decoded({ block: 500, index: 1, tx: TX1, logIndex: 2 }),
    ];
    const io = createChainIO(1, silentLog());
    const posts = await io.postsInTx(TX1);
    expect(posts.map((p) => [Number(p.index), p.eventIndex, p.logIndex, p.ts])).toEqual([
      [1, 0, 2, 1_700_000_000],
      [0, 1, 7, 1_700_000_000],
    ]);
  });

  it("stamps an author's block read too", async () => {
    fake.logs = [decoded({ block: 700, index: 0, tx: TX1, logIndex: 0 })];
    const io = createChainIO(1, silentLog());
    const rows = await io.authorPostsInBlock(AUTHOR, 700n);
    expect(rows[0].ts).toBe(1_700_002_400);
  });
});

describe('what a body and a header carry', () => {
  it('a header carries its base fee, or null when the node reports none', async () => {
    const io = createChainIO(1, silentLog());
    fake.blocks.set('500', 1_700_000_000);
    fake.baseFee = 12_345n;
    expect(await io.block(500n)).toEqual({
      number: 500n,
      timestamp: 1_700_000_000,
      baseFeePerGas: 12_345n,
    });
    fake.baseFee = undefined; // a chain, or a node, that reports no base fee
    expect((await io.block(500n)).baseFeePerGas).toBeNull();
    fake.baseFee = 7n;
  });

  it('a body carries the exact on-chain text and what it cost to store', async () => {
    const { encodeFunctionData, toHex, pad, stringToHex } = await import('viem');
    const { abi } = await import('../../src/lib/abi');

    const text = '---\ntags: letters home, 冬\nlang: zh\n---\n\n# 冬至\n\n正文。';
    const payload = new TextEncoder().encode(text);
    fake.txInput.set(
      TX1,
      encodeFunctionData({
        abi,
        functionName: 'publish',
        args: [pad(stringToHex('冬至'), { dir: 'right', size: 32 }), toHex(payload)],
      }),
    );

    const io = createChainIO(1, silentLog());
    const body = await io.postBody(TX1);
    // The document as the chain holds it, byte for byte — what the raw view
    // shows and what a .md download and an archive carry.
    expect(body.text).toBe(text);
    expect(body.markdown).toBe('# 冬至\n\n正文。');
    expect(body.tags).toEqual(['letters home', '冬']);
    expect(body.meta.lang).toBe('zh');
    expect(body.compressedBytes).toBe(payload.length);
  });
});
