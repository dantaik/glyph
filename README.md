# 雪泥 · Glyph

完全存在以太坊上的多作者写作系统（取自"雪泥鸿爪"）。**一份不可升级、无所有者的智能合约**，任意钱包都是它自己的作者（`msg.sender`）。文字、标题、标签、图片全部存于 L1 calldata，零链下依赖。

技术方案：[`glyph-spec.md`](./glyph-spec.md)

## 快速开始

合约已部署，地址（CREATE2，所有链相同）与各链的默认 RPC 节点都内置在前端里——
克隆即可运行，**无需任何配置**：

```bash
cd webapp && npm install && npm run dev
```

部署到 Vercel / Netlify 等静态托管同样零配置：`vercel.json` 已就绪，直接导入仓库即可。
`npm run build` 会产出两份东西：`dist/`（网站）和 `dist/glyph.html`（下面的离线副本，把整个应用装进一个文件）。

**可选——自己部署一份合约**（任何人都可以部署；部署者无任何特权）：

```bash
cd contracts && forge install foundry-rs/forge-std
forge script script/Create2Deploy.s.sol:Create2DeployGlyph \
  --rpc-url $ETH_RPC --broadcast   # PRIVATE_KEY 经环境变量传入（脚本用 vm.envUint 读取）

# 让前端指向自己那份。Vite 在构建时内联这些变量，改动后必须重新构建
cat > webapp/.env.local <<EOF
VITE_GLYPH_ADDRESS=0x你自己部署的地址
VITE_RPC_URL=https://eth.drpc.org
VITE_CHAIN_ID=1
EOF
```

**阅读**：访问 `/`（全网最新文章）、`/author/0x作者地址`（某作者的列表）、`/tx/0x交易哈希/0`（单篇文章，末尾是交易内的事件序号）、`/scan`（本机增量扫描已覆盖的多段区块范围，页脚可直达）。
**写作**：连接钱包 → 标题（最多 32 字节）+ 标签 + Markdown 正文（CodeMirror 编辑 / 全宽预览）→ 发布。正文引用另一篇文章用 `[文字](0x交易哈希/0)`（规范见 glyph-spec §8.1）。
**翻页**：首页与作者页底部的「加载更早的文章」按段向前扫描——已经扫过的区块范围直接命中本地缓存，不再重复请求。首页两段扫描范围之间若有未扫的区块，会在列表中间标出，可单独补扫。
**网络**：合约在以太坊主网与 Taiko 主网是同一个地址，右上角的链图标（以太坊 / Taiko 各自的标志）点开切换，不刷新页面。每条链的扫描范围、标题、正文与图片缓存各自独立；切换网络时，正在进行的扫描会在后台继续完成并缓存结果，切回来就直接可用。
**扫描**：首页流按区块范围倒序扫描，每扫完一段（一次 `eth_getLogs`）就立刻显示找到的文章，不必等整次扫描结束；离开首页（打开文章、作者页、设置）扫描也不会中断。每次扫描（打开首页、点一次「加载更早的文章」）最多向节点读取 `scanBlocks` 个区块（默认 270,000，见 `webapp/src/lib/chains.js`），已扫过的范围不计入；从合约部署区块（`deployBlock`）再往前一律不读。页面上的扫描进度、`/scan` 页和控制台都会写明这个上限。
**RPC 节点**：右上角 ⚙ 进入 `/settings`（手机上收在 ⋯ 菜单里），每条链可配置多个节点并排序——按顺序使用第一个，失败时自动回退到下一个（失败的节点会被短暂搁置，不会每次请求都重试）。保存立即生效，不刷新页面。
**扫描延迟与缓存**：同页 `/settings` 可设「区块链扫描延迟」——上一次扫描结束后的这段时间内重新打开首页或作者页，直接显示上次扫到的文章，不再向节点要新区块（默认 1 分钟，0 = 每次都扫）。这只决定什么时候去读新区块，不会漏文章。已经读到的内容是**永久缓存**的：链上数据不会改变，同一篇文章的元数据、标题、正文与图片都不会被重复请求。
**界面**：作者用地址生成的 blockies 图标 + 地址末 6 位表示（合约与交易哈希仍用 `0x1234…abcd`）。窄屏下主题与设置收进 ⋯ 菜单，其余控件留在同一行。
**控制台**：每次向节点请求、每次命中本地缓存都会在浏览器控制台留一行日志（标注链名）；`?log=0` 关闭。
**成本估算**：发布前实时显示 gas（节点）+ ETH/USD（CoinGecko）估算。
**离线副本**：页脚和 `/settings` 的「下载离线版」把整个应用存成一个 HTML 文件，见下节。

## 离线副本（单个 HTML 文件）

文章在链上，网站只是读它的一扇窗。窗子可以再开一扇：`npm run build` 除了 `dist/`
还会产出 `dist/glyph.html`——**一个自包含的 HTML 文件**，JS、CSS、brotli WASM 全部内联，
合约地址与默认节点也在里面。存到硬盘或 U 盘，双击用浏览器打开就能读，本仓库的域名是否还在都不影响。

