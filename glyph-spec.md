# 岩刻 (Glyph) — 完全存在以太坊上的岩刻系统

> 技术方案与参考实现 · 2026-06
>
> 一个把全部内容（文字与图片）存在 Ethereum L1 calldata 上的多作者博客，
> 零链下依赖，按"比作者活得更久、孩子几十年后仍能读"来设计。
> 工作名：**岩刻** / **Glyph**（项目代号）。

---

## 目录

1. [核心原则](#1-核心原则)
2. [整体架构](#2-整体架构)
3. [成本](#3-成本)
4. [智能合约 `Blog.sol`](#4-智能合约-blogsol)（合约名 `Glyph`）
5. [Payload 编码 (`payload.js`)](#5-payload-编码-payloadjs)
6. [发布流水线 `publish.js`](#6-发布流水线-publishjs)
7. [读取器 `blogReader.js`](#7-读取器-blogreaderjs)
8. [Markdown 子集与渲染](#8-markdown-子集与渲染)
9. [永久性与自托管](#9-永久性与自托管)
10. [设计决策记录](#10-设计决策记录)
11. [附录：常量、依赖、部署](#11-附录常量依赖部署)

---

## 1. 核心原则

- **只信以太坊。** 文字、标题、标签、图片字节全部进 calldata，没有 IPFS / Arweave / 任何服务器。
- **一个合约，任意多作者。** 合约**不可升级、无所有者**；任何 `msg.sender` 都是它自己的作者，
  彼此的发布流互不干扰。作者身份就是钱包地址，无需注册、无需许可。
- **存纯 Markdown（子集）。** 开放、人类可读、任何编辑器永远打得开。
- **正文用 brotli q11 压缩**，无自定义字典；解码端零额外数据。
- **图片：q60 WebP，每张单独发一笔纯 calldata 交易**，把 32 字节 txhash 写进 Markdown（`eth:0x...`）。
- **每位作者 O(1) 取最新 + 反向区块链表**：读取永远只查单个区块，绝不扫块范围。
- **标题、标签、正文分层放置**：
  - 标题 = `bytes32`（独立 calldata 参数，进 event 让"标题列表"查询零字节解压成本）
  - 正文 + 标签 = brotli 压缩的 **Markdown 文档（带可选 YAML front-matter 标签头）**，**只放在 publish() 交易的 calldata 里**，不进 event。
  - 读取器先 `getLogs` 拿一组标题（无 body），点击具体一篇时再 `getTransactionByHash` 拿 body。
- **首页（无地址）= 最近 N 篇跨作者**：用有界的客户端扫描（见 §7），这是全篇唯一一处刻意的范围扫描，仅用于"无地址时的发现"，单作者路径仍是 O(1)。
- **永久性 = 链上锚定 + 自留备份兜底**（见 §9），**加浏览器 IndexedDB 本地永久缓存**（见 §7）。

---

## 2. 整体架构

```
作者侧 (publish.js)                              链上 (Ethereum L1)
─────────────────                              ──────────────────
草稿 = { title, tags[], markdown, files[] }     每张图 = 一笔纯 calldata 交易
  │                                              to=self, data=WebP字节  → txhash
  ▼
1. 每张图 → WebP q60 → calldata 自转账 → txhash
2. 把 upload:KEY 改写成 eth:0x<txhash>
3. payload = brotli( [可选 ---\ntags: a, b\n---] + markdown utf8 )
4. title32 = utf8(title) 右补零到 32 bytes
5. publish(title32, payload)                   Glyph 合约（共享，无所有者）:
      │                                          emit Post(msg.sender, index, prevBlock, title32)
      ▼                                          state[msg.sender] = {latestBlock=now, count+=1}
                                                 *payload bytes 留在 tx calldata 里，event 不带*
读取侧 (blogReader.js)
─────────────────────
A. 标题列表（无 body）
  1. eth_call latestBlock(author)    ← O(1) 拿头指针
  2. eth_getLogs(单个区块, author=…) ← 拿到标题 + index + prevBlock
  3. 顺着 prevBlock 回走，渲染标题列表（不解压 body）

B. 单篇打开
  4. eth_getTransactionByHash(log.txHash).input
  5. decodeFunctionData → 取 payload bytes
  6. brotli 解压 → { tags, markdown }
  7. 把 eth:0x<hash> 图片引用 → eth_getTransactionByHash(hash).input → Blob
  8. 渲染 Markdown 子集
```

**三类数据，三种存法：**

| 内容 | 编码 | 上链方式 | 在哪 |
|---|---|---|---|
| 标题 | UTF-8 → 右补零 32 字节 | publish() bytes32 参数 + event 非索引字段 | event log data |
| 正文 + 标签 | brotli q11 of Markdown(+front-matter) | publish() bytes 参数 | publish 交易 calldata |
| 图片 | WebP q60 | 独立的纯 calldata 自转账 | 交易历史，按 txhash 引用 |

> **为什么 body 不进 event？** `eth_getLogs` 一次会把 log.data 全部拉回客户端。要让"展示一页 20 个标题"查询便宜，body 必须不在 event 里——这是 v2 的关键架构变更。把 body 放在 publish 交易 calldata 里（合约不读），既省 ~+20% LOG 数据 gas，又让标题列表查询带宽固定。

**作者发现是带外的（out-of-band）。** 前端从 URL `?author=0x…` 取作者地址；合约不维护任何"作者目录"，保持极简。**无地址访问首页**时，前端退而用一次有界的最近区块扫描列出全网最新 N 篇（best-effort，见 §7），不改合约。

---

## 3. 成本

口径：纯 calldata 按 **EIP-7623 地板价** 计：`tokens = 零字节 + 4×非零字节`，地板成本 `= 10 gas/token`，即**非零字节 40 gas、零字节 10 gas**。压缩后的数据几乎全是非零字节。

**通用公式**
```
单笔纯 calldata 交易:   gas ≈ 21,000 + 40 × 字节数
一篇文章交易(v2):       gas ≈ 21,000
                            + 40 × (4 + 32 + payload字节)   ← 选择子 + title + payload
                            + 64 × 10                       ← ABI offset/length（多为零字节）
                            + ~1,893                        ← LOG：signature + author 两个 topic，96B 数据（EIP-2929）
                            + 200                           ← 温 SLOAD + 温 SSTORE（打包槽，EIP-2929）
                            + (首篇 +~24,000)               ← 冷 SLOAD + 冷槽初始化
```

**正文（一篇 ~1000 中文字，含 2 个标签）**
brotli 后约 1,400–1,600 字节，整篇 publish 交易约 **~85,000 gas**（相比 v1 在 event 里塞 body 省 ~15%）。
当前 ~0.23 gwei、ETH≈$1,690 下:**≈ $0.033/篇,1000 篇 ≈ $33**。

**图片（以本仓库样图为例,1310×772）**——实测各档:

| 版本 | 字节 | gas | ≈USD@0.23gwei |
|---|---|---|---|
| 原始 PNG | 135,979 | 5.42M | $2.11 |
| WebP q82 | 71,466 | 2.87M | $1.12 |
| **WebP q60（本方案）** | **43,264** | **1.75M** | **$0.68** |
| WebP q40 | 33,404 | 1.35M | $0.53 |
| 缩略图 q60 @400px | 9,270 | 0.39M | $0.15 |

**发布时机是最大的成本杠杆**（差 100 倍）。把图片排在 gas 低谷上链。

> 前端实时成本估算（`price.js`）：实时拉 `eth_gasPrice`（节点）+ CoinGecko 公共 API 的 ETH/USD（60s 缓存），按 brotli ≈ 0.45× 原始大小估 payload，给出 "≈$X.XX 正文 + $Y.YY/张图" 实时面板。CoinGecko 是唯一的链下 HTTP 依赖；被墙 / 限流 / 离线时降级为 `ethUsd=null`，只显示 ETH。

---

## 4. 智能合约 `Blog.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Blog {
    struct AuthorState {
        uint96 latestBlock; // 0 = author has never posted
        uint48 count;       // total posts by this author (== next post's index)
    }
    mapping(address => AuthorState) private _authors;

    event Post(
        address indexed author,
        uint256 index,
        uint256 prevBlock,
        bytes32 title
    );

    function latestBlock(address author) external view returns (uint256) {
        return _authors[author].latestBlock;
    }

    function count(address author) external view returns (uint256) {
        return _authors[author].count;
    }

    /// @notice Publish one article.
    ///         `payload` rides in the tx calldata only — the contract never
    ///         reads it. Off-chain schema: brotli(Markdown + optional YAML front-matter tags).
    function publish(bytes32 title, bytes calldata payload) external {
        payload; // silence "unused parameter" warning
        AuthorState memory s = _authors[msg.sender];
        emit Post(msg.sender, s.count, s.latestBlock, title);
        _authors[msg.sender] = AuthorState({
            latestBlock: uint96(block.number),
            count: s.count + 1
        });
    }
}
```

**关键点**

- **无所有者、无构造参数。** 任何地址都能 `publish()`，部署者无任何特权。
- **`payload` 不进合约逻辑，只待在 tx calldata。** 读取器用 `eth_getTransactionByHash(log.transactionHash).input` 拿回来再 `decodeFunctionData` 解出 `(bytes32, bytes)`。让 event 数据极小——标题列表查询永远只下载 ~96 字节/篇。
- **`author` indexed** 让读取器用 `eth_getLogs({ args: { author } })` 在单个区块里精确捞到该作者的日志。单篇 +375 gas。
- **打包槽**：`uint96 + uint48 = 144 bit < 256`，整个 `AuthorState` 占一个槽，每次 publish 一个温 SSTORE。首篇付一次冷槽费（~22k gas）。

---

## 5. Payload 编码 (`payload.js`)

payload 解压后就是一份**人类可读的 Markdown 文档**，标签放在可选的 **YAML 风格 front-matter** 里：

```
---
tags: 家庭, 旅行, 山
---

# 周末爬山
正文...
```

**没有标签时，payload 就是纯 Markdown**——不套任何外壳，最大化"任何编辑器、几十年后都能直接打开"。最终 publish 用的 payload = `brotli(q11)(utf8(text))`。

**为什么用 front-matter 而不是自定义二进制？**
- 它是 15 年来稳定的通用约定（Jekyll / Hugo / Obsidian / 各种静态站点生成器都认），不依赖本 app。
- 解压后人类直接可读，符合核心原则。
- front-matter 本身就是向前兼容机制：将来加新键，旧读取器忽略不认识的键即可——无需版本字节。
- tags 与正文同流 brotli，共享字典学习（`travel` 既在 tag 又在正文时压得更紧）。

解析很保守：仅当首行恰为 `---`、存在闭合 `---`、且中间每行都是 `key: value` 时才当作 front-matter；否则整体按纯 Markdown 处理（避免把正文开头的 `---` 分隔线误判）。

```js
import { getBrotli } from './brotli';
const enc = new TextEncoder(), dec = new TextDecoder();

export async function encodePayload({ tags = [], markdown }) {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  const text = clean.length
    ? `---\ntags: ${clean.join(', ')}\n---\n\n${markdown || ''}`
    : (markdown || '');
  return (await getBrotli()).compress(enc.encode(text), { quality: 11 });
}

export async function decodePayload(compressed) {
  const text = dec.decode((await getBrotli()).decompress(compressed));
  const { meta, body } = splitFrontMatter(text);   // tiny hand-rolled parser, no YAML lib
  const tags = meta.tags
    ? meta.tags.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return { tags, markdown: body };
}
```

**标题编码（`title.js`）**：UTF-8 字节右补零到 32。读取时左截零字节再 `TextDecoder` 解码。`titleByteLength()` 让 UI 显示"X / 32 字节"——ASCII 字符 1 字节、中文字符 3 字节、表情 4 字节，**编辑器须按字节限长，不是字符**。

---

## 6. 发布流水线 `publish.js`

浏览器模块。作者身份 = 当前连接钱包地址；合约不做任何身份校验。

```js
import { createWalletClient, custom, toHex } from "viem";
import { mainnet } from "viem/chains";
import { encodeTitle } from "./title";
import { encodePayload } from "./payload";

const GLYPH = "0xYourGlyphContractAddress";
const abi  = parseAbi(["function publish(bytes32 title, bytes payload) external"]);

const wallet = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) });
const [account] = await wallet.getAddresses();

// 1. Image: downscale to <=1600px long edge, encode WebP q60, return bytes.
async function processImage(file, { maxEdge = 1600, quality = 0.6, maxBytes = 200_000 } = {}) {
  /* ... 见仓库代码 ... */
}

// 2. Store image bytes as the calldata of a plain self-tx; return its 32-byte tx hash.
async function storeImage(bytes) {
  return wallet.sendTransaction({
    account, to: account, data: toHex(bytes), value: 0n,
  });
}

// 3. Replace `upload:KEY` refs with `eth:0x<txhash>` after uploading.
async function embedImages(markdown, files) { /* ... 用正则替换图片引用 ... */ }

// 4. Encode payload + title, publish().
export async function publishPost({ title, tags = [], markdown, files = {} }) {
  const finalMd = await embedImages(markdown, files);
  const payload = await encodePayload({ tags, markdown: finalMd });
  return wallet.writeContract({
    account, address: GLYPH, abi, functionName: "publish",
    args: [encodeTitle(title), toHex(payload)],
  });
}
```

---

## 7. 读取器 `blogReader.js`

每次读取都需要作者地址（前端从 URL 取：`/author/0x…` 作者列表，`/tx/0x…/<事件序号>` 单篇——一笔交易可能含多个 Post 事件）。**两段式加载**：标题列表无 body，点击打开时才拉 body。

**本地缓存**：所有正文和图片通过 IndexedDB 永久缓存（`glyph-cache`）。内容不可变（链上 calldata），所以缓存永不过期。命中缓存则零网络请求。

```js
import {
  createPublicClient, http, parseAbi, hexToBytes, decodeFunctionData,
} from "viem";
import { mainnet } from "viem/chains";
import { decodeTitle } from "./title";
import { decodePayload } from "./payload";

const abi = parseAbi([
  "function latestBlock(address author) view returns (uint256)",
  "function count(address author) view returns (uint256)",
  "function publish(bytes32 title, bytes payload) external",
  "event Post(address indexed author, uint256 index, uint256 prevBlock, bytes32 title)",
]);

const client = createPublicClient({ chain: mainnet, transport: http("https://YOUR_RPC") });
const POST_EVENT = abi.find((x) => x.type === "event" && x.name === "Post");

async function postsInBlock(author, block) {
  const logs = await client.getLogs({
    address: GLYPH, event: POST_EVENT, args: { author },
    fromBlock: block, toBlock: block,
  });
  logs.sort((a, b) => Number(b.args.index - a.args.index));
  return logs;
}

const toMeta = (log, block) => ({
  author: log.args.author, index: log.args.index, block,
  prevBlock: log.args.prevBlock, txHash: log.transactionHash,
  title: decodeTitle(log.args.title),
});

// A. Title list — no body bytes downloaded.
export async function loadTitleList(author, n) {
  let block = await client.readContract({
    address: GLYPH, abi, functionName: "latestBlock", args: [author],
  });
  const out = [];
  while (out.length < n && block > 0n) {
    const logs = await postsInBlock(author, block);
    if (logs.length === 0) break;
    for (const log of logs) { out.push(toMeta(log, block)); if (out.length >= n) break; }
    block = logs[logs.length - 1].args.prevBlock;
  }
  return out;
}

// B. Body — cache-first: IndexedDB → RPC; persists on first fetch.
export async function loadPostBody(txHash) {
  const cached = await getCachedBody(txHash);
  if (cached) return cached;
  const tx = await client.getTransaction({ hash: txHash });
  const decoded = decodeFunctionData({ abi, data: tx.input });
  const body = await decodePayload(hexToBytes(decoded.args[1]));
  setCachedBody(txHash, body).catch(() => {});
  return body;
}
```

**渲染一篇**：
```js
const titles = await loadTitleList(author, 20);
// user clicks titles[k]
const body = await loadPostBody(titles[k].txHash);
const md   = await resolveImages(body.markdown);  // eth:0x... -> blob:...
container.innerHTML = renderMarkdown(md);
// 显示 body.tags 作为标签
```

> 读 N 条标题是 N 次串行单区块查询，每次只下载几百字节 log。N=20 ~0.5–1s；缓存命中时正文即时显示。
> 点击某篇 → 一次 `getTransactionByHash` → 一次 brotli → 渲染。首访后所有内容缓存到 IndexedDB，后续访问零 RPC。

**首页（无地址）跨作者最新 N 篇** —— 全篇唯一一处刻意的范围扫描，**仅用于无地址发现**，单作者路径不受影响：

```js
// 没有全局头指针，所以跨作者发现必须扫描。有界、尽力而为：
// 从链头往回，每次扫 windowSize 个区块（迁就公共 RPC 的范围上限），
// 最多 maxWindows 个窗口，或集满 n 篇为止；空区段直接跳过。
export async function loadRecentAcrossAuthors(n, { windowSize = 800, maxWindows = 30 } = {}) {
  const head = await client.getBlockNumber();
  let toBlock = head;
  const out = [];
  for (let w = 0; w < maxWindows && out.length < n && toBlock > 0n; w++) {
    const fromBlock = toBlock >= BigInt(windowSize) ? toBlock - BigInt(windowSize) + 1n : 0n;
    const logs = await client.getLogs({ address: GLYPH, event: POST_EVENT, fromBlock, toBlock });
    logs.sort((a, b) => a.blockNumber !== b.blockNumber
      ? Number(b.blockNumber - a.blockNumber) : b.logIndex - a.logIndex); // 最新在前
    for (const log of logs) { out.push(toMeta(log, log.blockNumber)); if (out.length >= n) break; }
    if (fromBlock === 0n) break;
    toBlock = fromBlock - 1n;
  }
  return out.slice(0, n);
}
```

---

## 8. Markdown 子集与渲染

存的是 Markdown，但只用一个**小而安全的子集**——缩的是功能集，不是字符（不要 minify，brotli 已把空白压到几乎为零，minify 会毁掉"任何人都能直接读"这一核心价值）。

**支持**：标题 `# ## ###` · `**粗体**` `*斜体*` · 链接 `[文字](url)` · 图片 `![alt](eth:0x<txhash>)` · 列表 `-` 与 `1.` · 引用 `>` · 行内 / 围栏代码 · 段落（空行分隔）。

**砍掉**：裸 HTML（顺带消除 XSS）、表格、脚注、引用式链接、定义列表。

**渲染顺序**：`loadTitleList` → 用户点击 → `loadPostBody`（cache-first）→ `resolveImages`（eth: → blob）→ 受限解析器渲染 → 净化。

---

## 9. 永久性与自托管

- **calldata 在密码学意义上永久锚定以太坊**——它是规范链的一部分，可永远用区块哈希验证完整性。
- **正在演进的是"谁还存着可取回的副本"**：
  - **EIP-4444（历史过期）**：目前所有执行客户端已支持**部分历史过期**，可丢弃 Merge（2022-09）之前的区块数据；**完整的滚动历史过期仍在开发中**。
  - 滚动过期上线后，普通全节点可能丢弃约 1 年前的历史，届时取旧 calldata 要走**归档节点 / Portal Network / ERA 文件**。
  - 数据本身不会消失——由归档节点与去中心化数据提供方保存——只是不保证随便哪台节点都能秒取。
- **三层备份策略**：
  1. **IndexedDB 本地缓存**：所有已访问正文和图片永久缓存在浏览器中，零网络延迟。
  2. **自留备份**：你自己留一份原图与原稿。需要时对着链上 txhash/区块哈希一验即可。
  3. **链上锚定**：字节锚定以太坊 + 你手握可验证副本。
- **若要每台全节点都保留**：可用 **SSTORE2**（把字节当合约代码存进**状态**），代价约 5× calldata，且受合约 24KB 上限（EIP-170）。结论：**calldata + 本地缓存 + 自留备份**更务实。

---

## 10. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 存储介质 | Ethereum L1 calldata | 只信以太坊，零链下信任 |
| 合约形态 | **共享、无所有者、不可升级** | 一份合约支持任意多博主 |
| 作者身份 | `msg.sender` | 无需注册；钱包地址即身份 |
| 内容格式 | Markdown 子集 + 标签 + 标题 | app 无关、几十年后任意编辑器可读 |
| 标题 | `bytes32`（独立 calldata 参数） | UTF-8 右补零；UI 按字节限长；进 event 让"标题列表"查询零解压 |
| 标签 | 嵌入 Markdown front-matter（YAML 风格 `tags:`） | 通用约定、人类可读、与正文共享 brotli 字典；front-matter 自带向前兼容 |
| 正文压缩 | brotli q11，无字典 | 压缩流自描述，解码端零依赖 |
| 正文 / 标签 位置 | **publish 交易 calldata（不进 event）** | 让标题列表查询带宽固定；省 ~+20% LOG 字节成本 |
| Payload schema | 可选 YAML front-matter + Markdown 正文 | 无标签即纯 Markdown；任何编辑器几十年后可读 |
| 图片编码 | WebP q60 | 尺寸/画质平衡，~$0.68/张@当前 gas |
| 图片上链 | 每张独立 calldata 自转账，txhash 引用 | 正文交易精简；图片与作者解耦 |
| 取最新 | `latestBlock(author)` 头指针 (O(1)) | 不扫块；每位作者独立头指针 |
| 取前 N | 事件 `prevBlock` 反向链表 | 每步单区块查询，秒回 |
| `author` indexed | 是 | 多作者下读取按 author 过滤的必备 topic |
| 存储打包 | `(uint96 latestBlock, uint48 count)` 一槽 | 每篇 publish 仅 1 个 SSTORE |
| 作者发现 | 带外（前端 `?author=0x…`）；无地址时客户端有界扫描最近 K 区块 | 保持合约极简；首页发现不改链上结构（best-effort，非 O(1)） |
| 节点配置 | UI 设置弹窗，localStorage 覆盖 env 默认 | 用户随时切换公共 / 自建 RPC，无需重新部署 |
| ETH 价格源 | CoinGecko 公共 API（离线降级 ETH-only） | 简单自动；唯一链下 HTTP 依赖，失败不致命 |
| 编辑器 | CodeMirror 源码编辑 + 实时预览 | Markdown 语法高亮 + 边写边看；预览复用渲染器 |
| 永久性兜底 | 链上锚定 + IndexedDB 缓存 + 自留备份 | 三层冗余；应对未来滚动历史过期 |
| 本地缓存 | IndexedDB，永不过期 | 内容不可变；缓存命中零 RPC；万篇仅 ~20 MB |

---

## 11. 附录：常量、依赖、部署

**协议常量（截至 2026-06）**
- **EIP-7623（Pectra）** calldata 地板价：`tokens = 零字节 + 4×非零字节`，地板 `10 gas/token` → 非零 40、零 10。
- **EIP-7825（Fusaka, 2025-12）** 单笔交易 gas 上限：`2²⁴ = 16,777,216`。→ 一笔最多约 `(16,777,216 − 21,000) / 40 ≈ 418,905` 字节 ≈ **~409 KB** 图。
- **EIP-170** 合约代码上限 24,576 字节（仅在用 SSTORE2 时相关）。

**依赖**
```bash
npm i viem brotli-wasm
```

**部署（Foundry）**
```bash
forge create src/Blog.sol:Glyph \
  --rpc-url $ETH_RPC --private-key $PK \
  --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY
# 部署者无任何特权。同一份合约可由社区里任何钱包部署、被所有博主共用。
```

**前端配置**
```bash
# webapp/.env.local
VITE_GLYPH_ADDRESS=0x...          # 合约地址
VITE_RPC_URL=https://...          # RPC 默认（可在 UI 设置里覆盖）
VITE_CHAIN_ID=1                   # 1=mainnet, 11155111=sepolia
```

阅读时访问 `https://你的站点/?author=0x作者地址` 看某作者标题列表；**无作者参数 = 全网最新 N 篇（扫描最近区块）**。
写作时连接钱包；钱包地址即作者身份；标题最多 32 字节，标签随意。

**自托管备份清单**
1. 保留每篇文章的原始 Markdown（含 frontmatter）与每张原图。
2. 记录每张图的 `txhash`、每篇文章的发布交易哈希与区块号。
3. 长期可选：运行一个归档节点，或定期导出相关区块的 ERA 文件。
4. 任何时候都能对着链上哈希验证你手里的副本未被篡改。
5. **IndexedDB 缓存自动完成**：正文和图片在首次访问时自动存入浏览器数据库，后续访问零网络请求。

---

*本文件本身就是一份纯 Markdown——和它描述的系统一样，任何编辑器、几十年后都能打开。*
