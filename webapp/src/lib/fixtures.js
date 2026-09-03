// fixtures.js — an in-memory chain for DEV QA (`?fixtures=1` full data,
// `?fixtures=empty` empty states).
//
// Stands in for chainIO.js with the same surface — block heights and hashes
// in, post metadata and bodies out — so the REAL reader, scanner and scan
// store run on top of it: the demo exercises the same sweeps, the same
// coverage bookkeeping and the same window-by-window rendering as the
// chain does. Only ever loaded behind the literal `import.meta.env.DEV`
// guard in data.js, so production builds never bundle it. Browser-only
// fixture code: the JS clock and Math.random/setTimeout are fine here.
//
// The chain is HEAD blocks tall. `?window=700` shrinks the getLogs window
// so a sweep takes several round trips — the way to watch posts arrive one
// window at a time; `?fixtures=1&window=700&log=1` shows it in the console.

const DELAY_MIN_MS = 350;
const DELAY_SPAN_MS = 250;
/** The demo chain's head — a 3,000-block chain, ~12s a block. */
const HEAD = 3000n;
const SECONDS_PER_BLOCK = 12;

const AUTHORS = [
  '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
];

// data:image/svg+xml URIs must pass the marked sanitizer allowlist and the
// markdown `![](…)` parser: encode everything, with parens forced to %28/%29
// (encodeURIComponent leaves them alone) and `#` colors becoming %23.
const svgUri = (svg) =>
  'data:image/svg+xml,' +
  encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29');

// Monochrome ink-wash demo art — cool greys, no chroma (matches the
// black/white/grey + single-indigo theme; dev-only fixtures).
const IMG_DUSK = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500' viewBox='0 0 800 500'><rect width='800' height='500' fill='#e8eaee'/><circle cx='580' cy='168' r='64' fill='#b9bec6'/><path d='M0 332 Q190 232 390 322 T800 306 V500 H0 Z' fill='#9097a0'/><path d='M0 396 Q230 322 470 392 T800 382 V500 H0 Z' fill='#5c626b'/></svg>",
);

const IMG_TREE = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500' viewBox='0 0 800 500'><rect width='800' height='500' fill='#eceef2'/><rect y='362' width='800' height='138' fill='#aeb4bc'/><rect x='372' y='238' width='26' height='130' fill='#5c626b'/><circle cx='384' cy='196' r='88' fill='#888f99'/><circle cx='318' cy='242' r='56' fill='#aab0b8'/><circle cx='452' cy='236' r='60' fill='#747b85'/></svg>",
);

const LONG_ARTICLE = `小满：

冬至前两天，我上阁楼找腊味罐，却先翻出了外婆的香樟木箱。铜锁绿了，箱角磨得发亮，一掀盖子，三十年前的冬天就原封不动地涌出来——樟木香裹着旧棉絮的味道，底下还压着一点点墨香。我在阁楼里坐了一下午，就着天窗的光把箱子一层层看完，下来时膝盖都是麻的。晚饭都忘了烧，你娘上来喊我，结果也被那箱旧物拽住，陪我一直看到天黑。有些东西是不会过期的：气味不会，记忆不会，写下来的字也不会。所以趁炉火正旺，我把这只箱子写给你。

## 箱子里的三层冬天

### 第一层：信

最上面一层全是信，按年份用棉线扎成小捆。外婆识字不多，每封信都请村小的张老师代笔，可落款那两个字她坚持自己写，一笔一画，像刻进木头里。信纸薄得透光，铅笔字淡成了影子，可一行一行，仍旧站得笔直。

> 字是会走路的。人走不到的地方，字替你走到。
> ——外婆的原话，张老师替她记在信纸边上。

我点了点数目，一共七十四封：

- 写给当兵的舅公的，四十一封；
- 写给进城读书的奶奶的，二十六封；
- 写好却终究没寄出去的，七封。

### 第二层：账

中间一层是蓝布包着的几本账。我把最旧的一页抄成数据，想连同这封信一起存进链里，给它换一种活法：

\`\`\`js
// 外婆的账本 ledger — 1987 年腊月，单位：文
const ledger = [
  { item: '盐', wen: 12 },
  { item: '火柴', wen: 3 },
  { item: '给小满的糖', wen: 8 },
];
\`\`\`

抄完我先单独试发了一笔，交易哈希是 \`0x7f3c9a41d2b85e60c4f17a3902dd5b8e6a1f4c70b3925d18e64a07c5f2b9d301\`，谁都可以去查证。区块是个不认人情的账房先生，记下了就不许再改，这一点倒像极了外婆。整个过程其实只有三步：

1. 把信纸拍照，认成文字，逐句校对；
2. 用 brotli 压成小小的 payload；
3. 调用 publish，把它写进一个区块。

---

### 第三层：物

最底下压着一张全家福，和一幅外婆用铅笔描的老屋远山。原件太脆，不敢多碰，我照着样子描了两张小图，一并存在这封信里。

![暮色里的山坳](${IMG_DUSK})

第二张是院子里那棵香樟，就是木箱的来处。树冠描得圆圆的，像她蒸的年糕。

![院子里的香樟树](${IMG_TREE})

整箱物件的清单和照片底档，我归在了这里：https://example.org/jiashu/archives/2026/winter-solstice/camphor-wood-chest-inventory?author=0x8a1f3b52c9e44e1a9b1f0d2c7a44e0b1d2e3f4a5&seq=2&v=full

箱子重新上了锁，钥匙挂回门后老地方。樟木香沾在袖口上，洗了两回还在，我想外婆大概也是这样留在我们身上的。哪天你想她了，就回到这一篇来，字在，香也在。等你寒假回来，我们一起再开一次箱。

——爸爸，写于冬至前夜，炉火正旺`;

