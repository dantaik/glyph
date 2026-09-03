// chainIO.js — every chain read the reader makes, for ONE chain.
//
// A thin surface over viem: block heights and hashes in, post metadata and
// bytes out. It knows nothing about caching or traversal — that is
// scanStore.js and scanner.js — which is what lets fixtures.js stand in for
// it with an in-memory chain and run the real reader on top.
//
// Every call goes through the chain's client of the moment (clients.js), so
// an edited endpoint list applies to the next request, even mid-sweep.

import { decodeEventLog, decodeFunctionData, hexToBytes } from 'viem';
import { abi, POST_EVENT } from './abi';
import { getChain } from './chains';
import { getClient } from './clients';
import { GLYPH_ADDRESS } from './config';
import { decodeTitle } from './title';
import { decodePayload } from './payload';
import { shortAddr } from './format';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff on transient public-RPC failures
 * (rate limits / timeouts). Throws the original error after the last attempt.
 */
async function withRetry(fn, { retries = 2, baseDelayMs = 1200 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err?.message || err);
      const retriable =
        err?.status === 429 ||
        /rate limit|429|too many requests|timeout|underlying network|can'?t route|suitable provider/i.test(msg);
      if (!retriable || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

const errorText = (err) => String(err?.details || err?.shortMessage || err?.message || err);

/**
 * The node hasn't caught up to the top of the window we asked for. Public
 * gateways route eth_blockNumber and eth_getLogs to different nodes, so
 * the head one reports can be a block ahead of the one that answers logs
 * (drpc says "block range extends beyond current head block"). Not a
 * range-size problem: the fix is to ask for one block less, not half.
 */
const isBeyondHead = (err) =>
  /beyond.{0,24}head|head.{0,24}beyond|exceed.{0,24}(head|latest)|(head|latest).{0,24}exceed/i.test(
    errorText(err),
  );

/** How many times to lower the window top before giving up on it. */
const HEAD_RETRIES = 3;

/**
 * Public nodes cap getLogs ranges anywhere from 25 blocks to 30,000. Tag the
 * refusal so the sweep can shrink its window and carry on instead of giving
 * up — but never confuse it with a rate limit, which backing off fixes.
 */
function tagRangeError(err) {
  const msg = errorText(err);
  if (/rate limit|429|too many requests/i.test(msg)) return err;
  if (/\brange\b|too large|exceed|limited to|must not exceed/i.test(msg)) {
    err.rangeTooLarge = true;
  }
  return err;
}

/**
 * One transaction can publish several posts (e.g. a multicall), so a
 * txHash is not a unique post id. Tag each Post log with its 0-based
 * ordinal among the Post events of its transaction (by logIndex order).
 */
function assignEventIndexes(logs) {
  const byTx = new Map();
  for (const log of logs) {
    const list = byTx.get(log.transactionHash) ?? [];
    list.push(log);
    byTx.set(log.transactionHash, list);
  }
  for (const list of byTx.values()) {
    list.sort((a, b) => a.logIndex - b.logIndex);
    list.forEach((log, i) => {
      log.__eventIndex = i;
    });
  }
  return logs;
}

function logToMeta(log, block) {
  return {
    author: log.args.author,
    index: log.args.index,
    block,
    prevBlock: log.args.prevBlock,
    title: decodeTitle(log.args.title),
    txHash: log.transactionHash,
    eventIndex: log.__eventIndex ?? 0,
    // Orders posts published in the same block — the feed's page cursor.
    logIndex: log.logIndex,
    // The block's timestamp (seconds) when the node put it on the log
    // (geth ≥ 1.14 and Erigon do); otherwise looked up, see withTimes().
    ts: log.blockTimestamp != null ? Number(log.blockTimestamp) : null,
  };
}

/** Run `fn` over `items` with at most `limit` in flight; results in order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const short = (s) => `${String(s).slice(0, 10)}…`;

/**
 * An address as an argument to the node. viem checks the EIP-55 checksum
 * of a mixed-case address and refuses one that fails it — which is what an
 * address typed or pasted into a URL in the wrong case looks like. All
 * lowercase is the same address and passes, so that is what goes out.
 */
const addrArg = (a) => String(a).toLowerCase();

/**
 * The real chain I/O for `chainId`. `log` is the chain's rpcLog.scoped().
 */
export function createChainIO(chainId, log) {
  const id = Number(chainId);
  const chain = getChain(id);
  const client = () => getClient(id);

  // A block's timestamp, once per block for the life of the page. Blocks
  // are immutable once mined, so the promise is kept for good — except on
  // failure, which is dropped so the next asker retries.
  const blockTimes = new Map(); // block (string) -> Promise<number|null>
  function blockTs(block) {
    const key = String(block);
    let hit = blockTimes.get(key);
    if (!hit) {
      hit = io
        .block(block)
        .then((b) => Number(b.timestamp))
        .catch(() => {
          blockTimes.delete(key);
          return null;
        });
      blockTimes.set(key, hit);
    }
    return hit;
  }

  /**
   * Attach `ts` to rows that lack it — one header read per distinct block,
   * a few in flight at a time, best-effort. Posts are sparse, so a window of
   * thousands of blocks costs at most a handful of these; the merged feed
   * orders by exact time, and a row without one is only ever an estimate.
   */
  async function withTimes(rows) {
    const missing = [...new Set(rows.filter((r) => r.ts == null).map((r) => String(r.block)))];
    if (missing.length === 0) return rows;
    const times = await mapLimit(missing, 4, (b) => blockTs(b));
    const byBlock = new Map(missing.map((b, i) => [b, times[i]]));
    for (const r of rows) {
      if (r.ts == null) r.ts = byBlock.get(String(r.block)) ?? null;
    }
    return rows;
  }

  const io = {
    chainId: id,
    /** False: what this reads is worth keeping in IndexedDB. */
    ephemeral: false,

    /** The node's current head. */
    blockNumber() {
      return log.fromNode(
        'eth_blockNumber',
        'chain head',
        () => client().getBlockNumber(),
        (h) => `block ${log.b(h)}`,
      );
    },

    /** `{ number, timestamp }` of a block, by height or `'latest'`. */
    async block(which) {
      const args = which === 'latest' ? { blockTag: 'latest' } : { blockNumber: BigInt(which) };
      const b = await log.fromNode(
        'eth_getBlockByNumber',
        which === 'latest' ? 'latest · chain clock' : `block ${log.b(which)} · chain clock`,
        () => client().getBlock(args),
        (out) => `block ${log.b(out.number)} @ ${out.timestamp}`,
      );
      return { number: b.number, timestamp: Number(b.timestamp) };
    },

    /**
     * Every Post event in `[from, to]`, all authors. Returns the top block
     * actually read: when the node hasn't seen `to` yet the window is
     * retried one block shorter, up to HEAD_RETRIES times, and the caller
     * claims coverage only up to what came back.
     */
    async postsInRange(from, to) {
      const bottom = BigInt(from);
      let top = BigInt(to);
      for (let attempt = 0; ; attempt++) {
        try {
          const logs = await log.fromNode(
            'eth_getLogs',
            log.range(bottom, top),
            () =>
              withRetry(() =>
                client().getLogs({
                  address: GLYPH_ADDRESS,
                  event: POST_EVENT,
                  fromBlock: bottom,
                  toBlock: top,
                }),
              ),
            (out) => `${out.length} post${out.length === 1 ? '' : 's'}`,
          );
          assignEventIndexes(logs);
          const rows = await withTimes(logs.map((l) => logToMeta(l, l.blockNumber)));
          return { rows, to: top };
        } catch (err) {
          if (isBeyondHead(err) && top > bottom && attempt < HEAD_RETRIES) {
            top -= 1n;
            log.headLowered(top);
            continue;
          }
          throw tagRangeError(err);
        }
      }
    },

    /** `author`'s Post events in one block. */
    async authorPostsInBlock(author, block) {
      // Block heights must reach viem as bigints — it hex-encodes bigints and
      // passes anything else through verbatim, so a plain number would go out
      // as a JSON number and every node rejects that.
      const at = BigInt(block);
      const logs = await log.fromNode(
        'eth_getLogs',
        `block ${log.b(at)} · author ${shortAddr(author)}`,
        () =>
          withRetry(() =>
            client().getLogs({
              address: GLYPH_ADDRESS,
              event: POST_EVENT,
              fromBlock: at,
              toBlock: at,
            }),
          ),
        (out) => `${out.length} event${out.length === 1 ? '' : 's'}`,
      );
      // Event indexes have to count EVERY Post event in the transaction, not
      // just this author's: /tx/<hash>/<i> is resolved by postsInTx(), which
      // decodes the receipt without an author filter. Number them first, then
      // narrow to the author (one tx can carry posts from several senders).
      assignEventIndexes(logs);
      const key = String(author).toLowerCase();
      return withTimes(
        logs.filter((l) => String(l.args.author).toLowerCase() === key).map((l) => logToMeta(l, at)),
      );
    },

    /** The block holding `author`'s newest post (0 when they have none). */
    latestBlock(author) {
      return log.fromNode(
        'latestBlock()',
        `author ${shortAddr(author)}`,
        () =>
          client().readContract({
            address: GLYPH_ADDRESS,
            abi,
            functionName: 'latestBlock',
            args: [addrArg(author)],
          }),
        (head) => `block ${log.b(head)}`,
      );
    },

    /** How many posts `author` has published. */
    count(author) {
      return log.fromNode(
        'count()',
        `author ${shortAddr(author)}`,
        () =>
          client().readContract({
            address: GLYPH_ADDRESS,
            abi,
            functionName: 'count',
            args: [addrArg(author)],
          }),
        (c) => `${c} posts`,
      );
    },

    /**
     * Every Post event a transaction emitted, in log order — one receipt
     * read, no scanning. Empty when the transaction published nothing.
     */
    async postsInTx(txHash) {
      const receipt = await log.fromNode(
        'eth_getTransactionReceipt',
        short(txHash),
        () => withRetry(() => client().getTransactionReceipt({ hash: txHash })),
        (r) => `${r.logs.length} logs in block ${log.b(r.blockNumber)}`,
      );
      const posts = [];
      for (const entry of receipt.logs) {
        if (entry.address.toLowerCase() !== GLYPH_ADDRESS.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi,
            eventName: 'Post',
            data: entry.data,
            topics: entry.topics,
          });
          posts.push({ log: entry, args: decoded.args });
        } catch {
          continue; // some other event from the same contract
        }
      }
      posts.sort((a, b) => a.log.logIndex - b.log.logIndex);
      const ts = posts.length ? await blockTs(receipt.blockNumber) : null;
      return posts.map(({ log: entry, args }, i) => ({
        author: args.author,
        index: args.index,
        block: receipt.blockNumber,
        prevBlock: args.prevBlock,
        title: decodeTitle(args.title),
        txHash,
        eventIndex: i,
        logIndex: entry.logIndex,
        ts,
      }));
    },

    /** `{ tags, markdown }` decoded from a publish() transaction's calldata. */
    async postBody(txHash) {
      const tx = await log.fromNode(
        'eth_getTransactionByHash',
        `body ${short(txHash)}`,
        () => client().getTransaction({ hash: txHash }),
        (t) => `${log.b((t.input.length - 2) / 2)} bytes calldata`,
      );
      const decoded = decodeFunctionData({ abi, data: tx.input });
      return decodePayload(hexToBytes(decoded.args[1]));
    },

    /** The raw bytes an image transaction carries as calldata. */
    async imageBytes(txHash) {
      const tx = await log.fromNode(
        'eth_getTransactionByHash',
        `image ${short(txHash)}`,
        () => client().getTransaction({ hash: txHash }),
        (t) => `${log.b((t.input.length - 2) / 2)} bytes`,
      );
      return hexToBytes(tx.input);
    },

    /** ENS name for `address`, or null — without a round trip on chains that have no ENS. */
    async ensName(address) {
      if (!chain.viem?.contracts?.ensUniversalResolver) return null;
      const name = await log.fromNode(
        'ens_getName',
        shortAddr(address),
        () => client().getEnsName({ address: addrArg(address) }),
        (v) => v ?? 'no name',
      );
      return name ?? null;
    },
  };
  return io;
}
