// rpcServer.mjs — a JSON-RPC node for the browser tests.
//
// The demo worlds (src/lib/fixtureWorld.js) served over HTTP the way a
// public endpoint would serve a chain — Post events as ABI-encoded logs,
// bodies as brotli calldata in publish() transactions, heads, headers,
// receipts, the contract's two views — so the real chainIO, viem and
// brotli-wasm run end to end, against numbers at the deployed contract's
// real heights (each world sits on top of its chain's deploy block).
//
//   POST /rpc/<scenario>/<chainId>   JSON-RPC 2.0 (single or batch)
//   GET  /__oracle/<scenario>         the merged order the feed must show, and per-author counts
//   GET  /__calls/<scenario>?chain=   every request so far
//   POST /__reset/<scenario>          forget calls and failure counters
//   GET  /__health
//
// Scenarios — the worlds are stretched 20× in blocks, so Taiko spans two
// sweep budgets and the frontier shows on the first page:
//   default     both chains
//   empty       both chains, no posts
//   taiko-down  Taiko answers HTTP 503
//   flaky       the first two requests to each chain are 429s
//
// Usage: node test/e2e/rpcServer.mjs [port]   (default 8545)

import { createServer } from 'node:http';
import { brotliCompressSync, constants } from 'node:zlib';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  stringToHex,
  toEventSelector,
  toHex,
} from 'viem';
import { abi } from '../../src/lib/abi.js';
import { CHAINS } from '../../src/lib/chains.js';
import { AUTHORS, buildWorlds, expectedMergedOrder } from '../../src/lib/fixtureWorld.js';
import { buildPayloadText } from '../../src/lib/payloadText.js';

const PORT = Number(process.argv[2] || process.env.GLYPH_RPC_PORT || 8545);
const GLYPH = '0x000000ae2f2249c497cfc5f262dd1491634c361c';
const POST_SIG = toEventSelector('Post(address,uint256,uint256,bytes32)');
const CHAIN_IDS = [1, 167000];
const NOW = Math.floor(Date.now() / 1000);
const SCALE = 20;

const SCENARIOS = {
  default: {},
  empty: { empty: true },
  'taiko-down': { down: [167000] },
  flaky: { flaky: 2 },
};

const hex = (n) => toHex(BigInt(n));
const hash32 = (seed) => keccak256(stringToHex(seed));
const encoder = new TextEncoder();

/** A title as the contract stores it: UTF-8, cut to 32 bytes, right-padded. */
function titleHex(title) {
  let t = title ?? '';
  while (encoder.encode(t).length > 32) t = t.slice(0, -1);
  return pad(stringToHex(t), { dir: 'right', size: 32 });
}

const rpcError = (code, message) => Object.assign(new Error(message), { code });

// --- Scenarios --------------------------------------------------------------

const scenarios = new Map();

function scenario(name) {
  if (scenarios.has(name)) return scenarios.get(name);
  const spec = SCENARIOS[name];
  if (!spec) return null;
  const worlds = buildWorlds(CHAIN_IDS, { now: NOW, scale: SCALE });
  const chains = new Map();
  for (const [id, world] of worlds) {
    const offset = BigInt(CHAINS[id].deployBlock);
    const posts = spec.empty
      ? []
      : world.posts.map((p) => ({
          ...p,
          realBlock: offset + p.block,
          realPrev: p.prevBlock === 0n ? 0n : offset + p.prevBlock,
        }));
    const byTx = new Map(posts.map((p) => [p.txHash.toLowerCase(), p]));
    const byAuthor = new Map();
    for (const p of posts) {
      const k = p.author.toLowerCase();
      byAuthor.set(k, [...(byAuthor.get(k) ?? []), p]);
    }
    chains.set(id, {
      id,
      world,
      offset,
      head: offset + world.head,
      posts,
      byTx,
      byAuthor,
      bodies: spec.empty ? new Map() : world.bodyByTx,
      txCache: new Map(),
      calls: [],
      failures: spec.flaky ?? 0,
      down: spec.down?.includes(id) ?? false,
    });
  }
  const s = { name, spec, worlds, chains };
  scenarios.set(name, s);
  return s;
}

// --- Encoding what a node hands out ------------------------------------------

const tsOfReal = (c, n) => c.world.tsOf(n >= c.offset ? n - c.offset : 0n);
const blockHash = (c, n) => hash32(`block:${c.id}:${n}`);

