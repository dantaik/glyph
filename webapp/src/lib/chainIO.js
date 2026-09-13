// chainIO.js — every chain read the reader makes, for ONE chain.
//
// A thin surface over viem: block heights and hashes in, post metadata and
// bytes out. It knows nothing about caching or traversal — that is
// scanStore.js and scanner.js — which is what lets fixtures.js stand in for
// it with an in-memory chain and run the real reader on top.
//
// Every call goes through the chain's client of the moment (clients.js), so
// an edited endpoint list applies to the next request, even mid-sweep.
//
// One chain, two contracts. Logs are asked for from both addresses in one
// request (eth_getLogs takes a list), and every row says which contract it
// came from; the head pointer and the count are per contract, because an
// author has a list on each. On a chain where v2 is not deployed yet, its
// logs are simply absent and its two views answer no data, which reads as
// "never published there" — so nothing has to be configured when it lands.

import { decodeEventLog, decodeFunctionData, hexToBytes, zeroAddress } from 'viem';
import { normalize } from 'viem/ens';
import { POST_EVENTS, abiFor, abiV2 } from './abi';
import { mapLimit } from './async';
import { getChain } from './chains';
import { getClient } from './clients';
import { CONTRACTS, contractAddress, contractVersionOf } from './config';
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

const ZERO_ADDRESS = zeroAddress;

/** The addresses read on every chain, and the versions they are. */
const ADDRESSES = CONTRACTS.map((c) => c.address);
const VERSIONS = CONTRACTS.map((c) => c.version);

/**
 * ENS names are normalised before they are hashed (UTS-46 plus ENSIP-15), so
 * "Xiaoman.ETH" and "xiaoman.eth" are the same name. A name that cannot be
 * normalised is not a name; viem would throw, and the caller wants null.
 */
const normalizeEns = (name) => normalize(String(name).trim());

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

/**
 * A view called on an address with no code at it: the node answers `0x`
 * and viem refuses to decode nothing. That is what a contract not yet
 * deployed on this chain looks like, and it means "no posts here".
 */
const isNoContract = (err) =>
  err?.cause?.name === 'ContractFunctionZeroDataError' ||
  err?.name === 'ContractFunctionZeroDataError' ||
  /returned no data|"0x"/i.test(errorText(err));

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
 * ordinal among the Post events of its transaction (by logIndex order),
 * whichever contract emitted them.
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

/** Which contract a log came from. A log with no address (a test double) is v1's. */
const versionOf = (log) => (log.address == null ? 1 : contractVersionOf(log.address));

const hookOf = (args) => {
  const hook = args?.hook;
  if (!hook || String(hook).toLowerCase() === ZERO_ADDRESS) return null;
  return String(hook).toLowerCase();
};

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
    version: versionOf(log) ?? 1,
    hook: hookOf(log.args),
  };
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
 * What a publish transaction's calldata says beyond the payload: which of
 * the three calls it was, the hook and its data, and for a relayed post the
 * author of record, the deadline and the signature.
 */
function describeCall(decoded) {
  const { functionName, args } = decoded;
  if (functionName === 'publishFor') {
    return {
      form: 'publishFor',
      payload: args[2],
      hook: hookOf({ hook: args[3] }),
      hookData: args[4],
      relayed: { author: String(args[0]).toLowerCase(), deadline: String(args[5]), signature: args[6] },
    };
  }
  if (args.length >= 4) {
    return { form: 'publishWithHook', payload: args[1], hook: hookOf({ hook: args[2] }), hookData: args[3], relayed: null };
  }
  return { form: 'publish', payload: args[1], hook: null, hookData: '0x', relayed: null };
}

/**
 * The real chain I/O for `chainId`. `log` is the chain's rpcLog.scoped().
 */
