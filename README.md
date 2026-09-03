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
**翻页**：首页与作者页底部的「加载更早的文章」按段向前扫描——已经扫过的区块范围直接命中本地缓存，不再重复请求。
**网络**：合约在以太坊主网与 Taiko 主网是同一个地址，右上角下拉菜单切换。
**RPC 节点**：右上角 ⚙ 进入 `/settings`，每条链可配置多个节点并排序——按顺序使用第一个，失败时自动回退到下一个（失败的节点会被短暂搁置，不会每次请求都重试）。
**控制台**：每次向节点请求、每次命中本地缓存都会在浏览器控制台留一行日志；`?log=0` 关闭。
**成本估算**：发布前实时显示 gas（节点）+ ETH/USD（CoinGecko）估算。

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
