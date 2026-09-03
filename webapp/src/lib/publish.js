// publish.js — Author side (browser).
//
// Flow:
//   1. process each image (downscale + WebP q60) → bytes
//   2. store each image as a plain self-tx → txhash → rewrite upload:KEY → eth:0x<hash>
//   3. encode { tags, markdown } into a versioned binary payload, brotli q11
//   4. encode title to bytes32 (UTF-8, zero-padded)
//   5. publish(title, payload)
//
// Requires a browser wallet (window.ethereum).

import { createWalletClient, custom, toHex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { GLYPH_ADDRESS, CHAIN_ID } from './config';
import { abi } from './blogReader';
import { encodeTitle } from './title';
import { encodePayload } from './payload';

const chain = CHAIN_ID === 11155111 ? sepolia : mainnet;

/**
 * Per-transaction byte ceiling. NOT a consensus rule: geth's transaction
 * pool rejects anything whose encoded size exceeds txMaxSize (4 × 32 KiB)
 * with "oversized data", and every public endpoint runs that default — so
 * it binds long before EIP-7825's 16,777,216 gas cap (~409 KB of calldata,
 * the figure in the spec's constants table).
 */
export const MAX_TX_BYTES = 131_072;

/**
 * What's left for calldata once the transaction envelope is accounted for
 * (signature, nonce, gas fields, and for publish() the selector + title +
 * ABI offset/length header). Generous on purpose — being a kilobyte
 * conservative costs nothing, and guessing high costs a rejected send.
 */
export const MAX_CALLDATA_BYTES = MAX_TX_BYTES - 1_024;

const asKB = (bytes) => `${Math.ceil(bytes / 1024)} KB`;

async function getWallet() {
  if (!window.ethereum) {
    throw new Error('未检测到钱包，请安装 MetaMask 等浏览器钱包。');
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await wallet.getAddresses();
  return { wallet, account };
}

/**
 * WebP-encode a canvas with a fallback chain for browsers that lack
 * OffscreenCanvas.convertToBlob (Safari < 16.4) or WebP support entirely.
 */
async function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  const el = document.createElement('canvas');
  el.width = canvas.width;
  el.height = canvas.height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) => {
    el.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('当前浏览器不支持 WebP 编码，请换用 Chrome / Firefox。')),
      type,
      quality,
    );
  });
}

/**
 * Downscale and compress an image file to WebP.
 * Falls back to a DOM canvas when OffscreenCanvas is unavailable.
 */
async function processImage(
  file,
  { maxEdge = 1600, quality = 0.6, maxBytes = MAX_CALLDATA_BYTES } = {},
) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  let canvas;
  try {
    canvas = new OffscreenCanvas(w, h);
  } catch {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    canvas = el;
  }
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);

  let q = quality;
  let blob;
  do {
    blob = await canvasToBlob(canvas, 'image/webp', q);
    q -= 0.1;
  } while (blob.size > maxBytes && q > 0.3);
  // The loop stops lowering quality at 0.3 whether or not it got under
  // budget. Returning an over-budget blob would just buy an "oversized
  // data" rejection from the node, so say what happened instead.
  if (blob.size > maxBytes) {
    throw new Error(
      `压缩到最低画质后仍有 ${asKB(blob.size)}，超过单笔交易上限 ${asKB(maxBytes)}，请改用尺寸更小的图片。`,
    );
  }

  return new Uint8Array(await blob.arrayBuffer());
}

export async function storeImage(bytes, wallet, account) {
  return wallet.sendTransaction({
    account,
    to: account,
    data: toHex(bytes),
    value: 0n,
  });
}

/**
 * Markdown image refs to one attached file: `![alt](upload:KEY)`. Only image
 * refs match — a naive split() would also hit prose and code fences — and the
 * trailing lookahead keeps `img1` from matching inside `upload:img10`.
 */
function imageRefRe(key, flags) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(!\\[[^\\]]*\\]\\()upload:${escaped}(?=[\\s)])`, flags);
}

/**
 * The keys of `files` the markdown actually displays. Every image is its own
 * transaction, so an attachment the body doesn't show would buy calldata no
 * reader ever sees — those never go on chain.
 * @returns {string[]} keys, in `files` order
 */
export function usedImageKeys(markdown, files) {
  const md = markdown || '';
  return Object.keys(files || {}).filter((key) => imageRefRe(key).test(md));
}

/**
 * Replace `upload:KEY` refs in markdown with `eth:0x<txhash>` after uploading
 * the images the body shows (see usedImageKeys — the rest are left alone).
 * Optional `onProgress(key, i, total)` fires before each image upload
 * (i is 1-based) so the UI can show per-image progress.
 */
export async function embedImages(markdown, files, { quality = 0.6, onProgress } = {}) {
  const used = usedImageKeys(markdown, files);
  if (used.length === 0) return markdown; // nothing to pay for
  const { wallet, account } = await getWallet();
  let out = markdown;
  let i = 0;
  for (const key of used) {
    i += 1;
    onProgress?.(key, i, used.length);
    const bytes = await processImage(files[key], { quality }).catch((err) => {
      throw new Error(`图片 ${key}：${err.message}`);
    });
    const hash = await storeImage(bytes, wallet, account);
    out = out.replace(imageRefRe(key, 'g'), `$1eth:${hash}`);
  }
  return out;
}

/** A stand-in tx hash: random, so brotli can't compress it away. */
function placeholderHash() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Compress the draft and measure it against the per-transaction ceiling.
 * Call this BEFORE embedImages: images are paid for one transaction at a
 * time, so a body that can never be sent has to fail while it is still
 * free. Each `upload:KEY` is measured as the `eth:<32-byte hash>` it will
 * become — longer than the ref it replaces, and barely compressible — so
 * the draft as typed would undercount.
 * @returns {Promise<{ bytes: number, limit: number, ok: boolean }>}
 */
export async function measurePayload({ tags = [], markdown, files = {} }) {
  let doc = markdown || '';
  for (const key of usedImageKeys(doc, files)) {
    doc = doc.replace(imageRefRe(key, 'g'), `$1eth:${placeholderHash()}`);
  }
  const payload = await encodePayload({ tags, markdown: doc });
  const limit = MAX_CALLDATA_BYTES;
  return { bytes: payload.length, limit, ok: payload.length <= limit };
}

/**
 * Publish a post.
 * @param {{ title: string, tags?: string[], markdown: string }} draft
 * @returns {Promise<`0x${string}`>} tx hash of the publish call
 */
export async function publishPost({ title, tags = [], markdown }) {
  const { wallet, account } = await getWallet();
  const payload = await encodePayload({ tags, markdown });
  const titleHex = encodeTitle(title);
  return wallet.writeContract({
    account,
    address: GLYPH_ADDRESS,
    abi,
    functionName: 'publish',
    args: [titleHex, toHex(payload)],
  });
}