function blockOf(c, n) {
  return {
    number: hex(n),
    hash: blockHash(c, n),
    parentHash: blockHash(c, n - 1n),
    nonce: '0x0000000000000000',
    sha3Uncles: hash32('uncles'),
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: hash32('txs'),
    stateRoot: hash32('state'),
    receiptsRoot: hash32('receipts'),
    miner: `0x${'00'.repeat(20)}`,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x100',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    timestamp: hex(tsOfReal(c, n)),
    transactions: [],
    uncles: [],
    baseFeePerGas: '0x1',
  };
}

function logOf(c, p) {
  return {
    address: GLYPH,
    topics: [POST_SIG, pad(p.author.toLowerCase(), { size: 32 })],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [p.index, p.realPrev, titleHex(p.title)],
    ),
    blockNumber: hex(p.realBlock),
    blockHash: blockHash(c, p.realBlock),
    transactionHash: p.txHash,
    transactionIndex: '0x0',
    logIndex: hex(p.logIndex ?? 0),
    removed: false,
  };
}

function receiptOf(c, p) {
  return {
    transactionHash: p.txHash,
    transactionIndex: '0x0',
    blockHash: blockHash(c, p.realBlock),
    blockNumber: hex(p.realBlock),
    from: p.author.toLowerCase(),
    to: GLYPH,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs: [logOf(c, p)],
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    type: '0x0',
    effectiveGasPrice: '0x1',
  };
}

