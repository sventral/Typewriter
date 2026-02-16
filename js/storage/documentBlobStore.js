const DB_NAME = 'typesim-docs';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

let openDbPromise = null;

function openDb() {
  if (openDbPromise) return openDbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  openDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const { result } = request;
      if (!result.objectStoreNames.contains(STORE_NAME)) {
        result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
    request.onblocked = () => {
      reject(new Error('IndexedDB open request is blocked.'));
    };
  }).catch((err) => {
    openDbPromise = null;
    throw err;
  });
  return openDbPromise;
}

async function runTransaction(mode, handler) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    handler(store, tx);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function saveDocumentPayload(id, payload) {
  if (!id) return;
  await runTransaction('readwrite', (store) => {
    store.put({ id, payload });
  });
}

export async function readDocumentPayload(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.payload : null);
    req.onerror = () => reject(req.error || new Error('Failed to read document payload'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function deleteDocumentPayload(id) {
  if (!id) return;
  await runTransaction('readwrite', (store) => {
    store.delete(id);
  });
}

export async function listDocumentPayloadIds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const ids = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openKeyCursor();
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        ids.push(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve(ids);
      }
    };
    req.onerror = () => reject(req.error || new Error('Failed to list document payload ids'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function pruneDocumentPayloads(keepIds) {
  const keep = keepIds instanceof Set ? keepIds : new Set(Array.isArray(keepIds) ? keepIds : []);
  const existing = await listDocumentPayloadIds().catch(() => []);
  const removals = existing.filter((id) => !keep.has(id));
  if (!removals.length) return;
  await runTransaction('readwrite', (store) => {
    removals.forEach((id) => store.delete(id));
  });
}

export function estimatePayloadBytes(payload) {
  if (payload == null) return 0;
  try {
    const json = JSON.stringify(payload);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length * 2; // UTF-16 approximation
  } catch {
    return 0;
  }
}
