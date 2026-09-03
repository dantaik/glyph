// cache.js — IndexedDB permanent local cache for immutable on-chain content.
//
// Posts are immutable by design (Ethereum calldata), so we cache forever.
// Two stores: bodies ({tags, markdown}) and images (ArrayBuffer), both
// keyed by chain id + transaction hash.
//
// Strategy: cache-first. On read, check cache → return if hit; on miss,
// caller fetches from chain and calls setCached*. No eviction — posts are
// permanent and small (~1-2 KB brotli), so even 10,000 posts fit in ~20 MB.
//
// Keys carry the chain id so that nothing read on one chain is ever served
// for another. Entries written before keys were scoped are keyed by hash
// alone; a transaction hash identifies one transaction on one chain, so
// such an entry is re-filed under the scoped key the first time it is
// asked for instead of being fetched again.

const DB_NAME = 'glyph-cache';
const DB_VERSION = 1;

/** Lazily-opened singleton connection, reused by every cache op. */
let dbPromise = null;

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bodies')) {
          db.createObjectStore('bodies');
        }
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab bumped the schema version — close so the next op reopens.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const scopedKey = (chainId, txHash) => `${Number(chainId)}:${String(txHash).toLowerCase()}`;

async function put(storeName, key, value) {
  const db = await openDB();
  await promisify(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key));
}

async function get(storeName, key) {
  const db = await openDB();
  return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function del(storeName, key) {
  const db = await openDB();
  await promisify(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key));
}

/** Read under the scoped key, falling back to (and re-filing) a legacy entry. */
async function read(storeName, chainId, txHash) {
  try {
    const key = scopedKey(chainId, txHash);
    const hit = await get(storeName, key);
    if (hit != null) return hit;
    const legacy = await get(storeName, txHash);
    if (legacy == null) return null;
    put(storeName, key, legacy)
      .then(() => del(storeName, txHash))
      .catch(() => {});
    return legacy;
  } catch {
    return null;
  }
}

async function write(storeName, chainId, txHash, value) {
  try {
    await put(storeName, scopedKey(chainId, txHash), value);
  } catch {
    // quota exceeded or privacy mode — silent degrade
  }
}

// --- Post bodies ---

/**
 * Retrieve a cached post body. Returns null on cache miss.
 * @param {number} chainId
 * @param {string} txHash
 * @returns {Promise<{ tags: string[], markdown: string } | null>}
 */
export const getCachedBody = (chainId, txHash) => read('bodies', chainId, txHash);

/**
 * Store a post body in the cache.
 * @param {number} chainId
 * @param {string} txHash
 * @param {{ tags: string[], markdown: string }} body
 */
export const setCachedBody = (chainId, txHash, body) => write('bodies', chainId, txHash, body);

// --- Images ---

/**
 * Retrieve a cached image as a Blob. Returns null on cache miss.
 * (Callers mint their own object URLs so each consumer can revoke them.)
 * @param {number} chainId
 * @param {string} txHash
 * @returns {Promise<Blob | null>}
 */
export async function getCachedImage(chainId, txHash) {
  const buf = await read('images', chainId, txHash);
  return buf ? new Blob([buf], { type: 'image/webp' }) : null;
}

/**
 * Store an image as ArrayBuffer in the cache.
 * @param {number} chainId
 * @param {string} txHash
 * @param {ArrayBuffer} buffer
 */
export const setCachedImage = (chainId, txHash, buffer) => write('images', chainId, txHash, buffer);
