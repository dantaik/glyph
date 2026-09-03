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

// --- Fallback for browsers that refuse IndexedDB -----------------------
//
// Some browsers deny the API to file:// pages — where the offline single-file
// copy runs — and a private window can deny it anywhere. Without a stand-in
// every navigation would re-read the same body from the node, so a bounded
// Map holds the session's worth. It dies with the page; IndexedDB, wherever
// it is allowed, remains the permanent cache.

export const MEMORY_MAX = 500;
const memory = new Map();
let idbDenied = false;

const memKey = (storeName, chainId, txHash) => `${storeName}:${scopedKey(chainId, txHash)}`;

function memWrite(storeName, chainId, txHash, value) {
  const key = memKey(storeName, chainId, txHash);
  memory.delete(key); // re-insert so the eviction order is by last write
  memory.set(key, value);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

/** Read under the scoped key, falling back to (and re-filing) a legacy entry. */
async function read(storeName, chainId, txHash) {
  if (idbDenied) return memory.get(memKey(storeName, chainId, txHash)) ?? null;
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
    idbDenied = true;
    return memory.get(memKey(storeName, chainId, txHash)) ?? null;
  }
}

async function write(storeName, chainId, txHash, value) {
  if (idbDenied) {
    memWrite(storeName, chainId, txHash, value);
    return;
  }
  try {
    await put(storeName, scopedKey(chainId, txHash), value);
  } catch {
    // Denied (file://, privacy mode) or out of quota: keep it in memory so the
    // page at least stops asking the node for what it already has.
    idbDenied = true;
    memWrite(storeName, chainId, txHash, value);
  }
}

/**
 * Whether the permanent cache is actually available here. False when the
 * browser refuses IndexedDB — some do to a page opened from disk — in which
 * case reads are only cached for this session.
 */
export async function cachePersists() {
  if (idbDenied) return false;
  try {
    await openDB();
    return true;
  } catch {
    idbDenied = true;
    return false;
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