const BODY_A0_4 = `小满：

今晚北风把窗纸吹得呼呼作响，我把炉子捅旺了些，坐下来给你写今年冬天的第一封信。母亲腌的腊味挂满了北墙，黄昏的光斜斜一照，油亮亮的，像一排小灯笼。

白菜已经下窖，萝卜埋进了沙堆，屋檐下的柿子只剩最高处的几个，留给过路的鸟。你种的那盆水仙我搬进了堂屋，球茎鼓鼓的，赶得上过年开花。

> 冬至大如年，人间小团圆。

等你考完试回来，我们去东头塘上看人凿冰捞鱼。炉膛里煨着你最爱的红薯，灰一扒开就能吃。路上走慢一些，到家就有热汤。`;

const BODY_A0_3 = `院墙根的荠菜冒头了，我挖了小半篮，替你先吃了一顿饺子。外婆留下的那架蔷薇抽出新条，我搭了竹架，把它往墙头上引。

今年想把西边角再开一畦地，种些当季的菜：

- 一垄小葱，随吃随掐；
- 两行豆角，搭人字架；
- 靠墙一棵丝瓜，夏天好遮凉。

燕子回来了，还是去年梁上那一窝，进进出出衔着新泥。前年埋下的月季也活了，芽是紫红色的，看着就有股不服输的劲。它们都认得家，我想你也一样。等院子整个绿起来，我拍下来给你看。`;

const BODY_A0_1 = `这是我在链上写给你的第一封信。从前的信要走十几天山路，如今落在一个区块里，几秒钟就到，可我还是按老规矩，从天气说起。

今日小满，麦粒半饱，雨水把后山洗得发亮。你出生那天也是这个节气，所以有了你的名字——凡事将满未满，正是最有盼头的时候。

字放在这里，不怕潮，不怕蛀，也不怕搬家时弄丢。你娘在旁边笑话我，说我对着屏幕写信的认真样子，像极了当年你太爷爷研墨。爸爸的字不好看，但每一个都是真的。等你长大，自己来读。`;

const BODY_A0_0 = `随手试一笔。今天把家里的旧打字机擦了擦，又在链上开了这个新本子，先写几行字试试水，看看墨色深浅。

往后家里的大事小事，腌菜的方子，院子的收成，谁家添了娃，谁家娶了亲，都往这里记一笔。纸会黄，照片会褪色，硬盘会坏，刻在链上的字大概能多活几十年——比我乐观，也比我长久。

老话说，好记性不如烂笔头。烂笔头如今落进了区块，连橡皮都用不上了。打字机我也留着，新旧两样摆在一起，都是为了留住点什么。第一行字，就当给这个本子开光。`;

const BODY_A1_3 = `山里落了今年第一场雪，不大，半夜下的，清早起来瓦上薄薄一层，像撒了把盐。我踩着雪去后坡看了看蜂箱，都安静，蜂群抱成团过冬，比人会过日子。

火塘上炖着萝卜牛腩，柴火噼啪响。住进山里第三年，我越来越觉得日子不是过短了，而是过厚了——一天里能听见的声音，比城里一年都多。

屋后的竹子被雪压弯了腰，我拿竹竿轻轻一敲，雪扑簌簌落下来，它们又齐齐站直，跟没事人一样。

雪停了我就下山寄腊肉，顺路把这封信发出去。山高路远，字比人先到。`;

