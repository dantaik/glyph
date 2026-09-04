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
// A third store, `drafts`, holds what is being written rather than what has
// been read: one record, not chain-scoped, keyed by a plain string (see
// drafts.js). It shares this database because it shares the problem —
// structured data, possibly holding Blobs, that has to outlive the page.
//
// Keys carry the chain id so that nothing read on one chain is ever served
// for another. Entries written before keys were scoped are keyed by hash
// alone; a transaction hash identifies one transaction on one chain, so
// such an entry is re-filed under the scoped key the first time it is
// asked for instead of being fetched again.

const DB_NAME = 'glyph-cache';
/** 1: bodies + images. 2: adds `drafts`. */
const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts');
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
// A private window (and some browsers in other modes) can deny the API.
// Without a stand-in every navigation would re-read the same body from the
// node, so a bounded Map holds the session's worth. It dies with the page;
// IndexedDB, wherever it is allowed, remains the permanent cache.

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

// --- Records under a plain key (the draft store) --------------------
//
// The same database and the same fallback, without the chain scoping: a
// draft belongs to the person writing it, not to a chain.

const plainMemKey = (storeName, key) => `${storeName}::${key}`;

/** One record, or null when there is none (or no IndexedDB to ask). */
export async function readRecord(storeName, key) {
  if (idbDenied) return memory.get(plainMemKey(storeName, key)) ?? null;
  try {
    return (await get(storeName, key)) ?? null;
  } catch {
    idbDenied = true;
    return memory.get(plainMemKey(storeName, key)) ?? null;
  }
}

/** Store one record, falling back to memory where IndexedDB is refused. */
export async function writeRecord(storeName, key, value) {
  const memoryKey = plainMemKey(storeName, key);
  if (idbDenied) {
    memory.delete(memoryKey);
    memory.set(memoryKey, value);
    return;
  }
  try {
    await put(storeName, key, value);
  } catch {
    idbDenied = true;
    memory.delete(memoryKey);
    memory.set(memoryKey, value);
  }
}

/** Forget one record. */
export async function deleteRecord(storeName, key) {
  memory.delete(plainMemKey(storeName, key));
  if (idbDenied) return;
  try {
    await del(storeName, key);
  } catch {
    idbDenied = true;
  }
}

/**
 * Every body cached for `chainId`, as `[{ txHash, body }]`.
 *
 * The index of what bodies SAY (bodyIndex.js) is built from what has been
 * read; without this it would start empty on every visit and a reader who
 * has been here for months would see nothing until they read something
 * again. Entries written before keys carried their chain are keyed by hash
 * alone; they are handed to the chain asking, since that is the only chain
 * that browser could have read them on.
 */
export async function getCachedBodies(chainId) {
  if (idbDenied) {
    const prefix = `bodies:${Number(chainId)}:`;
    return [...memory.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, body]) => ({ txHash: key.slice(prefix.length), body }));
  }
  try {
    const db = await openDB();
    const store = db.transaction('bodies', 'readonly').objectStore('bodies');
    const [keys, values] = await Promise.all([promisify(store.getAllKeys()), promisify(store.getAll())]);
    const scope = `${Number(chainId)}:`;
    const out = [];
    keys.forEach((key, i) => {
      const name = String(key);
      if (name.startsWith(scope)) out.push({ txHash: name.slice(scope.length), body: values[i] });
      else if (!name.includes(':')) out.push({ txHash: name, body: values[i] }); // pre-chain-scoped
    });
    return out;
  } catch {
    idbDenied = true;
    return [];
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
