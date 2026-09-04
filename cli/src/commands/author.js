// author.js — an author's list, newest first.
//
// The walk is the point. The contract keeps a reverse block-linked list per
// author, so this asks `latestBlock()` for the head and then follows
// `prevBlock` down with one single-block eth_getLogs per step — exactly what
// the author page in the browser does, and never a range scan. That is why
// the command costs the same on a chain with a decade behind it as on a new
// one, and why it works against endpoints that refuse wide log queries.
//
// `all` walks every chain the app reads and merges the results by block
// time, so an author who writes on both sees one list rather than two —
// again the same rule as the app, whose author page merges the chains the
// same way.

import { chainIds, parseAddressArg, parseLimit, readArgs, readRpcOverrides, resolveChain } from '../args.js';
import { onChain } from '../chain.js';
import { SITE, help, msg } from '../messages.js';
import { fail, print, printJson } from '../out.js';
import { readersFor } from '../walk.js';

export const OPTIONS = {
  limit: { type: 'string' },
};

/** The day a post was mined, as the reader's own calendar would not have it — UTC, unambiguous. */
export const dayOf = (ts) => (ts == null ? '' : new Date(Number(ts) * 1000).toISOString().slice(0, 10));

/**
 * Newest first. Time is the honest order across chains — a block height on
 * Taiko and one on Ethereum are not comparable — with the block and the log
 * ordinal breaking a tie inside one chain.
 */
export function newestFirst(a, b) {
  if (a.ts !== b.ts) return (b.ts ?? 0) - (a.ts ?? 0);
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.block !== b.block) return Number(b.block - a.block);
  return b.logIndex - a.logIndex;
}

export async function run(argv) {
  const { values, positionals } = readArgs(argv, OPTIONS);
  if (values.help) return print(help.author);

  const [chainArg, addressArg] = positionals;
  const chain = chainArg ?? values.chain;
  if (!chain) fail(msg.needsChain('author'));
  if (!addressArg) fail(msg.needsAddress('author'));
  const selection = resolveChain(chain, { allowAll: true, command: 'author' });
  const address = parseAddressArg(addressArg);
  const limit = parseLimit(values.limit);

  const readers = readersFor(selection, readRpcOverrides(values.rpc));
  const rows = [];
  for (const reader of readers) {
    // Each chain's own limit: `all` with a limit wants the newest n overall,
    // and the newest n overall can only come out of the newest n from each.
    const walked = await onChain(reader.name, () => reader.walkAuthor(address, { limit }));
    for (const row of walked.rows) rows.push({ ...row, chainId: reader.chainId, slug: reader.slug, name: reader.name });
  }
  rows.sort(newestFirst);
  const shown = limit == null ? rows : rows.slice(0, limit);

  if (values.json) {
    return printJson(
      shown.map((row) => ({
        chainId: row.chainId,
        chain: row.slug,
        txHash: row.txHash,
        eventIndex: row.eventIndex,
        author: row.author,
        index: row.index,
        block: row.block,
        prevBlock: row.prevBlock,
        logIndex: row.logIndex,
        ts: row.ts,
        date: dayOf(row.ts),
        title: row.title,
        url: `${SITE}/${row.slug}/tx/${row.txHash}/${row.eventIndex}`,
      })),
    );
  }

  if (shown.length === 0) {
    const where = selection === 'all' ? chainIds(selection).length : 1;
    return print(where > 1 ? `${address} has published nothing on any chain.` : msg.noPosts(address));
  }
  for (const row of shown) {
    // Two lines a post: the title on its own so it is readable at any width,
    // and the provenance under it with the FULL transaction hash — the thing
    // the next command will be given, so it has to be copyable.
    print(`#${row.index}  ${row.title}`);
    print(`    ${row.slug} · block ${row.block} · ${dayOf(row.ts)} · ${row.txHash}`);
  }
}
