// cache.js — IndexedDB permanent local cache for immutable on-chain content.
//
// Posts are immutable by design (Ethereum calldata), so we cache forever.
// Three stores: bodies ({tags, markdown} by txHash), images (ArrayBuffer by
// txHash), and title list entries (by author+index for offline browsing).
//
// Strategy: cache-first. On read, check cache → return if hit; on miss,
// caller fetches from chain and calls setCached*. No eviction — posts are
// permanent and small (~1-2 KB brotli), so even 10,000 posts fit in ~20 MB.

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

// --- Post bodies ---

/**
 * Retrieve a cached post body. Returns null on cache miss.
 * @param {string} txHash
 * @returns {Promise<{ tags: string[], markdown: string } | null>}
 */
export async function getCachedBody(txHash) {
  try {
    const db = await openDB();
    const result = await promisify(
      db.transaction('bodies', 'readonly').objectStore('bodies').get(txHash),
    );
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Store a post body in the cache.
 * @param {string} txHash
 * @param {{ tags: string[], markdown: string }} body
 */
export async function setCachedBody(txHash, body) {
  try {
    const db = await openDB();
    await promisify(
      db.transaction('bodies', 'readwrite').objectStore('bodies').put(body, txHash),
    );
  } catch {
    // quota exceeded or privacy mode — silent degrade
  }
}

// --- Images ---

/**
 * Retrieve a cached image as a Blob. Returns null on cache miss.
 * (Callers mint their own object URLs so each consumer can revoke them.)
 * @param {string} txHash
 * @returns {Promise<Blob | null>}
 */
export async function getCachedImage(txHash) {
  try {
    const db = await openDB();
    const buf = await promisify(
      db.transaction('images', 'readonly').objectStore('images').get(txHash),
    );
    if (!buf) return null;
    return new Blob([buf], { type: 'image/webp' });
  } catch {
    return null;
  }
}

/**
 * Store an image as ArrayBuffer in the cache.
 * @param {string} txHash
 * @param {ArrayBuffer} buffer
 */
export async function setCachedImage(txHash, buffer) {
  try {
    const db = await openDB();
    await promisify(
      db.transaction('images', 'readwrite').objectStore('images').put(buffer, txHash),
    );
  } catch {
    // silent degrade
  }
}