const BODY_A1_2 = `梦里又走了一遍那条小路：从村口的老槐树拐进去，过石板桥，第三户人家的烟囱永远先冒烟，那是我家。

桥头原来有棵歪脖子柳树，夏天我们排着队从树杈往河里跳，谁溅起的水花大谁赢。

路其实早就不在了。前年修水库，整个村子搬到了塬上，新房子整整齐齐，可巷子的拐角全是直角，再也藏不住捉迷藏的孩子。

我把这条路一寸一寸写下来，存在链上。地图上找不到的路，至少字里还能走一遍：青石板三十七块，第十二块是活动的，雨天会翘起来，溅人一裤腿泥。`;

const BODY_A1_1 = `夜里失眠，想起小时候坐过的夜航船。舱里一盏煤油灯，大人们压低声音说话，水声贴着船板，一推一推，把人推进睡意里。船过石桥洞，艄公会喊一嗓子，灯火一暗一明，像眨了下眼，醒来就到家了。

那时候慢，从外婆家回城要一整夜。现在高铁两个小时，反而再没有一段路，长得够人把一件心事从头想到尾。

> 船到桥头自然直，是因为水替你转了弯。

写下这几行的时候，窗外有货车碾过减速带，一声接一声，恍惚间，还以为是那年的水声。`;

const BODY_A1_0 = `巷口的桂花一夜全开了，香得霸道，整条巷子像泡在糖水里。早起买豆浆，摊主多舀了半勺糖，说桂花开的日子，人人都该甜一点；又说今年开得早，是个难得的暖秋。

母亲从前总在这几天收桂花：竹匾铺上白纸，等花自己落，不许摇树。她说摇下来的花带着青气，等来的花才是熟透的香。收好的桂花拌了糖封进罐里，冬天蒸年糕时挖一勺，满屋都是秋天。

今年我也照着她的法子封了一罐。罐子上贴了张纸条，端端正正写着：留给第一个回家的人。`;

const BODY_A2_2 = `渔港歇了冬，船都拖上岸，倒扣着像一排晒太阳的鲸。风大，码头上没什么人，只有补网的老人和不怕冷的鸥。老人说，冬天的海最诚实，潮涨潮落分毫不差，比城里的钟还准。

下午去看了灯塔。看塔的伯伯说，现在导航全靠卫星，灯塔早就不指路了，可灯每晚还是要亮。他说了一句我记到现在的话：灯不是为了有用才亮的。

回来的路上买了两条带鱼，霜一样亮，晚上炖了一锅，鲜得眉毛都要掉。海边的冬天冷得干净，风一过，人心里也跟着敞亮清爽起来。`;

const BODY_A2_1 = `十年后的你：

不知道那时候你住在哪里，做着什么，还熬不熬夜。写这封信的此刻，我刚搬进新城市的小公寓，行李还没拆完，窗外是一片陌生的天际线。搬家只带了三箱书和一把旧吉他，弦早该换了，一直没舍得。

有几件事替我问问：阳台上那盆橘子树活下来了吗？答应母亲的旅行兑现了吗？还在写字吗——不为发表，就为不忘。

这封信存在链上，十年后区块还在，字就还在。到时候别嫌我幼稚，毕竟你所有的底气，都是从这点幼稚里长出来的。`;

const BODY_A2_0 = `搬家前最后一次用老屋的灶台，蒸了一笼白馒头。柴火蒸的馒头有一股说不出的甜，电饭锅蒸不出来，大概是烟火气当了引子。蒸笼掀开那一刻，白汽糊了整面窗，父亲在雾里咳了一声，像三十年前一样。

灶台是父亲砌的，三十年了，灶膛被火舔得发黑发亮。墙上还留着我小时候用粉笔画的歪歪扭扭的太阳，母亲一直没舍得刷掉。

新家是干净的白厨房，按一下就有火。很好，只是再也没有炊烟了。原来一缕烟升起来，全村都知道：这一家，有人在好好过日子。`;

// One row per post, newest block first: [authorIdx, index, block, title, tags, markdown].
// QA hooks: AUTHORS[0] has contiguous indexes 0..4 (prev/next at i=2); index 2 is the
// long article; titles include a 27-byte CJK one, a trailing-U+FFFD one, an empty one.
const SEED = [
  [0, 4n, 2870n, '冬至前的一封信', ['家信'], BODY_A0_4],
  [1, 3n, 2660n, '山间来信', ['山居'], BODY_A1_3],
  [2, 2n, 2480n, '海边的冬天', ['海'], BODY_A2_2],
  [0, 3n, 2330n, '春天的院子', ['院子', '春天'], BODY_A0_3],
  [1, 2n, 2120n, '记忆里的那条回家的小�', ['旧事'], BODY_A1_2],
  [0, 2n, 1980n, '关于外婆的香樟木箱', ['家信', '冬天'], LONG_ARTICLE],
  [2, 1n, 1810n, '写给十年后的自己', ['自留'], BODY_A2_1],
  [1, 1n, 1640n, '夜航船', [], BODY_A1_1],
  [0, 1n, 1420n, '给小满的第一封信', ['家信'], BODY_A0_1],
  [2, 0n, 1260n, '灶台与炊烟', ['吃食'], BODY_A2_0],
  [1, 0n, 1100n, '桂花开的时候', ['秋天'], BODY_A1_0],
  [0, 0n, 900n, '', [], BODY_A0_0],
];

