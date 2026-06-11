# 岩刻 · Glyph

完全存在以太坊上的多作者岩刻系统。**一份不可升级、无所有者的智能合约**，任意钱包都是它自己的作者（`msg.sender`）。文字、标题、标签、图片全部存于 L1 calldata，零链下依赖。

技术方案：[`glyph-spec.md`](./glyph-spec.md)

## 快速开始

```bash
# 1. 部署合约（任何人都可以部署；部署者无任何特权）
cd contracts && forge install
forge script script/Deploy.s.sol:DeployBlog \
  --rpc-url $ETH_RPC --private-key $PRIVATE_KEY --broadcast

# 2. 配置前端
cat > webapp/.env.local <<EOF
VITE_GLYPH_ADDRESS=0x合约地址
VITE_RPC_URL=https://ethereum-rpc.publicnode.com
VITE_CHAIN_ID=1
EOF

# 3. 运行
cd webapp && npm install && npm run dev
```

**阅读**：访问 `/?author=0x作者地址` 看标题列表，点标题打开正文。无作者参数 = 全网最新岩刻（扫描最近区块）。
**写作**：连接钱包 → 标题（最多 32 字节）+ 标签 + Markdown 正文（CodeMirror + 实时预览）→ 发布。
**RPC 节点**：右上角 ⚙ 弹出设置，可覆盖默认 RPC，localStorage 持久。
**成本估算**：发布前实时显示 gas（节点）+ ETH/USD（CoinGecko）估算。

## 许可

MIT
