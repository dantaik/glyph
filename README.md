# Xueni · 雪泥

A multi-author writing system that lives entirely on Ethereum (**Xueni** is the pinyin of 雪泥, from
the idiom 雪泥鸿爪 — the prints a wild goose leaves in the snow). **One non-upgradeable,
ownerless smart contract**, in which every wallet is its own author (`msg.sender`). Text,
titles, tags and images all live in L1 calldata, with no off-chain dependencies.

The interface reads in **English by default and can be switched to Chinese** at any time.

Technical design: [`glyph-spec.md`](./glyph-spec.md)

## Quick start

The contract is deployed, and both its address (the same on every chain, via CREATE2) and each
chain's default RPC endpoints are built into the front end — clone and run, **no configuration
needed**:

```bash
cd webapp && npm install && npm run dev
```

Deploying to a static host such as Vercel or Netlify is equally configuration-free: `vercel.json`
is ready, so import the repository as it is. `npm run build` puts the output in `dist/`.

**Optional — deploy your own copy of the contract** (anyone may; the deployer holds no privilege):

```bash
cd contracts && forge install foundry-rs/forge-std
forge script script/Create2Deploy.s.sol:Create2DeployGlyph \
  --rpc-url $ETH_RPC --broadcast   # PRIVATE_KEY comes from the environment (the script reads it with vm.envUint)

# Point the front end at your own copy. Vite inlines these at build time, so a
# change here means rebuilding.
cat > webapp/.env.local <<EOF
VITE_GLYPH_ADDRESS=0xYourDeployedAddress
VITE_RPC_URL=https://eth.drpc.org
VITE_CHAIN_ID=1
EOF
```

**Reading**: visit `/` (the newest posts from both Ethereum and Taiko, merged newest-first by block
time), `/ethereum` or `/taiko` (one chain only), `/author/0xAUTHOR` (that author's posts from both
chains merged; `/taiko/author/0x…` for one chain), `/taiko/tx/0xTXHASH/0` (a single post — the path
names the chain, and the trailing number is the event's index within the transaction; an older link
without a chain is looked up on both chains and then redirected), or `/scan` (the multi-segment block
ranges this browser has scanned so far, reachable from the footer). Add `?headless=1` to a post URL
(`/taiko/tx/0xTXHASH/0?headless=1`) to get that post with no app around it — no masthead, no site
footer, no back button and no previous/next cards, just the letter, its byline and its provenance —
for embedding one in an iframe or a preview pane. It applies to post URLs only and to that page
alone: a link followed out of it lands in the ordinary interface.
**Writing**: the "Wallet and network" panel at the top of the Write tab — connect a wallet, choose which
chain to publish to (it follows the wallet's own network until you pick one, and then it is remembered),
and switch the wallet's network in one click when it is on the wrong chain → then a title (32 bytes at
most) + tags + a Markdown body (CodeMirror editing, full-width preview) → publish. To reference another
post from the body, write `[text](0xTXHASH/0)` (spec §8.1).
**Paging**: "Load earlier posts" at the foot of the feed and author pages scans backwards a segment at a
time — a block range already scanned is answered from the local cache and never requested again. When the
feed has unscanned blocks between two scanned segments, it says so in the middle of the list and offers to
fill just that gap.
**Networks**: the contract sits at the same address on Ethereum mainnet and Taiko mainnet, and the front
end treats the two as one journal: the feed and author pages read both at once, and each post is labelled
with its network (click it for a single-chain view; the list header has "View all" to come back). Each
chain scans independently, and where the slower one has only reached is marked in the list ("The posts
below may be incomplete: Taiko has only been scanned back to …"); "Keep scanning" / "Load earlier posts"
deepens whichever chain is furthest behind. Scan ranges, titles, bodies and image caches are separate per
chain, and the footer gives each chain a line.
**Scanning**: the feed scans block ranges newest-first, and every finished segment (one `eth_getLogs`)
shows its posts immediately rather than waiting for the whole scan; leaving the feed (to open a post, an
author or the settings) does not interrupt it. Each scan (opening the feed, one click of "Load earlier
posts") reads at most `scanBlocks` blocks from the node (270,000 by default, see
`webapp/src/lib/chains.js`), with already-scanned ranges not counting towards it; nothing below the
contract's deployment block (`deployBlock`) is ever read. That ceiling is spelled out in the on-page scan
progress, on `/scan`, and in the console.
**RPC endpoints**: the ⚙ in the top right opens `/settings` (folded into the ⋯ menu on a phone), where each
chain can hold several endpoints in order — the first is used, and a failure falls back to the next (a
failed endpoint is set aside briefly rather than retried on every request). Saving takes effect at once,
without a reload.
**Rescan delay and caching**: the same `/settings` page sets the "blockchain rescan delay" — within that
long after a scan finishes, reopening the feed or an author page shows what the last scan found instead of
asking the node for new blocks (1 minute by default; 0 scans every time). It only decides when new blocks
are read, and never misses a post. What has already been read is cached **permanently**: on-chain data
does not change, so one post's metadata, title, body and images are never requested twice.
**Language**: the interface is in English by default and switches to Chinese from the header (the EN/中
button, or the ⋯ menu on a phone) or from `/settings`. The choice applies immediately, is kept in this
browser, and travels in the settings file. It changes the interface only — a post stays on-chain in the
language it was written in.
**Backup and restore**: "Export settings" on `/settings` writes the endpoint lists, rescan delay, publish
target, language, theme and log switch to one JSON file; "Import settings" lists what it would
change first and applies it on confirmation, with no reload.
**Interface**: an author is shown as a blockies icon generated from their address plus the last 6
characters of it (contracts and transaction hashes still use `0x1234…abcd`). On a narrow screen the
language, theme and settings controls fold into the ⋯ menu and everything else stays on one row.
**Console**: every node request and every local cache hit writes one console line, labelled with the chain;
`?log=0` turns it off.
**Cost estimate**: gas (from the node) plus ETH/USD (from CoinGecko) shown live before publishing.

## Testing

```bash
cd webapp
npm test            # vitest: the data layer (scanning, caching, merged feeds, routing, config) and components
npm run build       # build the site into dist/
npm run test:e2e    # Playwright (Chromium): the built output + a local JSON-RPC mock node (both chains)
npm run check       # all three
```

The e2e mock node (`webapp/test/e2e/rpcServer.mjs`) serves the demo world (`src/lib/fixtureWorld.js`) over
JSON-RPC at the real contract's deployment heights: `eth_getLogs` returns ABI-encoded Post events whose
bodies are brotli-compressed `publish()` calldata, so viem, chainIO and the brotli WASM all really run.
During development, `npm run dev` and then `/?fixtures=1` shows the same demo data from memory. GitHub
Actions (`.github/workflows/ci.yml`) runs all three steps on every PR.

Most of the demo world is written in English. Two of its posts are deliberately left in Chinese: they are
the multi-byte-title fixtures — one title is exactly 27 bytes of UTF-8, the other is a `bytes32` title cut
mid-character and ending in U+FFFD — and neither case can be reproduced with ASCII. They double as
something real to look at in the bilingual reader.

## Deterministic deployment (CREATE2 · the same address everywhere)

Xueni is deployed with CREATE2 through the canonical deterministic deployment proxy (Arachnid,
`0x4e59b44847b379578588920cA78FbF26c0B4956C`). A CREATE2 address is decided only by
`(deployer, salt, init-code hash)`, and the proxy itself can be deployed to the same address on any EVM
chain with one replayable transaction (a one-time account) — so **Xueni has the same address on every EVM
chain**:

```
contract address: 0x000000AE2f2249c497cfc5F262dd1491634C361C   (6 leading zeros)
salt:             0x00436d208c20757dde791d2c0c0909a2c8ea61482d3fa516692d9ee5244440f1
deployer (proxy): 0x4e59b44847b379578588920cA78FbF26c0B4956C
init code hash:   0x2d087c683d199f0d5d835f323462ddb3680ba048a4ef29f350dd784f3402b5cb
```

The Solidity contract itself is still named `Glyph`: the name is part of the compiled metadata, so the
init code hash — and with it the address the contract already lives at on every chain — depends on it.

- **The deploy script**: `script/Create2Deploy.s.sol`, idempotent (if the address already holds code it
  verifies and exits). Anyone may run it, and the deployer holds no privilege.
- **Chains where the proxy is missing**: first send ≥ 0.01 ETH (100,000 gas × 100 gwei) to the one-time
  signing account `0x3fab184622dc19b6109349b94811493bf2a45362`, then replay the raw signed transaction from
  `output/deployment.json` in Arachnid's repository (replaying it on any chain produces the same proxy
  address):

  ```bash
  cast publish 0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222
  ```