const delay = () =>
  new Promise((resolve) =>
    setTimeout(resolve, DELAY_MIN_MS + Math.random() * DELAY_SPAN_MS),
  );

const keyOf = (author) => String(author || '').toLowerCase();

const txOf = (author, index) =>
  `0x${((BigInt(author) << 64n) + 0xfab1e0n + index).toString(16).padStart(64, '0')}`;

function buildWorld() {
  const byAuthor = new Map(AUTHORS.map((a) => [keyOf(a), []]));
  const bodyByTx = new Map();
  for (const [ai, index, block, title, tags, markdown] of SEED) {
    const author = AUTHORS[ai];
    const txHash = txOf(author, index);
    byAuthor.get(keyOf(author)).push({
      author,
      index,
      block,
      prevBlock: 0n,
      title,
      txHash,
      eventIndex: 0,
      logIndex: 0,
    });
    bodyByTx.set(txHash, { tags, markdown });
  }
  for (const posts of byAuthor.values()) {
    posts.sort((a, b) => Number(a.index - b.index));
    posts.forEach((p, i) => {
      p.prevBlock = i === 0 ? 0n : posts[i - 1].block;
    });
  }
  const feed = [...byAuthor.values()].flat().sort((a, b) => Number(a.block - b.block));
  return { byAuthor, bodyByTx, feed };
}

/** Window size override from `?window=N`, else the chain's default. */
function windowOverride() {
  try {
    const n = Number(new URLSearchParams(window.location.search).get('window'));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the fixture chain I/O. `mode === 'empty'` → no posts anywhere
 * (empty-state QA). Same surface as createChainIO(); see chainIO.js.
 */
export function createFixtureIO(chainId, mode) {
  const { byAuthor, bodyByTx, feed } =
    mode === 'empty'
      ? { byAuthor: new Map(), bodyByTx: new Map(), feed: [] }
      : buildWorld();
  const postsOf = (author) => byAuthor.get(keyOf(author)) ?? [];
  const metaByTx = new Map();
  for (const posts of byAuthor.values()) {
    for (const p of posts) metaByTx.set(p.txHash.toLowerCase(), p);
  }
  const meta = (p) => ({ ...p });

  return {
    chainId: Number(chainId),
    /** Demo data never enters the real IndexedDB cache. */
    ephemeral: true,
    /** Genesis: nothing is deployed, the whole chain is worth reading. */
    floor: 0n,
    windowSize: windowOverride(),

    async blockNumber() {
      await delay();
      return HEAD;
    },

    async block(which) {
      await delay();
      const number = which === 'latest' ? HEAD : BigInt(which);
      const now = Math.floor(Date.now() / 1000);
      return { number, timestamp: now - Number(HEAD - number) * SECONDS_PER_BLOCK };
    },

    async postsInRange(from, to) {
      await delay();
      const lo = BigInt(from);
      const hi = BigInt(to);
      return { rows: feed.filter((p) => p.block >= lo && p.block <= hi).map(meta), to: hi };
    },

    async authorPostsInBlock(author, block) {
      await delay();
      const at = BigInt(block);
      return postsOf(author)
        .filter((p) => p.block === at)
        .map(meta);
    },

    async latestBlock(author) {
      await delay();
      const posts = postsOf(author);
      return posts.length ? posts[posts.length - 1].block : 0n;
    },

    async count(author) {
      await delay();
      return BigInt(postsOf(author).length);
    },

    async postsInTx(txHash) {
      await delay();
      const p = metaByTx.get(String(txHash).toLowerCase());
      return p ? [meta(p)] : []; // demo posts are one event per tx
    },

    async postBody(txHash) {
      await delay();
      const body = bodyByTx.get(txHash);
      if (!body) throw new Error('演示数据中找不到这笔交易');
      return { tags: [...body.tags], markdown: body.markdown };
    },

    async imageBytes() {
      throw new Error('演示数据没有链上图片'); // bodies use data: URIs instead
    },

    async ensName() {
      return null; // demo data has no ENS names
    },
  };
}
