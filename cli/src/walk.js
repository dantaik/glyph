// walk.js — reading the chain: one post, one transaction, one author's list.
//
// This is webapp/src/lib/chainIO.js and the author half of scanner.js with
// the caching taken out. The app keeps a scan store because a browser comes
// back to the same author again and again and must not re-read what it has;
// a command-line run reads once and exits, so there is nothing to remember
// and the traversal is the whole of it.
//
// What is NOT simplified is the traversal itself. The contract keeps a
// reverse block-linked list per author — each post carries the block of the
// one before it — so an author's list is read by asking `latestBlock()` for
// the head and then following `prevBlock` down, ONE SINGLE-BLOCK eth_getLogs
// PER STEP. Never a range scan: a range scan over a chain with years of
// history is a request no public endpoint will answer, and the linked list
// exists precisely so that nobody has to make one.

import { decodeEventLog, decodeFunctionData, hexToBytes } from 'viem';
import { abi, DEFAULT_GLYPH_ADDRESS, POST_EVENT, chainSlug, decodeTitle, getChain } from './shared.js';
import { chainIds, endpointsFor } from './args.js';
import { createClient } from './chain.js';
import { decodePayload } from './payload.js';
import { fail } from './out.js';
import { msg } from './messages.js';

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
});

/**
 * Everything one chain can be asked for, over `client`.
 * @param {number} chainId
 * @param {import('viem').PublicClient} client
 */
export function createReader(chainId, client) {
  const id = Number(chainId);
  const chain = getChain(id);
  const address = DEFAULT_GLYPH_ADDRESS;

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

  return {
    chainId: id,
    chain,
    slug: chainSlug(id),
    name: chain.name,
    client,

    blockTs,

    /** The block holding `author`'s newest post — 0 when they have none. */
    latestBlock: (author) =>
      client.readContract({ address, abi, functionName: 'latestBlock', args: [addrArg(author)] }),

    /** How many posts `author` has published. */
    count: (author) =>
      client.readContract({ address, abi, functionName: 'count', args: [addrArg(author)] }),

    /** `author`'s Post events in one block, newest index first. */
    async authorPostsInBlock(author, block) {
      const at = BigInt(block);
      const logs = await client.getLogs({
        address,
        event: POST_EVENT,
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
     * Every Post event a transaction emitted, in log order — one receipt
     * read, no scanning at all.
     */
    async postsInTx(txHash) {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      const posts = [];
      for (const entry of receipt.logs) {
        if (entry.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi,
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
     * The body of a post, out of its publish() call's calldata. The chain
     * stores the document nowhere else: the event carries only the title, so
     * reading a post means reading the transaction that wrote it.
     */
    async postBody(txHash) {
      const tx = await client.getTransaction({ hash: txHash });
      let decoded;
      try {
        decoded = decodeFunctionData({ abi, data: tx.input });
      } catch {
        fail(msg.notPublishCall(txHash));
      }
      if (decoded.functionName !== 'publish') fail(msg.notPublishCall(txHash));
      return decodePayload(hexToBytes(decoded.args[1]));
    },

    /** The raw bytes an image transaction carries as its calldata. */
    async imageBytes(txHash) {
      const tx = await client.getTransaction({ hash: txHash });
      return hexToBytes(tx.input);
    },

    /**
     * `author`'s list, newest first, by following prevBlock from the head.
     *
     * `limit` stops it early; without one it runs to index 0, which is what
     * `export` needs and what makes `complete` true. `onRow` is called as
     * each row arrives so a long walk can report progress.
     *
     * @returns {{ rows, head: bigint, complete: boolean }} `complete` — the
     *   walk reached the author's first post, so nothing older exists.
     */
    async walkAuthor(author, { limit = null, onRow = null } = {}) {
      const head = await this.latestBlock(author);
      if (head === 0n) return { rows: [], head: 0n, complete: true };
      const rows = [];
      let block = BigInt(head);
      let complete = false;
      while (block > 0n) {
        const found = await this.authorPostsInBlock(author, block);
        // A block the head pointer names but that holds no event of this
        // author means the node is behind, or answering from a fork. Stop
        // rather than pretend the list ended here.
        if (found.length === 0) break;
        for (const row of found) {
          rows.push(row);
          onRow?.(row);
          if (row.index === 0n) complete = true;
          if (limit != null && rows.length >= limit) return { rows, head, complete };
        }
        const oldest = found[found.length - 1];
        if (oldest.index === 0n) break; // the author's first post
        const next = oldest.prevBlock;
        // The list must strictly descend; anything else — a truncated read, a
        // reorg, an inconsistent node — would loop for ever.
        if (next >= block) break;
        block = next;
      }
      return { rows, head, complete };
    },
  };
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
