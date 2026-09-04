// en.js — the interface in English (the default).
//
// Keys are grouped by the surface they belong to. An entry is a string, or
// a function of the parts interpolated into it — never a template built by
// concatenation at the call site, so a translation can put the parts in a
// different order. zh.js carries exactly these keys.

export default {
  // --- The masthead and the shell -----------------------------------------
  'brand.wordmark': 'Xueni',
  'brand.title': 'Xueni',
  'nav.read': 'Read',
  'nav.write': 'Write',
  'nav.home': 'Back to the front page',
  'nav.toggleTheme': 'Toggle dark mode',
  'nav.settings': 'Settings',
  'nav.more': 'More',
  'nav.lightMode': 'Light mode',
  'nav.darkMode': 'Dark mode',
  'nav.switchLanguage': ({ name }) => `Switch to ${name}`,
  'app.fixtures': 'Demo data',

  // --- The footer ----------------------------------------------------------
  'footer.onlyChain': ({ chain }) => `${chain} only`,
  'footer.scanRanges': 'View the scanned ranges',
  'footer.scanned': 'Blocks scanned',
  'footer.scanning': 'scanning',
  'footer.segments': ({ count }) => `${count} ranges`,

  // --- Shared vocabulary ---------------------------------------------------
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.apply': 'Apply',
  'common.add': 'Add',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.untitled': 'Untitled',
  'common.technicalDetails': 'Technical details',
  'common.loadFailed': 'Could not load',
  'common.backToFeed': 'Back to the feed',
  /** `label: value` — the separator differs between languages. */
  'common.labelled': ({ label, value }) => `${label}: ${value}`,
  /** How a list of chain names is joined: "Ethereum and Taiko". */
  'common.joinAnd': ' and ',
  'common.period': '.',

  // --- The home feed -------------------------------------------------------
  'feed.title': 'Latest posts',
  'feed.subtitleAll': ({ count }) => `All authors · ${count} networks`,
  'feed.viewAll': 'View all',
  'feed.emptyEver': 'Nothing has been published yet',
  'feed.writeFirst': 'Write the first one',
  'feed.emptyRange': 'No posts in the blocks scanned so far',
  'feed.scanEarlier': 'Keep scanning earlier blocks',
  'feed.note': ({ chain, blocks }) =>
    `Read ${blocks} blocks on ${chain} without finding an earlier post — you can keep loading.`,
  'feed.jobMore': 'Scanning for earlier posts…',
  'feed.jobGap': 'Filling in the blocks in between…',
  'feed.jobRefresh': 'Scanning the most recent blocks…',
  'feed.readFailed': ({ chain, reason }) => `${chain} could not be read: ${reason}`,
  'feed.gapFilling': ({ chain, blocks }) => `${chain}: filling in ${blocks} blocks in between`,
  'feed.gapProgress': ({ read, budget }) => `: ${read} read of at most ${budget}`,
  'feed.gapPending': ({ chain, blocks }) => `${chain}: ${blocks} blocks in between are still unscanned`,
  'feed.scanThisRange': 'Scan this range',

  // --- Paging a list -------------------------------------------------------
  'loadMore.label': 'Load earlier posts',
  'loadMore.loading': 'Loading…',
  'loadMore.noMore': 'No more posts',

  // --- Where a merged list stops being complete ----------------------------
  'frontier.readFailed': ({ names, reason }) => `${names} could not be read: ${reason}`,
  'frontier.authorScanning': ({ names }) =>
    `Still reading posts on ${names} — the rows below do not include them yet`,
  'frontier.feedScanning': ({ names }) =>
    `${names} is running its first scan — the rows below do not include it yet`,
  'frontier.authorIncomplete': ({ names }) => `Earlier posts on ${names} have not been read yet`,
  'frontier.feedIncomplete': ({ names, when }) =>
    `The posts below may be incomplete: ${names} has only been scanned back to ${when}`,
  'frontier.here': 'here',
  'frontier.continueReading': 'Keep reading',
  'frontier.continueScanning': 'Keep scanning',
  /** How the chains at the frontier are joined: "Ethereum and Taiko". */
  'frontier.join': ' and ',

  // --- Live scan status ----------------------------------------------------
  'scanProgress.default': 'Scanning…',
  'scanProgress.block': ({ block }) => `Block ${block}`,
  'scanProgress.blockRange': ({ from, to }) => `Blocks ${from} to ${to}`,
  'scanProgress.found': ({ posts, target }) => ` · ${posts}/${target} posts found`,
  'scanProgress.read': ({ fetched, budget }) => ` · ${fetched} of at most ${budget} blocks read`,
  'scanProgress.percent': ({ percent }) => ` · about ${percent}%`,

  // --- The author page -----------------------------------------------------
  'author.postsByPrefix': 'Posts by ',
  'author.postsBySuffix': '',
  'author.total': ({ count }) => `${count} posts`,
  'author.empty': 'This address has never published',
  'author.jobMore': 'Scanning for earlier posts…',
  'author.jobRefresh': 'Reading the list of posts…',

  // --- A single post -------------------------------------------------------
  'post.by': 'By',
  'post.loadFailed': ({ reason }) => `Could not load: ${reason}`,
  'post.block': ({ block }) => `Block ${block}`,
  'post.transaction': 'Transaction',
  'post.fromCache': 'From the local cache',
  'post.notFound': 'No such post',
  'post.notFoundBody': 'That transaction holds no publish record, or the hash is wrong.',
  'post.notFoundOnChains': ({ names }) =>
    `No publish record for that transaction on ${names}, or the hash is wrong.`,
  'post.locating': 'Looking up this transaction…',
  'post.prev': 'Previous',
  'post.next': 'Next',
  'post.navLabel': 'Previous and next posts',
  /** A post's ordinal in its author's chain-local list. */
  'post.index': ({ index }) => `#${index}`,
  'post.titleSuffix': ({ title }) => `${title} · Xueni`,


  // --- The scan page (/scan) ----------------------------------------------
  'scan.title': 'Scanned ranges',
  'scan.subtitle': 'The block coverage cached on this machine',
  'scan.intro':
    'To read posts incrementally over public RPC, the browser records which block ranges it has already scanned; a reload only fetches the blocks that appeared since, never the same ones twice. It records a set of ranges rather than one span: having scanned 1–100 and later 200–300, paging further back only fills in 101–199. Each chain records its own, independently; both chains scan at once, and a scan already running finishes in the background and caches its result even after you leave the page. The global feed caches at most 300 posts and each author at most their 200 most recent titles; when the cache is trimmed the matching ranges are given back too, so a post is never missed because a range was assumed scanned.',
  'scan.outro':
    'The record is kept in this browser (localStorage), separately per chain, and only serves to avoid repeating on-chain requests; clearing browser data starts the scan again from scratch. A post is requested from the node at most once per session, and bodies and images are cached in the browser IndexedDB (also per chain).',
  'scan.backgroundScanning': 'Scanning in the background',
  'scan.budget': ({ blocks }) =>
    `Each scan (opening the feed, one click of “Load earlier posts”) reads at most ${blocks} blocks from the node`,
  'scan.floor': ({ block }) => `; the contract was deployed in block ${block}, and nothing earlier is read`,
  'scan.globalHeading': 'Global scan (the home feed)',
  'scan.authorHeading': 'Author scans',
  'scan.range': ({ from, to }) => `Blocks ${from} to ${to}`,
  'scan.rangeBlocks': ({ blocks }) => ` · ${blocks} blocks`,
  'scan.moreRanges': ({ count }) => `…and ${count} earlier ranges`,
  'scan.summary': ({ segments, blocks, cached }) =>
    `${segments} ranges · ${blocks} blocks · ${cached} posts cached`,
  'scan.syncedTo': ({ block }) => ` · synced to block ${block}`,
  'scan.scanningNow': ({ from, to, fetched, budget }) =>
    `scanning blocks ${from} to ${to}, ${fetched} read of at most ${budget}`,
  'scan.firstScan': 'Running the first scan…',
  'scan.noRanges': 'Nothing scanned yet — opening the feed records it.',
  'scan.noAuthors': 'No authors yet — opening an author’s page records them.',
  'scan.authorRange': ({ from, to }) => `Blocks ${from} to ${to}`,
  'scan.authorSummary': ({ segments, count }) => ` · ${segments} ranges · ${count} posts`,
  'scan.authorNoRange': 'No range recorded',
  'scan.authorCached': ({ count }) => ` · ${count} posts cached`,

  // --- The settings page (/settings) --------------------------------------
  'settings.title': 'Settings',
  'settings.customized': 'Customized',
  'settings.defaults': 'Using the defaults',
  'settings.intro': ({ address }) =>
    `The contract is CREATE2-deployed, so it sits at the same address on every chain (${address}) and both chains are one journal: the feed merges their posts by time. Each chain can hold several RPC endpoints: the first is used, and the reader falls back to the next when one fails. Saving takes effect at once, without a reload; a scan already running moves to the new endpoints at its next request.`,
  'settings.noEndpoints': 'No endpoints — the built-in defaults will be used after saving.',
  'settings.primary': 'primary',
  'settings.moveUp': ({ position }) => `Move endpoint ${position} up`,
  'settings.moveDown': ({ position }) => `Move endpoint ${position} down`,
  'settings.removeEndpoint': ({ position }) => `Remove endpoint ${position}`,
  'settings.endpointPlaceholder': 'https://your-node-url',
  'settings.addEndpointFor': ({ chain }) => `Add an RPC endpoint for ${chain}`,
  'settings.restoreChainDefaults': 'Restore this chain’s default endpoints',
  'settings.rescanHeading': 'Scan frequency',
  'settings.rescanLabel': 'Blockchain rescan delay (minutes)',
  'settings.rescanNote':
    'For N minutes after a scan finishes, reopening the feed or an author page shows what that scan found instead of asking the node for new blocks; after that, the next visit sweeps up the blocks produced meanwhile. 0 = scan every time. The default is 1 minute. This only decides when new blocks are read — no post is ever missed: what has been read is cached permanently, because on-chain data does not change and the same post is never requested twice.',
  'settings.languageHeading': 'Language',
  'settings.languageLabel': 'Interface language',
  'settings.languageNote':
    'The interface is in English by default and can be switched to Chinese. The choice applies at once and is kept in this browser; it changes the interface only — a post is stored on-chain in the language it was written in.',
  'settings.resetAll': 'Restore defaults',
  'settings.storageNote':
    'The endpoint lists are kept in this browser (localStorage). Scanned ranges and the body and image caches are stored per chain, so no chain pollutes another.',
  'settings.chainLabel': ({ chain, id }) => `${chain} · ${id}`,

  // --- Backup and restore --------------------------------------------------
  'backup.heading': 'Backup and restore',
  'backup.note':
    'Save everything on this page — each chain’s endpoint list, the rescan delay, the publish target, the language, the theme and the console log switch — as one JSON file, and import it on another browser or machine. An import lists what it would change first, and applies only once confirmed, with no reload.',
  'backup.export': 'Export settings',
  'backup.import': 'Import settings…',
  'backup.pickFile': 'Choose a settings file',
  'backup.exported': ({ name }) => `Exported ${name}`,
  'backup.applied': ({ name }) => `Applied the settings in ${name}`,
  'backup.reviewFrom': ({ name }) => `From ${name}`,
  'backup.reviewWill': ', applying it will:',
  'backup.reviewColon': ':',
  'backup.unreadable': 'This file could not be read.',

  // --- The wallet corner of the write tab ----------------------------------
  'wallet.heading': 'Wallet and network',
  'wallet.myPosts': 'View my posts',
  'wallet.connected': 'Connected',
  'wallet.connect': 'Connect wallet',
  'wallet.connecting': 'Connecting…',
  'wallet.connectFailed': 'Could not connect',
  'wallet.publishTo': 'Publish to',
  'wallet.cancelled': 'Cancelled',
  'wallet.switchFailed': 'Could not switch — please switch networks in your wallet',
  'wallet.switch': 'Switch the wallet’s network',
  'wallet.switching': 'Switching…',
  'wallet.mismatch': ({ walletChain, walletChainId, targetChain }) =>
    `The wallet is on ${walletChain} (ID ${walletChainId}); the publish target is ${targetChain}.`,
  'wallet.onTarget': ({ chain }) => `The wallet is on ${chain}.`,
  'wallet.followingWallet': ({ chain }) =>
    `The wallet is on ${chain}; the publish target follows the wallet’s network.`,
  'wallet.willConnect':
    'Publishing will ask to connect a wallet; the post is written permanently to the contract on the chosen network.',
  'wallet.none': 'No wallet detected — please install a browser wallet such as MetaMask.',
  'wallet.chooseWallet': 'Which wallet signs',
  'wallet.browserWallet': 'Browser wallet',
  'wallet.walletConnect': 'WalletConnect',
  'wallet.disconnect': 'Disconnect',
  'wallet.connectedWith': ({ wallet }) => `Connected with ${wallet}`,

  // --- The draft kept between visits ---------------------------------------
  'draft.restored': ({ when }) => `Draft restored from ${when}`,
  'draft.discard': 'Discard',

  // --- Writing and publishing ---------------------------------------------
  'publish.placeholderBody': `# A heading

Write something…

Drop images into the area below or click to upload; click an image or its name to copy its reference and paste it into the body.`,
  'publish.titleHeading': 'Title',
  'publish.titlePlaceholder': 'What do I want to say',
  'publish.titleTooLong': 'The title is too long to encode as bytes32',
  'publish.tagsHeading': 'Tags',
  'publish.tagsPlaceholder': 'Enter or comma to separate',
  'publish.removeTag': ({ tag }) => `Remove the tag ${tag}`,
  'publish.bodyHeading': 'Body',
  'publish.editorView': 'Editor view',
  'publish.edit': 'Edit',
  'publish.preview': 'Preview',
  'publish.refHintPrefix': 'To reference another post: ',
  'publish.refHintSuffix':
    '; the index is which post it is inside that transaction and may be omitted; leave the text empty to show the other post’s title.',
  'publish.refExample': '[text](0xTRANSACTION_HASH/0)',
  'publish.imagesHeading': 'Images',
  'publish.costHeading': 'Estimated cost',
  'publish.permanentNotice':
    'Once published, a post is public on the blockchain forever; it cannot be edited or deleted.',
  'publish.button': 'Publish on-chain',
  'publish.uploadingImages': 'Uploading images…',
  'publish.confirmInWallet': 'Confirm in your wallet…',
  'publish.compressing': 'Compressing the body…',
  'publish.uploadingToChain': 'Uploading images on-chain…',
  'publish.uploadProgress': ({ index, total, key }) => `Uploading image (${index}/${total}): ${key}`,
  'publish.reusingImage': ({ index, total, key }) =>
    `Image (${index}/${total}): ${key} is already on chain — reusing it`,
  'publish.done': 'Published.',
  'publish.failed': 'Could not publish',
  'publish.noWalletConnected': 'No wallet connected',
  'publish.missingImages': ({ keys }) => `Images not uploaded: ${keys}`,
  'publish.bodyTooBig': ({ size, limit }) =>
    `The compressed body is ${size}, over the ${limit} single-transaction ceiling. Please shorten it, or split it across several posts.`,
  'publish.publishedTo': ({ chain }) => `Published to ${chain}`,
  'publish.waitForBlock': 'It appears in the list once the block is confirmed',
  'publish.writeAnother': 'Write another',

  // --- The authors this reader follows -------------------------------------
  'following.follow': 'Follow',
  'following.following': 'Following',
  'following.followTitle': 'Keep up with this author, in this browser',
  'following.unfollowTitle': 'Stop following this author',
  'following.title': 'Following',
  'following.subtitle': ({ count }) => `${count} author${count === 1 ? '' : 's'}`,
  'following.neverPublished': ({ count }) =>
    count === 1 ? ' · 1 has not published yet' : ` · ${count} have not published yet`,
  'following.allPosts': 'All posts',
  'following.link': ({ count }) => `Following ${count}`,
  'following.empty': 'You are not following anyone yet',
  'following.emptyBody':
    'Follow an author from their page and their posts appear here. It costs one read per author — no block ranges are scanned at all.',
  'following.goRead': 'Go and find someone',
  'following.nothingYet': 'Nothing from them yet',
  'following.nothingYetBody': 'The authors you follow have not published anything that has been read here.',
  'following.write': 'Write something yourself',
  'following.newSince': ({ when }) => `Read up to here ${when}`,
  'following.reading': 'Reading their posts…',
  'following.settingsHeading': 'Following',
  'following.settingsNote':
    'Kept in this browser only, and carried in the settings file. Following someone costs nothing and tells them nothing.',
  'following.none': 'Nobody yet.',
  'following.remove': ({ address }) => `Stop following ${address}`,

  // --- ENS: the identity layer the contract deliberately has not got -------
  'ens.resolving': 'Looking up the name…',
  'ens.notFound': ({ name }) => `No such name: ${name}`,
  'ens.notFoundBody':
    'This name resolves to no address on Ethereum. It may never have been registered, it may have expired, or it may point somewhere other than an address. An author can always be reached by their address.',
  'ens.goHome': 'Back to the feed',
  'profile.website': 'Website',
  'profile.twitter': 'On X',
  'profile.github': 'On GitHub',

  // --- Finding things among what this browser has read ---------------------
  'tag.title': ({ tag }) => `Tagged ${tag}`,
  'tag.scope': ({ count }) => `Among the ${count} posts this browser has read`,
  'tag.reading': 'Reading the posts this browser holds…',
  'tag.none': ({ tag }) => `Nothing read here carries the tag ${tag}`,
  'tag.noneBody': 'Read further back and this page will find more.',
  'tag.readMore': 'Read earlier posts',
  'search.open': 'Search',
  'search.title': 'Search',
  'search.placeholder': 'A word from a title, a tag, or the text',
  'search.scope': ({ count }) => `Among the ${count} posts this browser has read`,
  'search.reading': 'Reading the posts this browser holds…',
  'search.none': ({ query }) => `Nothing read here contains “${query}”`,
  'search.noneBody': 'Read further back and this page will find more.',
  'search.readMore': 'Read earlier posts',
  'search.tagCloud': 'The tags seen so far',
  'search.noTagsYet': 'No tags yet — open a few posts and they will appear here.',

  // --- What a post says about other posts ----------------------------------
  'relations.heading': 'Relations',
  'relations.note':
    'Optional. All of it travels in the post’s own front-matter, so a reader that does not know a field simply ignores it.',
  'relations.re': 'Reply to',
  'relations.supersedes': 'Supersedes',
  'relations.prev': 'Continues from',
  'relations.series': 'Series',
  'relations.seriesPlaceholder': 'Letters to Xiaoman',
  'relations.part': 'Part',
  'relations.partNeedsSeries': 'A part number needs a series name to belong to.',
  'relations.language': 'Language',
  'relations.languagePlaceholder': 'en, zh…',
  'relations.refPlaceholder': '0xTRANSACTION_HASH, or a link to the post',
  'relations.invalidRef': 'That is not a post reference.',
  'relations.noSuchPost': 'No post at that reference.',
  'relations.inReplyTo': 'In reply to',
  'relations.continuesFrom': 'Continues from',
  'relations.supersedesLine': 'Supersedes',
  'relations.partOf': ({ part, series }) => `Part ${part} of ${series}`,
  'relations.inSeries': ({ series }) => `Part of ${series}`,
  'relations.partsKnown': ({ count }) => ` · ${count} parts read here`,
  'relations.supersededBy': 'A newer version of this post exists:',
  'relations.replies': 'Replies',
  'relations.continuedIn': 'Continued in',
  'relations.seriesHeading': ({ series }) => `More of ${series}`,
  'relations.partShort': ({ part }) => `Part ${part}`,
  'relations.knownHere': 'Among the posts this browser has read.',
  'relations.reply': 'Reply',

  // --- The letter as the chain holds it, and as a file ---------------------
  'raw.show': 'Raw',
  'raw.hide': 'Hide raw',
  'raw.compressed': ({ bytes }) => `${bytes} on chain`,
  'raw.decompressed': ({ bytes }) => `${bytes} of text`,
  'raw.ratio': ({ ratio }) => `${ratio}× compression`,
  'export.download': 'Download .md',
  'export.import': 'Import .md…',
  'export.pickMarkdown': 'Choose a Markdown file',
  'export.importReplace': 'Replace what you are writing with this file?',
  'export.imported': ({ name }) => `Imported ${name}`,
  'export.importDropped': ({ keys }) =>
    `Imported, without these front-matter keys this version does not know: ${keys}`,

  // --- The image dropzone --------------------------------------------------
  'image.pasteHint':
    'You can also paste or drop an image straight into the body; it is attached and referenced where the cursor is.',
  'image.hint':
    'Images are numbered img1, img2, … automatically; click an image or its name to copy its reference and paste it into the body. An image the body never references is not written on-chain and is not charged for.',
  'image.copyRef': ({ key }) => `Copy the reference for ${key}`,
  'image.copyRefTitle': 'Click to copy the reference',
  'image.copied': 'Reference copied',
  'image.remove': ({ key }) => `Remove the image ${key}`,
  'image.unreferenced': ' · unreferenced',
  'image.upload': 'Upload an image',
  'image.dropHint': 'Drop images here or click to upload; longest edge 1600px',

  // --- The cost panel ------------------------------------------------------
  'cost.loading': 'Fetching the gas price…',
  'cost.noUsd': ' · USD price unavailable',
  'cost.body': ({ bytes }) => `Body (~${bytes} B compressed)`,
  'cost.image': ({ key }) => `Image ${key}`,
  'cost.nearLimit': ({ limit }) =>
    `The body is close to the single-transaction ceiling (about ${limit} KB compressed). Over it, the node rejects the publish — shorten the body or split it across several posts.`,
  'cost.total': 'Total',
  'cost.alreadyOnChain': 'already on chain · no cost',
  'cost.sparklineLabel': ({ chain }) => `${chain} base fee over the last day`,
  'cost.nowAt': ({ fee }) => `now ${fee}`,
  'cost.low24h': ({ fee, time }) => `24h low ${fee} at ${time}`,
  'cost.wouldHaveCost': ({ cost }) => `this post would have cost ≈ ${cost}`,
  'cost.onOtherChain': ({ chain, eth, usd }) => `On ${chain} this would cost ≈ ${eth}${usd ? ` (${usd})` : ''}`,
  'cost.onOtherChainUnknown': ({ chain }) => `${chain}’s gas price is unavailable`,
  'cost.publishThere': 'Publish there',
  'cost.ownGasPriceNote': 'Estimates use each network’s own gas price, read from its node.',

  // --- Failures the reader is shown ---------------------------------------
  'error.nodeBehind': ({ block }) => `The node has not synced to block ${block} yet — try again shortly.`,
  'error.rateLimit':
    'The node is refusing requests as too frequent. Try again shortly, or change RPC endpoints in settings.',
  'error.unsupported': 'This RPC endpoint does not support that kind of query — change endpoints in settings.',
  'error.unavailable': 'The RPC endpoint is not responding right now. Please try again shortly.',
  'error.network': 'Something went wrong with the network connection. Check it and try again.',
  'error.generic': 'The node is unavailable right now. Please try again shortly.',
  'error.noCanvasContext': 'Could not create a canvas context',
  'error.noWebp': 'This browser cannot encode WebP — please use Chrome or Firefox.',
  'error.imageTooBig': ({ size, limit }) =>
    `Still ${size} at the lowest quality, over the ${limit} single-transaction ceiling — please use a smaller image.`,
  'error.imageNamed': ({ key, message }) => `Image ${key}: ${message}`,
  'boundary.title': 'Something went wrong',
  'boundary.reload': 'Reload',

  // --- Times ---------------------------------------------------------------
  'time.justNow': 'just now',
  'time.about': ({ time }) => `about ${time}`,

  // --- Reading a settings file --------------------------------------------
  'settingsFile.notJson': 'Not a valid JSON file.',
  'settingsFile.notObject': 'The file does not contain a settings object.',
  'settingsFile.notGlyph': 'This is not a Xueni settings file (the glyph.settings marker is missing).',
  'settingsFile.badFormat': ({ format, supported }) =>
    `Settings file format version ${format} is not supported (this version supports ${supported}).`,
  'settingsFile.rpcsShape': 'rpcs should be endpoint lists grouped by chain ID.',
  'settingsFile.unknownChain': ({ id }) => `Skipping unknown chain ID ${id}.`,
  'settingsFile.chainListShape': ({ chain }) => `${chain}’s endpoint list should be an array.`,
  'settingsFile.droppedEndpoints': ({ chain, count }) =>
    `${chain}: ignoring ${count} entries that are not http(s) URLs.`,
  'settingsFile.customEndpoints': ({ chain, count }) => `${chain}: ${count} custom endpoints`,
  'settingsFile.defaultEndpoints': ({ chain }) => `${chain}: default endpoints`,
  'settingsFile.rescanDelay': ({ minutes }) => `Rescan delay: ${minutes} minutes`,
  'settingsFile.rescanShape': 'rescanDelayMinutes should be a number no smaller than 0.',
  'settingsFile.publishFollowsWallet': 'Publish to: whichever network the wallet is on',
  'settingsFile.publishChain': ({ chain }) => `Publish to: ${chain}`,
  'settingsFile.publishShape': ({ value }) => `publishChain ${value} is not a known chain.`,
  'settingsFile.theme': ({ theme }) => `Theme: ${theme}`,
  'settingsFile.themeDark': 'dark',
  'settingsFile.themeLight': 'light',
  'settingsFile.themeSystem': 'follow the system',
  'settingsFile.themeShape': 'theme should be light, dark or null (follow the system).',
  'settingsFile.lang': ({ lang }) => `Language: ${lang}`,
  'settingsFile.langShape': 'lang should be en or zh.',
  'settingsFile.following': ({ count }) =>
    count === 0 ? 'Following: nobody' : `Following: ${count} author${count === 1 ? '' : 's'}`,
  'settingsFile.followingShape': 'following should be a list of addresses.',
  'settingsFile.followingDropped': ({ count }) => `Ignoring ${count} entries that are not addresses.`,
  'settingsFile.log': ({ state }) => `Console log: ${state}`,
  'settingsFile.on': 'on',
  'settingsFile.off': 'off',
  'settingsFile.logShape': 'log should be true or false.',
  'settingsFile.nothing': 'The file holds no settings that can be applied.',

  // --- Chain names that are not proper nouns ------------------------------
  'chain.unknown': ({ id }) => `Chain ${id}`,
  'chain.sepolia': 'Sepolia testnet',
  'chain.taikoHoodi': 'Taiko Hoodi testnet',
};