线上站点从页脚的「离线版」和 `/settings` 的「下载离线版」提供它（约 4 MB）。

它与线上版的差别，都是浏览器给本地文件页面的限制决定的：

- **路由**：本地文件没有服务器做 `/tx/…` 的重写，`pushState` 在 file:// 的 opaque origin 上也会被拒，
  所以离线副本把同一套路由放进 fragment：`glyph.html#/tx/0x…/0`、`#/author/0x…`、`#/settings`。
- **阅读**：完全可用。文件直接向 RPC 节点发请求——公共节点对 `Origin: null` 都返回
  `Access-Control-Allow-Origin: *`（或 `null`），所以 file:// 页面能正常读链。节点可在设置页改。
- **发布**：浏览器默认不把钱包注入本地文件页面。需要在扩展管理页给钱包开
  「允许访问文件网址」（MetaMask：详细信息 → 允许访问文件网址），之后本地文件里也能连钱包发文。
- **缓存**：有的浏览器不允许本地文件页面用 IndexedDB。不允许时正文/图片缓存退回内存，只在本次会话内有效；
  节点列表与扫描记录（localStorage）不受影响。离线副本的设置页会写明当前实际情况。
- **字体**：离线副本不打包思源宋体（十几 MB 的 CJK 分片，本地也取不到），改用系统中文衬线字体
  （苹方 / 宋体 / 思源宋体，若已装）。

只想构建离线副本：`cd webapp && npm run build:offline`（产物在 `webapp/dist-offline/index.html`，
同时复制一份到 `webapp/dist/glyph.html`）。

## 确定性部署（CREATE2 · 全网同一地址）

Glyph 通过 canonical deterministic deployment proxy（Arachnid，
`0x4e59b44847b379578588920cA78FbF26c0B4956C`）以 CREATE2 部署。CREATE2 地址只由
`(deployer, salt, init-code hash)` 决定；代理本身可在任何 EVM 链上用一笔可重放交易
（one-time-account）部署到同一地址，因此 **Glyph 在所有 EVM 链上的地址相同**：

```
合约地址:       0x000000AE2f2249c497cfc5F262dd1491634C361C   （6 个前导零）
salt:           0x00436d208c20757dde791d2c0c0909a2c8ea61482d3fa516692d9ee5244440f1
部署器 (proxy): 0x4e59b44847b379578588920cA78FbF26c0B4956C
init code hash: 0x2d087c683d199f0d5d835f323462ddb3680ba048a4ef29f350dd784f3402b5cb
```

- **部署脚本**：`script/Create2Deploy.s.sol`，幂等（地址已有代码则校验后退出），任何人可跑，部署者无特权。
- **代理缺失的链**：先向一次性签名账户 `0x3fab184622dc19b6109349b94811493bf2a45362` 转入 ≥ 0.01 ETH（100,000 gas × 100 gwei），然后重放 Arachnid 仓库 `output/deployment.json` 中的原始签名交易（在任何链上重放都产生同一代理地址）：

  ```bash
  cast publish 0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222
  ```

- **字节码漂移**：`Blog.sol` 的任何改动都会改变 init code hash，进而改变地址。此时重新挖盐并更新 `Create2Deploy.s.sol` 里的三个常量：

  ```bash
  cast create2 --starts-with 000000 --init-code $(forge inspect src/Blog.sol:Glyph bytecode)
  ```

- **合约验证**：`forge verify-contract 0x000000AE2f2249c497cfc5F262dd1491634C361C src/Blog.sol:Glyph --chain <chainid> --etherscan-api-key $KEY`
- **普通部署**（地址随链而变）：`forge script script/Deploy.s.sol:DeployBlog --rpc-url $ETH_RPC --broadcast`

## 部署记录

合约地址（所有链相同）：`0x000000AE2f2249c497cfc5F262dd1491634C361C`

| 链 | Chain ID | 部署交易 | 部署者 | 日期 | 验证 |
|---|---|---|---|---|---|
| Ethereum mainnet | 1 | [0x5f16…ce9a](https://etherscan.io/tx/0x5f16b4d2375109968578502bdf899ded4cc7fc6c2608bbb738ffa7dbdc3bce9a) | `0x327f…c458` | 2026-09-02 | ✅ [Etherscan](https://etherscan.io/address/0x000000AE2f2249c497cfc5F262dd1491634C361C#code) |
| Taiko mainnet | 167000 | [0x6c66…dae7](https://taikoscan.io/tx/0x6c6645e2258432d01fae5e9e0f6b5c33bccade234a9628afced413e600e0dae7) | `0x327f…c458` | 2026-09-02 | ✅ [Taikoscan](https://taikoscan.io/address/0x000000AE2f2249c497cfc5F262dd1491634C361C#code) |

部署者地址 `0x327fa3369B1D1D42120d84bc407e5865ECa7c458` 对合约没有任何特权（合约无所有者、不可升级）。

## 许可

MIT