/** The publish() transaction: title + brotli(front matter + markdown) as calldata. */
function txOf(c, p) {
  const key = p.txHash.toLowerCase();
  if (c.txCache.has(key)) return c.txCache.get(key);
  const body = c.bodies.get(p.txHash) ?? { tags: [], markdown: p.title };
  const text = buildPayloadText({
    markdown: body.markdown,
    meta: { ...(body.meta ?? {}), tags: body.tags },
  });
  const payload = brotliCompressSync(Buffer.from(text, 'utf8'), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const tx = {
    hash: p.txHash,
    nonce: '0x0',
    blockHash: blockHash(c, p.realBlock),
    blockNumber: hex(p.realBlock),
    transactionIndex: '0x0',
    from: p.author.toLowerCase(),
    to: GLYPH,
    value: '0x0',
    gas: '0x100000',
    gasPrice: '0x1',
    input: encodeFunctionData({ abi, functionName: 'publish', args: [titleHex(p.title), toHex(new Uint8Array(payload))] }),
    type: '0x0',
    chainId: hex(c.id),
    v: '0x1b',
    r: hash32('r'),
    s: hash32('s'),
  };
  c.txCache.set(key, tx);
  return tx;
}

const tagToNumber = (c, tag) =>
  tag == null || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized' ? c.head : tag === 'earliest' ? 0n : BigInt(tag);

function answer(c, method, params) {
  switch (method) {
    case 'eth_chainId':
      return hex(c.id);
    case 'net_version':
      return String(c.id);
    case 'eth_blockNumber':
      return hex(c.head);
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00';
    case 'eth_estimateGas':
      return '0x5208';
    case 'eth_feeHistory':
      return { oldestBlock: hex(c.head - 1n), baseFeePerGas: ['0x1', '0x1'], gasUsedRatio: [0.5], reward: [['0x1']] };
    case 'eth_getBlockByNumber': {
      const n = tagToNumber(c, params[0]);
      return n > c.head ? null : blockOf(c, n);
    }
    case 'eth_getLogs': {
      const f = params[0] ?? {};
      const from = tagToNumber(c, f.fromBlock ?? 'earliest');
      const to = tagToNumber(c, f.toBlock);
      if (to > c.head) throw rpcError(-32000, 'block range extends beyond current head block');
      return c.posts
        .filter((p) => p.realBlock >= from && p.realBlock <= to)
        .sort((a, b) => (a.realBlock === b.realBlock ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : a.realBlock < b.realBlock ? -1 : 1))
        .map((p) => logOf(c, p));
    }
    case 'eth_call': {
      const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
      const list = c.byAuthor.get(String(args[0]).toLowerCase()) ?? [];
      const v =
        functionName === 'latestBlock' ? (list.length ? list[list.length - 1].realBlock : 0n) : functionName === 'count' ? BigInt(list.length) : 0n;
      return encodeAbiParameters([{ type: 'uint256' }], [v]);
    }
    case 'eth_getTransactionReceipt': {
      const p = c.byTx.get(String(params[0]).toLowerCase());
      return p ? receiptOf(c, p) : null;
    }
    case 'eth_getTransactionByHash': {
      const p = c.byTx.get(String(params[0]).toLowerCase());
      return p ? txOf(c, p) : null;
    }
    default:
      throw rpcError(-32601, `the mock node does not answer ${method}`);
  }
}

// --- The oracle: what the pages must show --------------------------------------

/**
 * A few words of prose from a body, to find on the rendered page. Letters
 * and single spaces only, in whichever script the post is written in, so
 * the probe survives markdown rendering untouched. Falls back to the title
 * for a body with no prose in it.
 */
function probeOf(body, title) {
  const markdown = body?.markdown ?? '';
  const cjk = markdown.match(/[\u4e00-\u9fff]{4,}/u);
  if (cjk) return cjk[0].slice(0, 6);
  const words = markdown.match(/\p{L}{3,}(?: \p{L}{3,}){2,}/u);
  return words ? words[0].slice(0, 24) : title;
}

function oracleOf(s) {
  const posts = expectedMergedOrder(s.worlds).map((p) => {
    const c = s.chains.get(p.chainId);
    return {
      chainId: p.chainId,
      slug: CHAINS[p.chainId].slug,
      txHash: p.txHash,
      title: p.title,
      author: p.author,
      index: Number(p.index),
      href: `/${CHAINS[p.chainId].slug}/tx/${p.txHash}/0`,
      probe: probeOf(c.bodies.get(p.txHash), p.title),
    };
  });
  const counts = {};
  for (const a of AUTHORS) {
    const byChain = {};
    let total = 0;
    for (const c of s.chains.values()) {
      byChain[c.id] = (c.byAuthor.get(a.toLowerCase()) ?? []).length;
      total += byChain[c.id];
    }
    counts[a] = { total, byChain };
  }
  return { now: NOW, posts: s.spec.empty ? [] : posts, counts, authors: AUTHORS };
}

// --- HTTP -------------------------------------------------------------------------

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => {
    res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (url.pathname === '/__health') return json(200, { ok: true });
  let m;
  if ((m = url.pathname.match(/^\/__oracle\/([\w-]+)$/))) {
    const s = scenario(m[1]);
    return s ? json(200, oracleOf(s)) : json(404, { error: 'no such scenario' });
  }
  if ((m = url.pathname.match(/^\/__calls\/([\w-]+)$/))) {
    const s = scenario(m[1]);
    if (!s) return json(404, { error: 'no such scenario' });
    const chain = url.searchParams.get('chain');
    const out = [];
    for (const c of s.chains.values()) if (!chain || String(c.id) === chain) out.push(...c.calls);
    return json(200, out);
  }
  if ((m = url.pathname.match(/^\/__reset\/([\w-]+)$/))) {
    const s = scenario(m[1]);
    if (!s) return json(404, { error: 'no such scenario' });
    for (const c of s.chains.values()) {
      c.calls = [];
      c.failures = s.spec.flaky ?? 0;
    }
    return json(200, { ok: true });
  }
  if ((m = url.pathname.match(/^\/rpc\/([\w-]+)\/(\d+)$/))) {
    const c = scenario(m[1])?.chains.get(Number(m[2]));
    if (!c) return json(404, { error: 'no such chain in that scenario' });
    if (c.down) {
      res.writeHead(503, CORS);
      return res.end('down');
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(400, { error: 'bad json' });
    }
    const reqs = Array.isArray(payload) ? payload : [payload];
    for (const r of reqs) c.calls.push({ method: r.method, params: r.params ?? [] });
    if (c.failures > 0) {
      c.failures -= 1;
      return json(429, { jsonrpc: '2.0', id: reqs[0]?.id ?? null, error: { code: -32005, message: 'too many requests' } });
    }
    const answers = reqs.map((r) => {
      try {
        return { jsonrpc: '2.0', id: r.id, result: answer(c, r.method, r.params ?? []) };
      } catch (e) {
        return { jsonrpc: '2.0', id: r.id, error: { code: e.code ?? -32000, message: e.message } };
      }
    });
    return json(200, Array.isArray(payload) ? answers : answers[0]);
  }
  json(404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`glyph mock rpc on http://127.0.0.1:${PORT}  scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
});
