// fixtureWorld.js — the demo chains, as plain data.
//
// Two worlds that are genuinely different, the way Ethereum and Taiko are:
// a slow chain with a short history and a fast one with a long history,
// posts spread over the same afternoon so that merging them by time is a
// real merge, and post sets that overlap in author but not in content.
// Tx hashes mix in the chain id, so nothing is accidentally shared.
//
// No Vite, no browser APIs: fixtures.js wraps this into the reader's I/O
// surface for the DEV demo, the unit tests build merged feeds over it, and
// expectedMergedOrder() is the oracle those tests check against.

export const AUTHORS = [
  '0x8a1f3b52C9e44E1a9b1f0d2C7a44E0b1D2e3F4a5',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // writes on Taiko only
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

// Two of the demo posts are written in Chinese on purpose, and stay that
// way while the rest of the world reads in English. They are the app's
// multi-byte-title fixtures — one title is exactly 27 bytes of UTF-8, the
// other is a bytes32 title cut mid-character and ending in U+FFFD — and
// neither case can be reproduced with ASCII. They also give the bilingual
// reader something real to look at: a Chinese post in an English interface.
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

const BODY_A0_4 = `Xiaoman,

The north wind is rattling the window paper tonight, so I have stoked the stove and sat down to write you the first letter of this winter. Your mother's cured meat hangs the whole length of the north wall, and when the late light slants across it the pieces shine like a row of small lanterns.

The cabbages are down in the cellar, the radishes buried in sand, and only the highest persimmons are left under the eaves, saved for whatever birds come through. I carried your narcissus into the front room; the bulb is plump enough that it should open in time for New Year.

Come home when the exams are over and we will go to the pond at the east end to watch them cut the ice for fish. There is a sweet potato banked in the ashes with your name on it. Walk slowly on the way; there will be hot soup when you arrive.`;

const BODY_A0_3 = `The shepherd's purse has come up along the foot of the wall. I dug half a basket and ate a plate of dumplings on your behalf. Your grandmother's rose has thrown out new canes, so I built it a bamboo frame and led it up towards the top of the wall.

I want to open one more bed in the western corner this year, and plant what the season asks for:

- a row of spring onions, picked as we need them;
- two rows of beans on an A-frame;
- one loofah against the wall, for shade in summer.

The swallows are back — the same nest on the same beam as last year, in and out all day with fresh mud. The roses I buried the year before last took as well; the shoots come up purple-red, with a stubborn look to them. They all know their way home. I expect you do too. When the yard has gone properly green I will photograph it for you.`;

const BODY_A0_1 = `This is the first letter I have written you on-chain. A letter used to take a fortnight over the mountain roads; this one lands in a single block and arrives in seconds. Still, I will keep to the old form and begin with the weather.

Today is Xiaoman, the grain half full, and the rain has washed the back hill until it shines. You were born in this same season, which is where your name came from — everything not quite full yet, which is when there is most to look forward to.

Words left here will not damp, will not be eaten by insects, will not be lost in a move. Your mother is laughing at me from the next chair; she says I write at a screen with the same solemn face your great-grandfather wore grinding ink. My handwriting was never good, but every character of it is true. Read them yourself when you are grown.`;

const BODY_A0_0 = `Just trying the pen. I wiped down the old typewriter today, then opened this new notebook on-chain and wrote a few lines to see how the ink runs.

From now on the household's business — large and small, the pickling recipes, what the yard yielded, whose family gained a child, whose married — all of it gets a line here. Paper yellows, photographs fade, hard drives fail; words cut into a chain will probably outlast several decades of that. More optimistic than me, and longer-lived.

The old saying goes that the palest ink beats the best memory. The pale ink has landed in a block now, where not even an eraser reaches. I am keeping the typewriter as well, the old and the new side by side, both of them for holding on to something. Call this first line the notebook's christening.`;

// Refers to AUTHORS[0]'s second post (index 2) on the same chain; the hash
// is filled in per world, since it carries the chain id.
const BODY_A1_3 = (ref) => `The first snow of the year fell in the hills — not much, and in the middle of the night. By morning there was a thin layer on the tiles, as if someone had scattered salt. I walked up the back slope through it to look at the hives; all quiet, the bees balled up for the winter, better at housekeeping than most people.

Radish and beef brisket are on the fire pit, the wood snapping. Three years of living up here and I am more and more sure the days have not got shorter, only thicker — there are more sounds in one of them than a whole year down in the city held.

The bamboo behind the house was bent double under the snow. I tapped a pole against it, the snow came down in a rush, and they all stood straight again as if nothing had happened.

Once it stops I will walk down to post the cured pork, and send this letter on the way. The hills are high and the road is long; the words get there before I do.

Yesterday I reread [关于外婆的香樟木箱](${ref}) from home. Old letters read on a snowy day are unusually warm.`;

const BODY_A1_2 = `梦里又走了一遍那条小路：从村口的老槐树拐进去，过石板桥，第三户人家的烟囱永远先冒烟，那是我家。

桥头原来有棵歪脖子柳树，夏天我们排着队从树杈往河里跳，谁溅起的水花大谁赢。

路其实早就不在了。前年修水库，整个村子搬到了塬上，新房子整整齐齐，可巷子的拐角全是直角，再也藏不住捉迷藏的孩子。

我把这条路一寸一寸写下来，存在链上。地图上找不到的路，至少字里还能走一遍：青石板三十七块，第十二块是活动的，雨天会翘起来，溅人一裤腿泥。`;

const BODY_A1_1 = `Awake in the night, thinking of the night boats I rode as a child. One kerosene lamp in the cabin, the adults keeping their voices down, the water pushing against the planks, push after push, until it had pushed you into sleep. Going under a stone bridge the boatman would call out once, the lamplight would dim and lift like a blink, and when you woke you were home.

Things were slow then; from my grandmother's back to town took the whole night. Two hours on the fast train now, and there is no journey left long enough to think one worry through from beginning to end.

As I write this a lorry is going over the speed bumps outside, one bump after another, and for a moment I mistake it for that water.`;

const BODY_A1_0 = `The osmanthus at the mouth of the lane opened all at once overnight — overbearingly sweet, the whole lane steeping in sugar water. Buying soy milk this morning, the stall-holder gave me an extra half spoon of sugar; he said everyone should be a little sweeter on the day the osmanthus opens, and that it came early this year, which makes for a rare warm autumn.

My mother used to gather the flowers in these few days: white paper spread over a bamboo tray, and you waited for them to fall — no shaking the tree. She said flowers shaken down carry a green edge, and only the ones you wait for are ripe all the way through. What she gathered went into a jar with sugar, and in winter a spoonful into the steaming rice cake filled the house with autumn.

I have sealed a jar her way this year. There is a paper label on it, written out squarely: for whoever gets home first.`;

const BODY_A2_2 = `The fishing harbour is laid up for the winter, the boats hauled out and turned over like a row of whales in the sun. It blows hard, and there is nobody on the quay but an old man mending nets and the gulls that don't mind the cold. He told me the winter sea is the honest one: the tides come and go to the minute, better than any clock in town.

I walked out to the lighthouse in the afternoon. The keeper said navigation is all satellites now and the light hasn't guided anyone in years — but it still has to be lit every night. Then he said something I have not stopped turning over: a light isn't lit because it's useful.

On the way back I bought two hairtail, bright as frost, and stewed them for supper — so good it hurt. Winter on the coast is a clean sort of cold; one gust and something inside you opens up as well.`;

const BODY_A2_1 = `To you, ten years from now:

I have no idea where you are living by then, what you do, whether you still keep bad hours. As I write this I have just moved into a small flat in a new city, the boxes still half unpacked, an unfamiliar skyline out the window. I brought three cartons of books and one old guitar; the strings needed changing years ago and I have never had the heart.

A few things to check on my behalf. Did the orange tree on the balcony make it? Did that trip you promised your mother ever happen? Are you still writing — not to publish, only so as not to forget?

This letter lives on-chain. In ten years the block will still be there, so the words will be too. Don't be embarrassed by how young I sound: everything you stand on now grew out of exactly this much naivety.`;

const BODY_A2_0 = `The last thing I did with the old kitchen range before the move was steam a basket of white buns. Buns done over a wood fire have a sweetness you cannot name and a rice cooker cannot reproduce — the smoke must work as the starter. The moment the basket came off, steam fogged the whole window, and my father coughed somewhere inside it, exactly as he did thirty years ago.

He built that range himself, thirty years back, and the firebox has been licked black and glossy ever since. On the wall there is still the crooked sun I drew in chalk as a child; my mother never could bring herself to paint over it.

The new place has a clean white kitchen, and a flame at the push of a button. Which is good. It is only that there is no chimney smoke any more. A thread of it going up used to tell the whole village: in this house, someone is living properly.`;

// --- The Taiko world's letters: same people, a different afternoon. ------

const BODY_T0_2 = `Xiaoman,

This chain is quick — a block every two seconds. I had barely pressed return and the words had already settled. Your mother says that is faster than you answer a message.

The drum tower on the back hill was being repaired today, and they beat the drum all afternoon. The sound came down on the wind into the yard, like someone in the distance counting off the days one at a time. I sat under the eaves and listened for a long while, thinking of you as a small child lying flat on the drumhead, giggling at the shake of it.

Words set down here last as long as words set down on that slower chain. I write on both. Read whichever reaches you first.`;

const BODY_T0_1 = `A short one, on the spur of the moment: the frost has been on the persimmons, and even the highest few came down with the wind before the birds got to them.

Market day tomorrow. I will bring you back a bag of walnuts.`;

const BODY_T0_0 = `Trying the pen on this new chain. The fee is so small you can hardly see it, but I will keep the old form and open with the old line: these words stand in for a face.

If this one lands cleanly, the short notes go here from now on and the long letters stay on the slow chain — nothing written twice.`;

const BODY_T1_1 = `Woken at midnight by rain, so I got up and boiled water for tea. Rain on the tiles up here comes in layers, one after another, like somebody upstairs turning pages.

I thought of the ferry crossing I passed in the daytime. The old man who works it says the water is high this year and the boat has to come in early. The words go first and I follow; I will walk down once the rain stops.`;

const BODY_T1_0 = `On moving day the last thing loaded was the old clay pot. There is a crack in its base that has never leaked in a dozen years — my mother says it knows who it belongs to.

The new place has an electric hob, which a clay pot cannot sit on, so it stands on the windowsill as a planter. This morning I found some nameless grass had come up inside it on its own.`;

const BODY_T3_2 = `In the morning fog the crossing is one bamboo pole's worth of shadow: the boat in the fog, the passenger on the bank, neither able to see the other. The old man called once through it, I called back, and the boat came towards the sound.

Only when the fog lifted did I see how narrow the river really is, and how much longer the walk here had been than it needed to be.`;

const BODY_T3_1 = `Dusk is the crossing's busiest hour: people off work, people back from market, children out of school — more than one boat holds, so the old man makes an extra run.

I waited on the bank through two of them, watching the sun turn the water the colour of copper, watching every single person look back the way they had come before stepping aboard. Forty years he has worked this river, he says. Fewer and fewer look back. But there are always some.`;

const BODY_T3_0 = `First day at the crossing. The house is rented, right on the water; at night you can hear the oars.

My luggage is one box of books and one pen. I came here to write this river down. No idea how long that will take, so I will start with today's level: up one finger.`;

/**
 * Per-chain seeds: [authorIdx, index, block, title, tags, body] with the
 * chain's pace, head and per-sweep budget.
 *
 * Ethereum: 3,000 blocks at 12 s, posts over the last ~7 h — a whole
 * refresh sweeps it to the floor. Taiko: 30,000 blocks at 2 s, posts over
 * the last ~16 h, and a 12,000-block budget (~6.7 h) per sweep, so the
 * first refresh leaves its older posts unscanned: the merged feed's time
 * frontier shows up in the demo, and loading earlier posts moves it.
 *
 * QA hooks kept from the single-chain demo: AUTHORS[0] has contiguous
 * Ethereum indexes 0..4 (prev/next at i=2); index 2 is the long article;
 * titles include a 27-byte CJK one, a trailing-U+FFFD one, an empty one.
 */
export const WORLDS = {
  1: {
    head: 3000n,
    secondsPerBlock: 12,
    floor: 0n,
    scanBlocks: undefined, // the chain's default (270,000) — sweeps to the floor
    seeds: (txOf) => [
      [0, 4n, 2870n, 'A letter before the solstice', ['letters home'], BODY_A0_4],
      [1, 3n, 2660n, 'A letter from the hills', ['living up here'], BODY_A1_3(txOf(AUTHORS[0], 2n)),
        { re: txOf(AUTHORS[0], 2n) }],
      [2, 2n, 2480n, 'Winter by the sea', ['sea'], BODY_A2_2,
        { series: 'Kitchen notes', part: '3', prev: txOf(AUTHORS[2], 1n) }],
      [0, 3n, 2330n, 'The yard in spring', ['the yard', 'spring'], BODY_A0_3],
      [1, 2n, 2120n, '记忆里的那条回家的小�', ['旧事'], BODY_A1_2, { lang: 'zh' }],
      [0, 2n, 1980n, '关于外婆的香樟木箱', ['家信', '冬天'], LONG_ARTICLE, { lang: 'zh' }],
      [2, 1n, 1810n, 'To myself, ten years on', ['for me'], BODY_A2_1,
        { series: 'Kitchen notes', part: '2', prev: txOf(AUTHORS[2], 0n) }],
      [1, 1n, 1640n, 'The night boat', [], BODY_A1_1],
      [0, 1n, 1420n, 'The first letter to Xiaoman', ['letters home'], BODY_A0_1],
      [2, 0n, 1260n, 'The stove and the smoke', ['food'], BODY_A2_0,
        { series: 'Kitchen notes', part: '1' }],
      [1, 0n, 1100n, 'When the osmanthus opens', ['autumn'], BODY_A1_0],
      [0, 0n, 900n, '', [], BODY_A0_0],
    ],
  },
  167000: {
    head: 30_000n,
    secondsPerBlock: 2,
    floor: 0n,
    scanBlocks: 12_000n,
    seeds: (txOf) => [
      [0, 2n, 28_900n, 'The drums', ['letters home'], BODY_T0_2,
        { supersedes: txOf(AUTHORS[0], 1n) }],
      [3, 2n, 27_400n, 'Morning fog at the crossing', ['the crossing'], BODY_T3_2],
      [1, 1n, 24_800n, 'Rain at midnight', [], BODY_T1_1],
      [0, 1n, 21_600n, 'A short note to Xiaoman', ['letters home'], BODY_T0_1],
      [3, 1n, 16_500n, 'Dusk at the crossing', ['the crossing'], BODY_T3_1],
      [1, 0n, 12_300n, 'The day we moved', ['the old days'], BODY_T1_0],
      [3, 0n, 6_200n, 'First day at the crossing', ['the crossing'], BODY_T3_0],
      [0, 0n, 2_100n, 'Trying Taiko', [], BODY_T0_0],
    ],
  },
};

export const WORLD_CHAIN_IDS = Object.keys(WORLDS).map(Number);

const keyOf = (author) => String(author || '').toLowerCase();

/**
 * A publish transaction hash that is unique per (chain, author, index) — the
 * chain id sits in the top bits so the same author's same index on two
 * chains never collides.
 */
export const txOf = (chainId, author, index) =>
  `0x${((BigInt(chainId) << 224n) + (BigInt(author) << 64n) + 0xfab1e0n + BigInt(index))
    .toString(16)
    .padStart(64, '0')}`;

/**
 * Build one chain's world.
 *
 * `now` (seconds) is the head block's time; every block is `secondsPerBlock`
 * earlier. `scale` multiplies block heights and divides the pace, so the
 * same afternoon spans `scale`× more blocks — the way to put a chain's
 * posts beyond a production-sized sweep budget in a test.
 */
export function buildWorld(chainId, { now = Math.floor(Date.now() / 1000), scale = 1 } = {}) {
  const id = Number(chainId);
  const spec = WORLDS[id];
  if (!spec) throw new Error(`no fixture world for chain ${id}`);
  const scaleN = BigInt(scale);
  const head = spec.head * scaleN;
  const secondsPerBlock = spec.secondsPerBlock / scale;
  const floor = spec.floor * scaleN;
  const scanBlocks = spec.scanBlocks == null ? undefined : spec.scanBlocks * scaleN;
  const tx = (author, index) => txOf(id, author, index);
  const tsOf = (block) => Math.floor(now - Number(head - BigInt(block)) * secondsPerBlock);

  const byAuthor = new Map(AUTHORS.map((a) => [keyOf(a), []]));
  const bodyByTx = new Map();
  // A seed is [author, index, block, title, tags, markdown, meta?] — the
  // last being the rest of the front-matter: a language, a relation to
  // another post, a place in a series.
  for (const [ai, index, block, title, tags, markdown, meta = {}] of spec.seeds(tx)) {
    const author = AUTHORS[ai];
    const txHash = tx(author, index);
    byAuthor.get(keyOf(author)).push({
      author,
      index,
      block: block * scaleN,
      prevBlock: 0n,
      title,
      txHash,
      eventIndex: 0,
      logIndex: 0,
      ts: tsOf(block * scaleN),
    });
    bodyByTx.set(txHash, { tags, markdown, meta });
  }
  for (const list of byAuthor.values()) {
    list.sort((a, b) => Number(a.index - b.index));
    list.forEach((p, i) => {
      p.prevBlock = i === 0 ? 0n : list[i - 1].block;
    });
  }
  const posts = [...byAuthor.values()].flat().sort((a, b) => Number(a.block - b.block));
  const metaByTx = new Map(posts.map((p) => [p.txHash.toLowerCase(), p]));

  return { chainId: id, head, secondsPerBlock, floor, scanBlocks, posts, byAuthor, bodyByTx, metaByTx, tsOf, txOf: tx };
}

/** Every world at once, sharing one `now`. */
export function buildWorlds(chainIds = WORLD_CHAIN_IDS, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return new Map(chainIds.map((id) => [Number(id), buildWorld(id, { ...opts, now })]));
}

/**
 * The order a merged, time-sorted feed over these worlds must show —
 * newest first; ties broken by chain id, then block, then log index, the
 * same rule the app uses. Independent of the app's own code on purpose:
 * this is what the merge is checked against.
 */
export function expectedMergedOrder(worlds, { limit = Infinity } = {}) {
  const all = [];
  for (const world of worlds.values()) {
    for (const p of world.posts) {
      all.push({ chainId: world.chainId, txHash: p.txHash, title: p.title, ts: p.ts, block: p.block, logIndex: p.logIndex, author: p.author, index: p.index });
    }
  }
  all.sort((a, b) => {
    if (a.ts !== b.ts) return b.ts - a.ts;
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    if (a.block !== b.block) return b.block > a.block ? 1 : -1;
    return b.logIndex - a.logIndex;
  });
  return all.slice(0, limit);
}
