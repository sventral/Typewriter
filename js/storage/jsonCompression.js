import { compressString, decompressString } from './jsonCompressionCodec.js';

const DEFAULT_INLINE_LIMIT = 350000; // Approx. 350 KB of JSON before we switch to compression
const COMPRESSION_MARKER = '__twCompressedDoc__';
const COMPRESSION_VERSION = 1;
const COMPRESSION_ENCODING = 'lzws32-base64';
const WORKER_REQUEST_TIMEOUT_MS = 25000;

let compressionWorker = null;
let compressionWorkerSeq = 0;
const compressionWorkerPending = new Map();

function clearWorkerPendingWithError(error) {
  for (const pending of compressionWorkerPending.values()) {
    if (pending?.timeout) clearTimeout(pending.timeout);
    pending?.reject?.(error);
  }
  compressionWorkerPending.clear();
}

function teardownCompressionWorker(error = null) {
  if (compressionWorker) {
    try {
      compressionWorker.terminate();
    } catch {}
  }
  compressionWorker = null;
  if (error) {
    clearWorkerPendingWithError(error);
  }
}

function canUseCompressionWorker() {
  if (typeof Worker !== 'function') return false;
  if (typeof URL !== 'function') return false;
  try {
    // Validate that `import.meta.url` and module workers are supported.
    // Browsers that fail here will safely use the synchronous fallback.
    new URL('./jsonCompressionWorker.js', import.meta.url);
    return true;
  } catch {
    return false;
  }
}

function handleWorkerMessage(event) {
  const message = event?.data;
  const id = Number.isInteger(message?.id) ? message.id : null;
  if (id == null) return;
  const pending = compressionWorkerPending.get(id);
  if (!pending) return;
  compressionWorkerPending.delete(id);
  if (pending.timeout) clearTimeout(pending.timeout);
  if (typeof message.error === 'string' && message.error) {
    pending.reject(new Error(message.error));
    return;
  }
  pending.resolve(typeof message.payload === 'string' ? message.payload : '');
}

function ensureCompressionWorker() {
  if (compressionWorker) return compressionWorker;
  if (!canUseCompressionWorker()) return null;
  try {
    const worker = new Worker(
      new URL('./jsonCompressionWorker.js', import.meta.url),
      { type: 'module' },
    );
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', (event) => {
      const message = event?.message || 'Compression worker failed';
      teardownCompressionWorker(new Error(message));
    });
    compressionWorker = worker;
  } catch {
    compressionWorker = null;
  }
  return compressionWorker;
}

function compressStringAsync(input) {
  const worker = ensureCompressionWorker();
  if (!worker) {
    return Promise.resolve(compressString(input));
  }
  const id = ++compressionWorkerSeq;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      compressionWorkerPending.delete(id);
      reject(new Error('Compression worker timed out'));
      teardownCompressionWorker(new Error('Compression worker timed out'));
    }, WORKER_REQUEST_TIMEOUT_MS);
    compressionWorkerPending.set(id, { resolve, reject, timeout });
    try {
      worker.postMessage({ id, raw: input });
    } catch (err) {
      clearTimeout(timeout);
      compressionWorkerPending.delete(id);
      reject(err instanceof Error ? err : new Error('Compression worker postMessage failed'));
      teardownCompressionWorker(err instanceof Error ? err : new Error('Compression worker postMessage failed'));
    }
  });
}

function buildCompressedDocument(raw, payload) {
  return {
    [COMPRESSION_MARKER]: true,
    version: COMPRESSION_VERSION,
    encoding: COMPRESSION_ENCODING,
    payload,
    rawLength: raw.length,
  };
}

export function encodeDocumentDataForStorage(data, options = {}) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const inlineLimit = Number.isFinite(options.inlineLimit)
    ? options.inlineLimit
    : DEFAULT_INLINE_LIMIT;
  try {
    const raw = JSON.stringify(data);
    if (raw.length <= inlineLimit) {
      return data;
    }
    const payload = compressString(raw);
    return buildCompressedDocument(raw, payload);
  } catch {
    return data;
  }
}

export async function encodeDocumentDataForStorageAsync(data, options = {}) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const inlineLimit = Number.isFinite(options.inlineLimit)
    ? options.inlineLimit
    : DEFAULT_INLINE_LIMIT;
  try {
    const raw = JSON.stringify(data);
    if (raw.length <= inlineLimit) {
      return data;
    }
    let payload;
    if (options.useWorker === false) {
      payload = compressString(raw);
    } else {
      try {
        payload = await compressStringAsync(raw);
      } catch {
        payload = compressString(raw);
      }
    }
    return buildCompressedDocument(raw, payload);
  } catch {
    return data;
  }
}

export function decodeDocumentDataFromStorage(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object' && value[COMPRESSION_MARKER]) {
    if (value.encoding !== COMPRESSION_ENCODING || typeof value.payload !== 'string') {
      return null;
    }
    try {
      const json = decompressString(value.payload);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') {
    return value;
  }
  return null;
}

export function getCompressionDebugInfo(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (!value[COMPRESSION_MARKER]) {
    return null;
  }
  return {
    version: value.version,
    encoding: value.encoding,
    rawLength: value.rawLength || null,
    payloadLength: typeof value.payload === 'string' ? value.payload.length : null,
  };
}