- **Bytecode drift**: any change to `Blog.sol` changes the init code hash, and therefore the address. Mine a
  new salt and update the three constants in `Create2Deploy.s.sol`:

  ```bash
  cast create2 --starts-with 000000 --init-code $(forge inspect src/Blog.sol:Glyph bytecode)
  ```

- **Verifying the contract**: `forge verify-contract 0x000000AE2f2249c497cfc5F262dd1491634C361C src/Blog.sol:Glyph --chain <chainid> --etherscan-api-key $KEY`
- **An ordinary deployment** (the address then varies by chain): `forge script script/Deploy.s.sol:DeployBlog --rpc-url $ETH_RPC --broadcast`

## Deployment record

Contract address (identical on every chain): `0x000000AE2f2249c497cfc5F262dd1491634C361C`

| Chain | Chain ID | Deployment tx | Deployer | Date | Verified |
|---|---|---|---|---|---|
| Ethereum mainnet | 1 | [0x5f16…ce9a](https://etherscan.io/tx/0x5f16b4d2375109968578502bdf899ded4cc7fc6c2608bbb738ffa7dbdc3bce9a) | `0x327f…c458` | 2026-09-02 | ✅ [Etherscan](https://etherscan.io/address/0x000000AE2f2249c497cfc5F262dd1491634C361C#code) |
| Taiko mainnet | 167000 | [0x6c66…dae7](https://taikoscan.io/tx/0x6c6645e2258432d01fae5e9e0f6b5c33bccade234a9628afced413e600e0dae7) | `0x327f…c458` | 2026-09-02 | ✅ [Taikoscan](https://taikoscan.io/address/0x000000AE2f2249c497cfc5F262dd1491634C361C#code) |

The deployer address `0x327fa3369B1D1D42120d84bc407e5865ECa7c458` holds no privilege over the contract,
which has no owner and cannot be upgraded.

## License

MIT
