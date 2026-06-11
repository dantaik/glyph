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

export async function getWallet() {
  if (!window.ethereum) {
    throw new Error('No wallet found. Install MetaMask or another browser wallet.');
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await wallet.getAddresses();
  return { wallet, account };
}

/**
 * Downscale and compress an image file to WebP.
 * Falls back to a DOM canvas when OffscreenCanvas is unavailable.
 */
export async function processImage(
  file,
  { maxEdge = 1600, quality = 0.6, maxBytes = 200_000 } = {},
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
    blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
    q -= 0.1;
  } while (blob.size > maxBytes && q > 0.3);

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
 * Replace `upload:KEY` refs in markdown with `eth:0x<txhash>` after uploading.
 * Only image refs are rewritten — naive split() would also hit text/code fences.
 * Optional `onProgress(key, i, total)` fires before each image upload
 * (i is 1-based) so the UI can show per-image progress.
 */
export async function embedImages(markdown, files, { quality = 0.6, onProgress } = {}) {
  const { wallet, account } = await getWallet();
  let out = markdown;
  const entries = Object.entries(files);
  let i = 0;
  for (const [key, file] of entries) {
    i += 1;
    onProgress?.(key, i, entries.length);
    const bytes = await processImage(file, { quality });
    const hash = await storeImage(bytes, wallet, account);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(!\\[[^\\]]*\\]\\()upload:${escapedKey}(?=[\\s)])`,
      'g',
    );
    out = out.replace(re, `$1eth:${hash}`);
  }
  return out;
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