export function createChainIO(chainId, log) {
  const id = Number(chainId);
  const chain = getChain(id);
  const client = () => getClient(id);

  // Only Ethereum mainnet hosts ENS. Asking any other chain is a wasted
  // round trip that can only answer null, so it is never made.
  const hasEns = Boolean(chain.viem?.contracts?.ensUniversalResolver);

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

  /** Whether a contract version has code on this chain — once per page. */
  const deployed = new Map(); // version -> Promise<boolean>
  function isDeployed(version) {
    const v = Number(version);
    let hit = deployed.get(v);
    if (!hit) {
      const address = contractAddress(v);
      hit = address
        ? log
            .fromNode(
              'eth_getCode',
              `contract v${v}`,
              () => client().getCode({ address }),
              (code) => (code && code !== '0x' ? 'deployed' : 'not deployed'),
            )
            .then((code) => Boolean(code && code !== '0x'))
            .catch((err) => {
              deployed.delete(v); // ask again next time
              throw err;
            })
        : Promise.resolve(false);
      deployed.set(v, hit);
    }
    return hit;
  }

  /** One contract's view of an author, or 0 where the contract is not deployed. */
  function authorView(functionName, author, version) {
    const v = Number(version);
    const address = contractAddress(v);
    if (!address) return Promise.resolve(0n);
    return log.fromNode(
      `${functionName}()`,
      `author ${shortAddr(author)} · v${v}`,
      () =>
        client()
          .readContract({
            address,
            abi: abiFor(v),
            functionName,
            args: [addrArg(author)],
          })
          .catch((err) => {
            if (isNoContract(err)) return 0n;
            throw err;
          }),
      (n) => (functionName === 'count' ? `${n} posts` : `block ${log.b(n)}`),
    );
  }

  const io = {
    chainId: id,
    /** False: what this reads is worth keeping in IndexedDB. */
    ephemeral: false,
    /** The contract versions every read here covers. */
    versions: VERSIONS,

    /** The node's current head. */
    blockNumber() {
      return log.fromNode(
        'eth_blockNumber',
        'chain head',
        () => client().getBlockNumber(),
        (h) => `block ${log.b(h)}`,
      );
    },

    /**
     * `{ number, timestamp, baseFeePerGas }` of a block, by height or
     * `'latest'`. The base fee is what the gas history samples (gasHistory.js);
     * it is null on a chain, or from a node, that does not report one.
     */
    async block(which) {
      const args = which === 'latest' ? { blockTag: 'latest' } : { blockNumber: BigInt(which) };
      const b = await log.fromNode(
        'eth_getBlockByNumber',
        which === 'latest' ? 'latest · chain clock' : `block ${log.b(which)} · chain clock`,
        () => client().getBlock(args),
        (out) => `block ${log.b(out.number)} @ ${out.timestamp}`,
      );
      return {
        number: b.number,
        timestamp: Number(b.timestamp),
        baseFeePerGas: b.baseFeePerGas == null ? null : BigInt(b.baseFeePerGas),
      };
    },

    /**
     * Every Post event in `[from, to]`, all authors, both contracts. Returns
     * the top block actually read: when the node hasn't seen `to` yet the
     * window is retried one block shorter, up to HEAD_RETRIES times, and the
     * caller claims coverage only up to what came back.
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
                  address: ADDRESSES,
                  events: POST_EVENTS,
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

    /** `author`'s Post events in one block, on every contract. */
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
              address: ADDRESSES,
              events: POST_EVENTS,
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

    /** The block holding `author`'s newest post on one contract (0 when they have none there). */
    latestBlock(author, version = 1) {
      return authorView('latestBlock', author, version);
    },

    /** How many posts `author` has published on one contract. */
    count(author, version = 1) {
      return authorView('count', author, version);
    },

    isDeployed,

    /**
     * Every Post event a transaction emitted, in log order, from either
     * contract — one receipt read, no scanning. Empty when the transaction
     * published nothing.
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
        const version = contractVersionOf(entry.address);
        if (version == null) continue;
        try {
          const decoded = decodeEventLog({
            abi: abiFor(version),
            eventName: 'Post',
            data: entry.data,
            topics: entry.topics,
          });
          posts.push({ log: entry, args: decoded.args, version });
        } catch {
          continue; // some other event from the same contract
        }
      }
      posts.sort((a, b) => a.log.logIndex - b.log.logIndex);
      const ts = posts.length ? await blockTs(receipt.blockNumber) : null;
      return posts.map(({ log: entry, args, version }, i) => ({
        author: args.author,
        index: args.index,
        block: receipt.blockNumber,
        prevBlock: args.prevBlock,
        title: decodeTitle(args.title),
        txHash,
        eventIndex: i,
        logIndex: entry.logIndex,
        ts,
        version,
        hook: hookOf(args),
      }));
    },

    /**
     * The body of a post, decoded from its publish transaction's calldata:
     * `{ meta, tags, markdown, text, compressedBytes, form, hook, hookData,
     * relayed, sender }`. `text` is the exact document the chain holds (the
     * raw view, a `.md` download and an archive all carry it verbatim) and
     * `compressedBytes` is what it cost to store. `form` is which of the
     * three calls carried it; `hook` and `hookData` (hex) say which hook the
     * post went through; `relayed` names the author of record, the deadline
     * and the signature of a post somebody else submitted; `sender` is the
     * account that sent the transaction.
     */
    async postBody(txHash) {
      const tx = await log.fromNode(
        'eth_getTransactionByHash',
        `body ${short(txHash)}`,
        () => client().getTransaction({ hash: txHash }),
        (t) => `${log.b((t.input.length - 2) / 2)} bytes calldata`,
      );
      // v2's ABI decodes every form, v1's plain call included (same selector).
      const call = describeCall(decodeFunctionData({ abi: abiV2, data: tx.input }));
      const bytes = hexToBytes(call.payload);
      const body = await decodePayload(bytes);
      return {
        ...body,
        compressedBytes: bytes.length,
        form: call.form,
        hook: call.hook,
        hookData: call.hookData,
        relayed: call.relayed,
        sender: tx.from ? String(tx.from).toLowerCase() : null,
      };
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
      if (!hasEns) return null;
      const name = await log.fromNode(
        'ens_getName',
        shortAddr(address),
        () => client().getEnsName({ address: addrArg(address) }),
        (v) => v ?? 'no name',
      );
      return name ?? null;
    },

    /** Does this chain host ENS at all? Only mainnet does; the rest never ask. */
    hasEns,

    /** The address a name points at, or null. */
    async ensAddress(name) {
      if (!hasEns) return null;
      const address = await log.fromNode(
        'ens_getAddress',
        name,
        () => client().getEnsAddress({ name: normalizeEns(name) }),
        (v) => v ?? 'no address',
      );
      // The resolver answers the zero address for a name with no record.
      return address && address !== ZERO_ADDRESS ? address : null;
    },

    /** The avatar a name publishes, already resolved to a URL, or null. */
    async ensAvatar(name) {
      if (!hasEns) return null;
      const url = await log.fromNode(
        'ens_getAvatar',
        name,
        () => client().getEnsAvatar({ name: normalizeEns(name) }),
        (v) => v ?? 'no avatar',
      );
      return url ?? null;
    },

    /** One text record of a name (`description`, `url`, `com.github`…), or null. */
    async ensText(name, key) {
      if (!hasEns) return null;
      const value = await log.fromNode(
        'ens_getText',
        `${name} ${key}`,
        () => client().getEnsText({ name: normalizeEns(name), key }),
        (v) => v ?? 'empty',
      );
      return value || null;
    },
  };
  return io;
}
