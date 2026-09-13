// walk.js — reading the chain: one post, one transaction, one author's list.
//
// This is webapp/src/lib/chainIO.js and the author half of scanner.js with
// the caching taken out. The app keeps a scan store because a browser comes
// back to the same author again and again and must not re-read what it has;
// a command-line run reads once and exits, so there is nothing to remember
// and the traversal is the whole of it.
//
// What is NOT simplified is the traversal itself. Each contract keeps a
// reverse block-linked list per author — every post carries the block of
// the one before it on that contract — so an author's list is read by
// asking `latestBlock()` for the head and then following `prevBlock` down,
// ONE SINGLE-BLOCK eth_getLogs PER STEP. Never a range scan: a range scan
// over a chain with years of history is a request no public endpoint will
// answer, and the linked list exists precisely so that nobody has to make
// one.
//
// Two contracts, one journal. Logs are asked for from both addresses in
// one request and every row says which contract it is on; an author has a
// list on each, and `walkAuthor` walks both, taking the higher block first,
// so the rows come out newest first across the two. On a chain where the
// second contract is not deployed its views answer nothing, which reads as
// "never published there".

import { decodeEventLog, decodeFunctionData, hexToBytes } from 'viem';
import {
  CONTRACT_VERSIONS,
  POST_EVENTS,
  abiFor,
  abiV2,
  chainSlug,
  decodeTitle,
  defaultContractAddress,
  getChain,
} from './shared.js';
import { chainIds, endpointsFor } from './args.js';
import { createClient } from './chain.js';
import { decodePayload } from './payload.js';
import { fail } from './out.js';
import { msg } from './messages.js';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ADDRESSES = CONTRACT_VERSIONS.map((v) => defaultContractAddress(v));

/** Which contract version an address is, or null. */
const versionOf = (address) =>
  CONTRACT_VERSIONS.find((v) => defaultContractAddress(v).toLowerCase() === String(address ?? '').toLowerCase()) ?? null;

const hookOf = (args) => {
  const hook = args?.hook;
  return hook && String(hook).toLowerCase() !== ZERO_ADDRESS ? String(hook).toLowerCase() : null;
};

/**
 * A view called on an address with no code: the node answers `0x` and viem
 * refuses to decode nothing. That is a contract not deployed on this chain.
 */
const isNoContract = (err) =>
  err?.cause?.name === 'ContractFunctionZeroDataError' ||
  err?.name === 'ContractFunctionZeroDataError' ||
  /returned no data|"0x"/i.test(String(err?.shortMessage || err?.message || err));

/**
 * One transaction can publish several posts (a multicall), so a transaction
 * hash is not a post's identity — the pair (hash, ordinal) is. Number every
 * Post event within its transaction by log order, exactly as the app does,
 * so that `/tx/0x…/1` means the same thing here as it does in a browser.
 */
function assignEventIndexes(logs) {
  const byTx = new Map();
  for (const log of logs) {
    const list = byTx.get(log.transactionHash) ?? [];
    list.push(log);
    byTx.set(log.transactionHash, list);
  }
  for (const list of byTx.values()) {
    list.sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
    list.forEach((log, i) => {
      log.__eventIndex = i;
    });
  }
  return logs;
}

/** The reader's row shape, kept field for field the same as the app's. */
const rowOf = (log, block, ts) => ({
  author: log.args.author,
  index: log.args.index,
  block: BigInt(block),
  prevBlock: log.args.prevBlock,
  title: decodeTitle(log.args.title),
  txHash: log.transactionHash,
  eventIndex: log.__eventIndex ?? 0,
  logIndex: Number(log.logIndex),
  ts,
  version: versionOf(log.address) ?? 1,
  hook: hookOf(log.args),
});

/**
 * What a publish transaction's calldata says beyond the payload: which of
 * the three calls it was, the hook and its data, and for a relayed post the
 * author of record, the deadline and the signature.
 */
