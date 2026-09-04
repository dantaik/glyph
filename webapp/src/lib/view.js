// view.js — the set of chains being read, as one thing.
//
// A view is a list of readers (data.js hands out one per chain, alive for
// the page) and the merged controllers over them: the feed, an author's
// list, counts. The app reads every deployed chain by default; a URL that
// names one chain (`/taiko`) reads that chain alone. Views are memoized by
// their chain set, so the merged and the single-chain view of Taiko share
// the same Taiko reader — and the same running scan.

import { addrKey } from './scanStore';
import { DEFAULT_CHAIN_ID } from './chains';
import { READ_CHAIN_IDS } from './config';
import { getReader } from './data';
import { MergedAuthorList } from './mergedAuthorList';
import { MergedFeed } from './mergedFeed';
import { PAGE_SIZE } from './reader';
import { compareMerged, timeRows } from './timeline';
import { useUrlState } from './router';

/**
 * Compose readers into a view. Pure: tests build views over readers with
 * their own stores. `ensReader` answers ENS lookups — only Ethereum hosts
 * ENS, and an address is the same on every chain, so a Taiko-only view
 * still asks mainnet.
 */
export function createView(readers, { pageSize = PAGE_SIZE, ensReader = null } = {}) {
  const list = [...readers].sort((a, b) => a.chainId - b.chainId);
  const byId = new Map(list.map((r) => [r.chainId, r]));
  const chainIds = list.map((r) => r.chainId);
  const key = chainIds.join(',');

  const chainOf = (r) => ({
    chainId: r.chainId,
    store: r.store,
    clock: r.clock,
    blockTime: r.blockTime,
  });

  const feed = new MergedFeed({
    chains: list.map((r) => ({ ...chainOf(r), feed: r.feed, floor: r.feed.floor })),
    pageSize,
  });

  const lists = new Map(); // addrKey -> MergedAuthorList
  function authorList(author) {
    const k = addrKey(author);
    let merged = lists.get(k);
    if (!merged) {
      merged = new MergedAuthorList({
        author,
        chains: list.map((r) => ({ ...chainOf(r), list: r.authorList(author) })),
      });
      lists.set(k, merged);
    }
    return merged;
  }

  /**
   * Every post these chains have READ, merged newest first — not every post
   * that exists.
   *
   * The feed shows posts inside swept ranges, because a hole in a feed is a
   * lie about what is newest. Finding by tag or by word is a different
   * question: any post this browser holds is a fair answer, whether it came
   * from a sweep, an author's page or a link somebody sent. The surfaces
   * that use this say what it covers.
   */
  function knownRows() {
    return list.flatMap((r) => timeRows(r.store.allPosts(), r.chainId, null)).sort(compareMerged);
  }

  /** `{ total, byChain }` — total is null until every chain has answered. */
  async function counts(author) {
    const settled = await Promise.allSettled(list.map((r) => r.count(author)));
    const byChain = {};
    let total = 0n;
    let complete = true;
    settled.forEach((res, i) => {
      const id = list[i].chainId;
      if (res.status === 'fulfilled' && res.value != null) {
        byChain[id] = BigInt(res.value);
        total += byChain[id];
      } else {
        byChain[id] = null;
        complete = false;
      }
    });
    return { total: complete ? total : null, byChain };
  }

  const ens = ensReader ?? byId.get(DEFAULT_CHAIN_ID) ?? null;
  const ensName = (address) => (ens ? ens.ensName(address) : Promise.resolve(null));

  /** The reader for one of this view's chains (null when it isn't in the view). */
  const reader = (chainId) => byId.get(Number(chainId)) ?? null;

  const need = (chainId) => {
    const r = byId.get(Number(chainId));
    if (!r) throw new Error(`chain ${chainId} is not in this view`);
    return r;
  };

  const loadPostBody = (post) => need(post.chainId).loadPostBody(post.txHash);
  const findMetaByTx = (chainId, txHash, eventIndex = 0) => need(chainId).findMetaByTx(txHash, eventIndex);

  /**
   * A post by transaction hash when the URL didn't say which chain: one
   * receipt read per chain, the lowest chain id that has it wins.
   */
  async function findPostAnywhere(txHash, eventIndex = 0) {
    const settled = await Promise.allSettled(list.map((r) => r.findMetaByTx(txHash, eventIndex)));
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === 'fulfilled' && res.value) return { chainId: list[i].chainId, meta: res.value };
    }
    return null;
  }

  return {
    key,
    chainIds,
    readers: list,
    reader,
    feed,
    authorList,
    counts,
    ensName,
    knownRows,
    loadPostBody,
    findMetaByTx,
    findPostAnywhere,
  };
}

/** The chains a URL filter selects: that chain alone, or every chain read. */
export const viewChainsFor = (filter) => (filter != null ? [Number(filter)] : READ_CHAIN_IDS);

/** Every chain the app reads, as one view — the footer's, whatever the page shows. */
export const getAllChainsView = () => getView(READ_CHAIN_IDS);

const views = new Map(); // key -> view

/** The view over `chainIds`, created on first use and kept for the page. */
export function getView(chainIds) {
  const ids = [...new Set(chainIds.map(Number))].sort((a, b) => a - b);
  const key = ids.join(',');
  let view = views.get(key);
  if (!view) {
    view = createView(
      ids.map((id) => getReader(id)),
      { ensReader: getReader(DEFAULT_CHAIN_ID) },
    );
    views.set(key, view);
  }
  return view;
}

/** React hook: the view the URL asks for — one chain when it names one, else all. */
export function useView() {
  const [params] = useUrlState();
  return getView(viewChainsFor(params.chain));
}