function describeCall({ functionName, args }) {
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
 * Everything one chain can be asked for, over `client`.
 * @param {number} chainId
 * @param {import('viem').PublicClient} client
 */
export function createReader(chainId, client) {
  const id = Number(chainId);
  const chain = getChain(id);

  // A block's timestamp, once per run. Blocks are immutable, and an author
  // walk asks for the same block once per post in it.
  const times = new Map();
  async function blockTs(block) {
    const key = String(block);
    if (!times.has(key)) {
      times.set(
        key,
        client.getBlock({ blockNumber: BigInt(block) }).then((b) => Number(b.timestamp)),
      );
    }
    return times.get(key);
  }

  /**
   * An address as an argument to the node: all lowercase. viem refuses a
   * mixed-case address whose EIP-55 checksum does not match, and an address
   * typed at a terminal is often exactly that.
   */
  const addrArg = (a) => String(a).toLowerCase();

  /** One contract's view of an author, or 0 where the contract is not deployed. */
  const authorView = (functionName, author, version) =>
    client
      .readContract({
        address: defaultContractAddress(version),
        abi: abiFor(version),
        functionName,
        args: [addrArg(author)],
      })
      .catch((err) => {
        if (isNoContract(err)) return 0n;
        throw err;
      });

  const reader = {
    chainId: id,
    chain,
    slug: chainSlug(id),
    name: chain.name,
    client,
    /** The contract versions every read here covers. */
    versions: [...CONTRACT_VERSIONS],

    blockTs,

    /** The block holding `author`'s newest post on one contract — 0 when they have none there. */
    latestBlock: (author, version = 1) => authorView('latestBlock', author, version),

    /** How many posts `author` has published on one contract. */
    count: (author, version = 1) => authorView('count', author, version),

    /** `author`'s Post events in one block, on every contract, newest index first within each. */
    async authorPostsInBlock(author, block) {
      const at = BigInt(block);
      const logs = await client.getLogs({
        address: ADDRESSES,
        events: POST_EVENTS,
        fromBlock: at,
        toBlock: at,
      });
      // Number every event in the block first and only then narrow to the
      // author: one transaction can carry posts from several senders, and an
      // ordinal that skipped the others would not be the app's ordinal.
      assignEventIndexes(logs);
      const key = addrArg(author);
      const mine = logs.filter((l) => addrArg(l.args.author) === key);
      if (mine.length === 0) return [];
      const ts = await blockTs(at);
      return mine.map((l) => rowOf(l, at, ts)).sort((a, b) => (a.index > b.index ? -1 : 1));
    },

    /**
     * Every Post event a transaction emitted, from either contract, in log
     * order — one receipt read, no scanning at all.
     */
    async postsInTx(txHash) {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      const posts = [];
      for (const entry of receipt.logs) {
        const version = versionOf(entry.address);
        if (version == null) continue;
        try {
          const decoded = decodeEventLog({
            abi: abiFor(version),
            eventName: 'Post',
            data: entry.data,
            topics: entry.topics,
          });
          posts.push({ ...entry, args: decoded.args });
        } catch {
          continue; // some other event from the same contract
        }
      }
      if (posts.length === 0) return [];
      posts.sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
      assignEventIndexes(posts);
      const ts = await blockTs(receipt.blockNumber);
      return posts.map((log) => rowOf(log, receipt.blockNumber, ts));
    },

    /**
     * The body of a post, out of its publish call's calldata. The chain
     * stores the document nowhere else: the event carries only the title, so
     * reading a post means reading the transaction that wrote it. Any of the
     * three calls — plain, through a hook, relayed — carries one; the record
     * says which (`form`), the hook and its data, who signed and who sent.
     */
    async postBody(txHash) {
      const tx = await client.getTransaction({ hash: txHash });
      let decoded;
      try {
        decoded = decodeFunctionData({ abi: abiV2, data: tx.input });
      } catch {
        fail(msg.notPublishCall(txHash));
      }
      if (decoded.functionName !== 'publish' && decoded.functionName !== 'publishFor') fail(msg.notPublishCall(txHash));
      const call = describeCall(decoded);
      return {
        ...decodePayload(hexToBytes(call.payload)),
        form: call.form,
        hook: call.hook,
        hookData: call.hookData,
        relayed: call.relayed,
        sender: tx.from ? String(tx.from).toLowerCase() : null,
      };
    },

    /** The raw bytes an image transaction carries as its calldata. */
    async imageBytes(txHash) {
      const tx = await client.getTransaction({ hash: txHash });
      return hexToBytes(tx.input);
    },

    /**
     * `author`'s list, newest first across both contracts, by following
     * prevBlock from each contract's head and always taking the higher
     * block next.
     *
     * `limit` stops it early; without one it runs to index 0 on every
     * contract, which is what `export` needs and what makes `complete`
     * true. `onRow` is called as each row arrives so a long walk can report
     * progress.
     *
     * @returns {{ rows, head: bigint, heads: Record<number, bigint>, complete: boolean }}
     *   `head` — the newest of the heads; `heads` — each contract's;
     *   `complete` — every contract's walk reached the author's first post
     *   there, so nothing older exists.
     */
    async walkAuthor(author, { limit = null, onRow = null } = {}) {
      const versions = this.versions;
      const headList = await Promise.all(versions.map((v) => this.latestBlock(author, v)));
      const heads = Object.fromEntries(versions.map((v, i) => [v, BigInt(headList[i])]));
      const head = headList.reduce((a, b) => (BigInt(b) > a ? BigInt(b) : a), 0n);
      const streams = versions.map((version, i) => ({
        version,
        cursor: BigInt(headList[i]),
        done: BigInt(headList[i]) === 0n,
        complete: BigInt(headList[i]) === 0n, // nothing there is a whole list
      }));
      const rows = [];
      // One fetch reads a block for every contract; a block both streams
      // point at is read once.
      const blocks = new Map();
      const readBlock = async (block) => {
        const key = String(block);
        if (!blocks.has(key)) blocks.set(key, this.authorPostsInBlock(author, block));
        return blocks.get(key);
      };
      for (;;) {
        let stream = null;
        for (const s of streams) if (!s.done && (stream == null || s.cursor > stream.cursor)) stream = s;
        if (!stream) break;
        const found = (await readBlock(stream.cursor)).filter((r) => r.version === stream.version);
        // A block the head pointer names but that holds no event of this
        // author on this contract means the node is behind, or answering
        // from a fork. Stop this list rather than pretend it ended here.
        if (found.length === 0) {
          stream.done = true;
          continue;
        }
        for (const row of found) {
          rows.push(row);
          onRow?.(row);
          if (row.index === 0n) stream.complete = true;
          if (limit != null && rows.length >= limit) {
            return { rows, head, heads, complete: streams.every((s) => s.complete) };
          }
        }
        const oldest = found[found.length - 1];
        if (oldest.index === 0n) {
          stream.done = true; // the author's first post on this contract
          continue;
        }
        const next = oldest.prevBlock;
        // The list must strictly descend; anything else — a truncated read, a
        // reorg, an inconsistent node — would loop for ever.
        if (next >= stream.cursor) {
          stream.done = true;
          continue;
        }
        stream.cursor = next;
      }
      return { rows, head, heads, complete: streams.every((s) => s.complete) };
    },
  };
  return reader;
}

/**
 * The post `txHash/eventIndex` names, with its body: the row from the
 * receipt and the document from the calldata, which is how every read in
 * this tool starts.
 */
export async function readPost(reader, { txHash, eventIndex = 0 }) {
  const rows = await reader.postsInTx(txHash).catch((err) => {
    // A hash the chain has never seen comes back as null from the node, which
    // viem reports as a not-found error; say which hash rather than echo it.
    if (/not be found|not found/i.test(String(err?.message))) fail(msg.noSuchTx(txHash));
    throw err;
  });
  if (rows.length === 0) fail(msg.noPostsInTx(txHash));
  const row = rows[eventIndex];
  if (!row) fail(msg.noSuchEvent(txHash, eventIndex, rows.length));
  const body = await reader.postBody(txHash);
  return { row, body };
}

/**
 * A reader per chain in `selection`, over the endpoints `--rpc` left behind.
 * Every command starts here, so that one chain and `all` are the same code
 * path with a list of one in it.
 */
export function readersFor(selection, overrides) {
  return chainIds(selection).map((id) => createReader(id, createClient(id, endpointsFor(id, overrides))));
}
